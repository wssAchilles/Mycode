"""
Phoenix 推荐系统 FastAPI 推理服务
提供以下 API:
- /ann/retrieve: Two-Tower ANN 召回
- /phoenix/predict: Phoenix Ranking 排序
- /vf/check: 安全内容过滤
"""

import pickle
from pathlib import Path
from typing import List, Optional

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ========== 配置 ==========
DATA_DIR = Path(__file__).parent / "data"
MODELS_DIR = Path(__file__).parent / "models"
SCRIPTS_DIR = Path(__file__).parent / "scripts"
EMBEDDING_DIM = 64
PHOENIX_EMBEDDING_DIM = 256
MAX_HISTORY = 50
PHOENIX_MAX_HISTORY = 40

# 设备 (使用 CPU 保证稳定性)
device = torch.device("cpu")

# ========== 全局模型和索引 ==========
two_tower_model = None
phoenix_model = None
item_embeddings_tensor = None # 替代 FAISS
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
app = FastAPI(title="Phoenix Recommendation Service", version="1.0.0")

def load_models_sync():
    """同步加载模型"""
    global two_tower_model, phoenix_model, item_embeddings_tensor
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
    
    # 2. 加载 Two-Tower 模型
    import sys
    sys.path.insert(0, str(SCRIPTS_DIR))
    from model_arch import TwoTowerModel
    
    two_tower_model = TwoTowerModel(
        num_users=len(user_vocab),
        num_news=len(news_vocab),
        embedding_dim=EMBEDDING_DIM
    ).to(device)
    two_tower_model.load_state_dict(torch.load(MODELS_DIR / "two_tower_epoch_5.pt", map_location=device, weights_only=True))
    two_tower_model.eval()
    print("  ✅ Two-Tower model loaded")
    
    # 3. 加载 Phoenix 模型
    from phoenix_model import PhoenixRanker
    
    phoenix_model = PhoenixRanker(
        num_news=len(news_vocab),
        embedding_dim=PHOENIX_EMBEDDING_DIM,
        num_heads=4,
        num_layers=2
    ).to(device)
    phoenix_model.load_state_dict(torch.load(MODELS_DIR / "phoenix_epoch_3.pt", map_location=device, weights_only=True))
    phoenix_model.eval()
    print("  ✅ Phoenix model loaded")
    
    # 4. 加载 Item Embeddings (使用 PyTorch 进行检索)
    # 不使用 FAISS，避免 Segfault
    emb_np = np.load(DATA_DIR / "item_embeddings.npy").astype(np.float32)
    # L2 Normalize
    norms = np.linalg.norm(emb_np, axis=1, keepdims=True)
    emb_np = emb_np / (norms + 1e-10)
    
    item_embeddings_tensor = torch.from_numpy(emb_np).to(device)
    print(f"  ✅ Item embeddings loaded: {item_embeddings_tensor.shape}")
    
    models_loaded = True
    print("🎉 All models loaded successfully!")

# ========== API Endpoints ==========

@app.get("/health")
async def health_check():
    return {"status": "ok", "models_loaded": models_loaded, "device": str(device)}

@app.post("/ann/retrieve", response_model=ANNResponse)
async def ann_retrieve(request: ANNRequest):
    """Two-Tower ANN 召回 (适配 TS Client)"""
    load_models_sync()
    
    if two_tower_model is None or item_embeddings_tensor is None:
        raise HTTPException(status_code=503, detail="Models not loaded")
    
    # Mapping: userId -> user_id, historyPostIds -> history_news_ids
    user_idx = user_vocab.get(request.userId, user_vocab.get("<UNK>", 1))
    
    # 尽可能映射，如果不在词表中则使用 UNK
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
        scores = torch.matmul(user_vec, item_embeddings_tensor.t())
        
        # User requested topK
        k = min(request.topK, scores.size(1))
        top_scores, top_indices = torch.topk(scores[0], k=k)
        
    candidates = []
    for score, idx in zip(top_scores.tolist(), top_indices.tolist()):
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

@app.post("/vf/check", response_model=VFResponse)
async def vf_check(request: VFRequest):
    """VF 安全内容过滤 (适配 TS Client)"""
    blocked_keywords = ["spam", "nsfw", "violence", "hate"]
    
    results = []
    for item in request.items:
        safe = True
        reason = None # Client expects optional string
        # 简单检查 ID 是否包含敏感词 (实际应检查内容)
        for keyword in blocked_keywords:
            if keyword in item.postId.lower():
                safe = False
                reason = f"Contains blocked keyword: {keyword}"
                break
        results.append({"postId": item.postId, "safe": safe, "reason": reason})
    
    return VFResponse(results=results)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
