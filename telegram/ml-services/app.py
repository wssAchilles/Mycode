"""
Phoenix 推荐系统 FastAPI 推理服务
提供以下 API:
- /ann/retrieve: Two-Tower ANN 召回 (FAISS 加速)
- /phoenix/predict: Phoenix Ranking 排序
- /vf/check: 安全内容过滤
"""

import os
import pickle
import threading
from pathlib import Path
from typing import List, Optional, Literal

import numpy as np
import torch
import faiss
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

# ========== 配置 ==========
DATA_DIR = Path(__file__).parent / "data"
MODELS_DIR = Path(__file__).parent / "models"
SCRIPTS_DIR = Path(__file__).parent / "scripts"
EMBEDDING_DIM = 64
PHOENIX_EMBEDDING_DIM = 256
MAX_HISTORY = 50
PHOENIX_MAX_HISTORY = 40

# FAISS 配置
FAISS_INDEX_TYPE = os.getenv("FAISS_INDEX_TYPE", "ivf_pq")  # 默认为我们生成的 ivf_pq
FAISS_NPROBE = int(os.getenv("FAISS_NPROBE", "16"))  # IVF 搜索时检查的聚类数
USE_FAISS = os.getenv("USE_FAISS", "true").lower() == "true"

# 云端模型下载 (Render 部署必备)
# 注意：Render 部署时，本地没有 .pt 文件，需要从 Drive 自动下载。
# 请在 Render 环境变量中配置（支持自定义命名）：
# DRIVE_ID_TWO_TOWER / DRIVE_ID_TWO_TOWER_50 = "你的ModelFileID"
# DRIVE_ID_PHOENIX / DRIVE_ID_PHOENIX_3 = "你的ModelFileID"
DRIVE_ID_TWO_TOWER = os.getenv("DRIVE_ID_TWO_TOWER") or os.getenv("DRIVE_ID_TWO_TOWER_50", "")
DRIVE_ID_PHOENIX = os.getenv("DRIVE_ID_PHOENIX") or os.getenv("DRIVE_ID_PHOENIX_3", "")

# 模型路径覆盖 (可选): 直接指定要加载的文件名或绝对路径
TWO_TOWER_MODEL_PATH = os.getenv("TWO_TOWER_MODEL_PATH", "")
PHOENIX_MODEL_PATH = os.getenv("PHOENIX_MODEL_PATH", "")

# 定时任务 / 外部调度
CRON_SECRET = os.getenv("CRON_SECRET", "")
ENABLE_INTERNAL_SCHEDULER = os.getenv("ENABLE_INTERNAL_SCHEDULER", "true").lower() == "true"

# 设备 (使用 CPU 保证稳定性)
device = torch.device("cpu")

# ========== 全局模型和索引 ==========
two_tower_model = None
phoenix_model = None
item_embeddings_tensor = None  # PyTorch 后备检索
faiss_index = None  # FAISS 索引
news_vocab = None
user_vocab = None
news_id_to_idx = None
idx_to_news_id = None
models_loaded = False

# ========== Pydantic 模型 (适配 Node.js Client) ==========

# 1. ANN Models
class ANNRequest(BaseModel):
    userId: str
    historyPostIds: List[str]
    keywords: Optional[List[str]] = None
    topK: int = 20

class ANNCandidate(BaseModel):
    postId: str
    score: float

class ANNResponse(BaseModel):
    candidates: List[ANNCandidate]

# 2. Phoenix Models
class PhoenixCandidatePayload(BaseModel):
    postId: str
    authorId: Optional[str] = None
    inNetwork: bool = False
    hasVideo: bool = False
    videoDurationSec: Optional[float] = None

class PhoenixRequest(BaseModel):
    userId: str
    userActionSequence: Optional[List[dict]] = None
    candidates: List[PhoenixCandidatePayload]

class PhoenixPrediction(BaseModel):
    postId: str # Backend expects matched structure, usually implicit, but we return a list of predictions
    # Client expects keys: like, reply, repost, click...
    like: float
    reply: float
    repost: float
    click: float
    # Dummy ones to satisfy interface
    profileClick: float = 0.0
    share: float = 0.0
    dwell: float = 0.0
    dismiss: float = 0.0
    block: float = 0.0
    
class PhoenixResponse(BaseModel):
    predictions: List[PhoenixPrediction]

# 3. VF Models
class VFItem(BaseModel):
    postId: str
    userId: str

class VFRequest(BaseModel):
    items: List[VFItem]

class VFResult(BaseModel):
    postId: str
    safe: bool
    reason: Optional[str] = None

class VFResponse(BaseModel):
    results: List[VFResult]

# ========== FastAPI App ==========
app = FastAPI(title="Phoenix Recommendation Service", version="2.0.0")

# ========== Job Guard ==========
_job_state = {"refresh_features": False, "crawl": False}
_job_lock = threading.Lock()


def _require_cron_auth(request: Request):
    if not CRON_SECRET:
        raise HTTPException(status_code=403, detail="CRON_SECRET not configured")
    auth = request.headers.get("authorization", "")
    alt = request.headers.get("x-cron-secret", "")
    if auth == f"Bearer {CRON_SECRET}" or alt == CRON_SECRET:
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


def _start_job(job_key: str, target):
    with _job_lock:
        if _job_state.get(job_key):
            return False
        _job_state[job_key] = True

    def _run():
        try:
            target()
        finally:
            with _job_lock:
                _job_state[job_key] = False

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return True

def load_faiss_index() -> Optional[faiss.Index]:
    """加载 FAISS 索引"""
    global idx_to_news_id
    
    index_path = MODELS_DIR / f"faiss_{FAISS_INDEX_TYPE}.index"
    mapping_path = MODELS_DIR / "faiss_id_mapping.pkl"
    
    if not index_path.exists():
        print(f"  ⚠️ FAISS index not found at {index_path}")
        return None
    
    try:
        index = faiss.read_index(str(index_path))
        print(f"  ✅ FAISS index loaded: {index.ntotal} vectors ({FAISS_INDEX_TYPE})")
        
        # 设置 nprobe (仅对 IVF 类索引有效)
        if hasattr(index, 'nprobe'):
            index.nprobe = FAISS_NPROBE
            print(f"     nprobe set to {FAISS_NPROBE}")
        
        # 加载 ID 映射
        if mapping_path.exists():
            with open(mapping_path, "rb") as f:
                mapping = pickle.load(f)
                idx_to_news_id = mapping.get("idx_to_news_id", idx_to_news_id)
            print(f"  ✅ FAISS ID mapping loaded")
        
        return index
    except Exception as e:
        print(f"  ❌ Failed to load FAISS index: {e}")
        return None

def _resolve_latest_model(
    prefix: str,
    override_path: str = "",
    prefer_downloaded: bool = False
) -> Path:
    if override_path:
        path = Path(override_path)
        if not path.is_absolute():
            path = MODELS_DIR / override_path
        return path

    if prefer_downloaded:
        downloaded = MODELS_DIR / f"{prefix}_epoch_latest.pt"
        if downloaded.exists():
            return downloaded

    candidates = list(MODELS_DIR.glob(f"{prefix}_epoch_*.pt"))
    if not candidates:
        return MODELS_DIR / f"{prefix}_epoch_latest.pt"

    def _epoch_num(p: Path) -> int:
        try:
            return int(p.stem.split("_")[-1])
        except Exception:
            return -1

    candidates.sort(key=_epoch_num)
    latest = candidates[-1]
    if _epoch_num(latest) >= 0:
        return latest
    # fallback: modified time
    candidates.sort(key=lambda p: p.stat().st_mtime)
    return candidates[-1]

def _resolve_download_target(prefix: str, override_path: str = "") -> Path:
    if override_path:
        path = Path(override_path)
        if not path.is_absolute():
            path = MODELS_DIR / override_path
        return path
    return MODELS_DIR / f"{prefix}_epoch_latest.pt"

def load_models_sync():
    """同步加载模型"""
    global two_tower_model, phoenix_model, item_embeddings_tensor, faiss_index
    global news_vocab, user_vocab, news_id_to_idx, idx_to_news_id, models_loaded
    
    if models_loaded:
        return
    
    print("🚀 Loading models and indices...")
    
    # 1. 加载词表
    with open(DATA_DIR / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
    with open(DATA_DIR / "user_vocab.pkl", "rb") as f:
        user_vocab = pickle.load(f)
    
    idx_to_news_id = {v: k for k, v in news_vocab.items()}
    news_id_to_idx = news_vocab
    print("  ✅ Vocabularies loaded")
    
    # 1.5 [新增] 自动下载模型 (针对云部署)
    from scripts.download_utils import download_model_from_drive
    
    if DRIVE_ID_TWO_TOWER:
        two_tower_download_path = _resolve_download_target("two_tower", TWO_TOWER_MODEL_PATH)
        download_model_from_drive(DRIVE_ID_TWO_TOWER, two_tower_download_path)
    
    if DRIVE_ID_PHOENIX:
        phoenix_download_path = _resolve_download_target("phoenix", PHOENIX_MODEL_PATH)
        download_model_from_drive(DRIVE_ID_PHOENIX, phoenix_download_path)

    # 2. 加载 Two-Tower 模型
    import sys
    sys.path.insert(0, str(SCRIPTS_DIR))
    from model_arch import TwoTowerModel
    
    two_tower_model = TwoTowerModel(
        num_users=len(user_vocab),
        num_news=len(news_vocab),
        embedding_dim=EMBEDDING_DIM
    ).to(device)
    two_tower_path = _resolve_latest_model(
        "two_tower",
        TWO_TOWER_MODEL_PATH,
        prefer_downloaded=bool(DRIVE_ID_TWO_TOWER)
    )
    if not two_tower_path.exists():
        raise FileNotFoundError(f"Two-Tower model not found: {two_tower_path}")
    two_tower_model.load_state_dict(torch.load(two_tower_path, map_location=device, weights_only=True))
    two_tower_model.eval()
    print(f"  ✅ Two-Tower model loaded: {two_tower_path.name}")
    
    # 3. 加载 Phoenix 模型
    from phoenix_model import PhoenixRanker
    
    phoenix_model = PhoenixRanker(
        num_news=len(news_vocab),
        embedding_dim=PHOENIX_EMBEDDING_DIM,
        num_heads=4,
        num_layers=2
    ).to(device)
    phoenix_path = _resolve_latest_model(
        "phoenix",
        PHOENIX_MODEL_PATH,
        prefer_downloaded=bool(DRIVE_ID_PHOENIX)
    )
    if not phoenix_path.exists():
        raise FileNotFoundError(f"Phoenix model not found: {phoenix_path}")
    phoenix_model.load_state_dict(torch.load(phoenix_path, map_location=device, weights_only=True))
    phoenix_model.eval()
    print(f"  ✅ Phoenix model loaded: {phoenix_path.name}")
    
    # 4. 尝试加载 FAISS 索引
    if USE_FAISS:
        faiss_index = load_faiss_index()
    
    # 5. 后备: 加载 Item Embeddings (PyTorch 检索)
    if faiss_index is None:
        print("  📦 Loading item embeddings for PyTorch fallback...")
        emb_np = np.load(DATA_DIR / "item_embeddings.npy").astype(np.float32)
        # L2 Normalize
        norms = np.linalg.norm(emb_np, axis=1, keepdims=True)
        emb_np = emb_np / (norms + 1e-10)
        
        item_embeddings_tensor = torch.from_numpy(emb_np).to(device)
        print(f"  ✅ Item embeddings loaded: {item_embeddings_tensor.shape}")
    
    models_loaded = True
    print("🎉 All models loaded successfully!")
    print(f"   FAISS enabled: {faiss_index is not None}")

# ========== API Endpoints ==========

@app.get("/health")
async def health_check():
    return {
        "status": "ok", 
        "models_loaded": models_loaded, 
        "device": str(device),
        "faiss_enabled": faiss_index is not None,
        "faiss_index_type": FAISS_INDEX_TYPE if faiss_index else None
    }

@app.post("/ann/retrieve", response_model=ANNResponse)
async def ann_retrieve(request: ANNRequest):
    """Two-Tower ANN 召回 (FAISS 加速版)"""
    load_models_sync()
    
    if two_tower_model is None:
        raise HTTPException(status_code=503, detail="Two-Tower model not loaded")
    
    if faiss_index is None and item_embeddings_tensor is None:
        raise HTTPException(status_code=503, detail="Neither FAISS nor embeddings loaded")
    
    # 1. 编码用户向量
    user_idx = user_vocab.get(request.userId, user_vocab.get("<UNK>", 1))
    
    history_indices = [news_vocab.get(nid, news_vocab.get("<UNK>", 1)) for nid in request.historyPostIds]
    
    if len(history_indices) > MAX_HISTORY:
        history_indices = history_indices[-MAX_HISTORY:]
        mask = [1.0] * MAX_HISTORY
    else:
        pad_len = MAX_HISTORY - len(history_indices)
        mask = [1.0] * len(history_indices) + [0.0] * pad_len
        history_indices = history_indices + [0] * pad_len
    
    user_tensor = torch.tensor([user_idx], dtype=torch.long, device=device)
    history_tensor = torch.tensor([history_indices], dtype=torch.long, device=device)
    mask_tensor = torch.tensor([mask], dtype=torch.float, device=device)
    
    with torch.no_grad():
        user_vec = two_tower_model.user_encoder(user_tensor, history_tensor, mask_tensor)
        user_vec_np = user_vec.cpu().numpy().astype(np.float32)
        
        # L2 归一化 (FAISS 使用 IP 需要归一化)
        user_vec_np = user_vec_np / (np.linalg.norm(user_vec_np, axis=1, keepdims=True) + 1e-10)
    
    k = request.topK
    
    # 2. FAISS 检索 或 PyTorch 后备
    if faiss_index is not None:
        # FAISS 快速检索
        distances, indices = faiss_index.search(user_vec_np, k)
        top_scores = distances[0].tolist()
        top_indices = indices[0].tolist()
    else:
        # PyTorch 后备 (全量暴力搜索)
        user_vec_torch = torch.from_numpy(user_vec_np).to(device)
        scores = torch.matmul(user_vec_torch, item_embeddings_tensor.t())
        k = min(k, scores.size(1))
        top_scores_t, top_indices_t = torch.topk(scores[0], k=k)
        top_scores = top_scores_t.tolist()
        top_indices = top_indices_t.tolist()
    
    # 3. 构建响应
    candidates = []
    for score, idx in zip(top_scores, top_indices):
        if idx < 0:  # FAISS 可能返回 -1 表示不足 k 个结果
            continue
        news_id = idx_to_news_id.get(idx, "<UNK>")
        if news_id not in ("<PAD>", "<UNK>"):
            candidates.append({"postId": news_id, "score": float(score)})
    
    return ANNResponse(candidates=candidates)

@app.post("/phoenix/predict", response_model=PhoenixResponse)
async def phoenix_predict(request: PhoenixRequest):
    """Phoenix Ranking 排序 (适配 TS Client)"""
    load_models_sync()
    
    if phoenix_model is None:
        raise HTTPException(status_code=503, detail="Phoenix model not loaded")
    
    # 提取历史: 从 userActionSequence 中提取 targetPostId
    history_ids = []
    if request.userActionSequence:
        for action in request.userActionSequence:
            if "targetPostId" in action:
                history_ids.append(str(action["targetPostId"]))
    
    # 如果没有行为序列，使用空
    history_indices = [news_vocab.get(nid, news_vocab.get("<UNK>", 1)) for nid in history_ids]
    
    if len(history_indices) > PHOENIX_MAX_HISTORY:
        history_indices = history_indices[-PHOENIX_MAX_HISTORY:]
    else:
        history_indices = history_indices + [0] * (PHOENIX_MAX_HISTORY - len(history_indices))
        
    # 提取候选: 从 candidates 对象列表中提取 postId
    candidate_ids = [c.postId for c in request.candidates]
    candidate_indices = [news_vocab.get(nid, news_vocab.get("<UNK>", 1)) for nid in candidate_ids]
    
    history_tensor = torch.tensor([history_indices], dtype=torch.long, device=device)
    candidate_tensor = torch.tensor([candidate_indices], dtype=torch.long, device=device)
    
    with torch.no_grad():
        outputs = phoenix_model(history_tensor, candidate_tensor)
        click_probs = torch.sigmoid(outputs["click"]).cpu().numpy()[0]
        like_probs = torch.sigmoid(outputs["like"]).cpu().numpy()[0]
        reply_probs = torch.sigmoid(outputs["reply"]).cpu().numpy()[0]
        repost_probs = torch.sigmoid(outputs["repost"]).cpu().numpy()[0]
    
    predictions = []
    for i, cid in enumerate(candidate_ids):
        predictions.append({
            "postId": cid,
            "click": float(click_probs[i]),
            "like": float(like_probs[i]),
            "reply": float(reply_probs[i]),
            "repost": float(repost_probs[i]),
            "profileClick": 0.0,
            "share": 0.0,
            "dwell": 0.0,
            "dismiss": 0.0,
            "block": 0.0
        })
    
    return PhoenixResponse(predictions=predictions)

# ========== VF 增强版安全检测 ==========

# 延迟导入安全模块
_safety_service = None

def get_safety_service():
    global _safety_service
    if _safety_service is None:
        import sys
        sys.path.insert(0, str(SCRIPTS_DIR))
        from safety_module import ContentSafetyService
        _safety_service = ContentSafetyService(
            ml_model_path=None,  # TODO: 配置 ML 模型路径
            enable_ml=False  # 暂时禁用 ML，仅使用规则引擎
        )
        print("  ✅ Safety service initialized")
    return _safety_service

# 扩展 VF 请求模型以支持内容检测
class VFItemExtended(BaseModel):
    postId: str
    userId: str
    content: Optional[str] = None  # 新增：帖子内容

class VFRequestExtended(BaseModel):
    items: List[VFItemExtended]
    skipML: bool = False  # 是否跳过 ML 检测

class VFResultExtended(BaseModel):
    postId: str
    safe: bool
    reason: Optional[str] = None
    level: str = "safe"  # safe, low_risk, medium, high, blocked
    score: float = 0.0  # 风险分数 0-1
    violations: List[str] = []  # 违规类型
    requiresReview: bool = False  # 是否需要人工复审

class VFResponseExtended(BaseModel):
    results: List[VFResultExtended]

@app.post("/vf/check", response_model=VFResponse)
async def vf_check(request: VFRequest):
    """VF 安全内容过滤 (兼容旧版 API)"""
    safety_service = get_safety_service()
    
    results = []
    for item in request.items:
        # 如果没有内容，使用 postId 作为简单检测 (兼容旧版)
        content = getattr(item, 'content', None) or item.postId
        
        result = safety_service.check(
            content=content,
            user_id=item.userId
        )
        
        results.append({
            "postId": item.postId,
            "safe": result.safe,
            "reason": result.reason
        })
    
    return VFResponse(results=results)

@app.post("/vf/check/v2", response_model=VFResponseExtended)
async def vf_check_v2(request: VFRequestExtended):
    """VF 安全内容过滤 v2 (增强版 - 支持完整内容检测)"""
    safety_service = get_safety_service()
    
    results = []
    for item in request.items:
        content = item.content or item.postId
        
        result = safety_service.check(
            content=content,
            user_id=item.userId,
            skip_ml=request.skipML
        )
        
        results.append(VFResultExtended(
            postId=item.postId,
            safe=result.safe,
            reason=result.reason,
            level=result.level.value,
            score=result.score,
            violations=[v.value for v in result.violations],
            requiresReview=result.requires_review
        ))
    
    return VFResponseExtended(results=results)

@app.post("/vf/blacklist/add")
async def vf_add_blacklist(user_id: str):
    """添加用户到黑名单"""
    safety_service = get_safety_service()
    safety_service.rule_engine.add_user_to_blacklist(user_id)
    return {"status": "ok", "user_id": user_id}

@app.post("/vf/blacklist/remove")
async def vf_remove_blacklist(user_id: str):
    """从黑名单移除用户"""
    safety_service = get_safety_service()
    safety_service.rule_engine.remove_user_from_blacklist(user_id)
    return {"status": "ok", "user_id": user_id}

@app.post("/vf/rules/add")
async def vf_add_rule(keyword: str, violation_type: str, high_risk: bool = True):
    """动态添加关键词规则"""
    from safety_module import ViolationType
    
    safety_service = get_safety_service()
    try:
        vtype = ViolationType(violation_type)
        safety_service.rule_engine.add_keyword(keyword, vtype, high_risk)
        return {"status": "ok", "keyword": keyword, "type": violation_type}
    except ValueError:
        return {"status": "error", "message": f"Invalid violation type: {violation_type}"}

# ========== 外部调度 Jobs ==========

@app.post("/jobs/refresh-features")
async def refresh_features_job(
    request: Request,
    days: int = 1,
    max_users: Optional[int] = None,
    max_history: int = MAX_HISTORY,
    batch_size: int = 128,
    rebuild_faiss: bool = False,
    filter_users_from_postgres: bool = False,
):
    """触发特征刷新（由 Cloud Scheduler 调用）"""
    _require_cron_auth(request)

    def _task():
        from scripts.refresh_features import run_refresh_features_job

        run_refresh_features_job(
            days=days,
            max_users=max_users,
            max_history=max_history,
            batch_size=batch_size,
            rebuild_faiss=rebuild_faiss,
            filter_users_from_postgres=filter_users_from_postgres,
        )

    if not _start_job("refresh_features", _task):
        raise HTTPException(status_code=409, detail="refresh_features job is already running")

    return {"status": "accepted"}


@app.post("/jobs/crawl")
async def crawl_job(request: Request):
    """触发新闻爬取（由 Cloud Scheduler 调用）"""
    _require_cron_auth(request)

    if not _start_job("crawl", run_crawler_job):
        raise HTTPException(status_code=409, detail="crawl job is already running")

    return {"status": "accepted"}

# ========== 定时任务 (News Crawler) ==========
from apscheduler.schedulers.background import BackgroundScheduler
from crawler.news_fetcher import NewsCrawler

scheduler = None

def run_crawler_job():
    """Wrapper to run crawler job safely"""
    print("⏰ [Scheduler] Starting hourly news crawl...")
    try:
        crawler = NewsCrawler()
        crawler.run_job()
    except Exception as e:
        print(f"❌ [Scheduler] Crawler failed: {e}")

@app.on_event("startup")
def start_scheduler():
    global scheduler
    if not ENABLE_INTERNAL_SCHEDULER:
        print("⏸️ [Scheduler] Internal scheduler disabled by ENABLE_INTERNAL_SCHEDULER")
        return
    # 仅在非 Worker 进程中启动 (避免多进程重复执行，简单起见这里假设单进程)
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_crawler_job, 'interval', hours=1)
    scheduler.start()
    print("✅ [Scheduler] Background scheduler started (Interval: 1 hour)")
    print("🚀 [System] CI/CD Verification Build - Auto-deployed via Cloud Build")

@app.on_event("shutdown")
def shutdown_scheduler():
    if scheduler:
        scheduler.shutdown()
        print("🛑 [Scheduler] Background scheduler shut down")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
