"""
Phoenix 推荐系统 FastAPI 推理服务
提供以下 API:
- /ann/retrieve: Two-Tower ANN 召回 (FAISS 加速)
- /phoenix/predict: Phoenix Ranking 排序
- /vf/check: 安全内容过滤
"""

import json
import os
import pickle
import threading
import time
import uuid
from pathlib import Path
from typing import List, Optional, Literal, Callable, Any, Dict
from datetime import datetime, timezone, timedelta

import numpy as np
import torch
import faiss
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from pymongo import MongoClient
from pymongo.uri_parser import parse_uri
from bson import ObjectId

# ========== 配置 ==========
DATA_DIR = Path(__file__).parent / "data"
MODELS_DIR = Path(__file__).parent / "models"
SCRIPTS_DIR = Path(__file__).parent / "scripts"

# NOTE: 这里的默认值必须与训练/发布的 artifacts 匹配，否则会出现 state_dict shape mismatch。
# 你的当前 artifacts (2026-02-07_build01) 使用的是 768 维 embedding（见 scripts/train_two_tower.py / train_phoenix.py）。
EMBEDDING_DIM = int(os.getenv("TWO_TOWER_EMBEDDING_DIM", "768"))
PHOENIX_EMBEDDING_DIM = int(os.getenv("PHOENIX_EMBEDDING_DIM", str(EMBEDDING_DIM)))
PHOENIX_NUM_HEADS = int(os.getenv("PHOENIX_NUM_HEADS", "12"))
PHOENIX_NUM_LAYERS = int(os.getenv("PHOENIX_NUM_LAYERS", "12"))

# History 长度同样建议与训练对齐（训练默认 100），可通过环境变量覆盖。
MAX_HISTORY = int(os.getenv("TWO_TOWER_MAX_HISTORY", "100"))
PHOENIX_MAX_HISTORY = int(os.getenv("PHOENIX_MAX_HISTORY", "100"))

# FAISS 配置
FAISS_INDEX_TYPE = os.getenv("FAISS_INDEX_TYPE", "ivf_pq")  # 默认为我们生成的 ivf_pq
FAISS_NPROBE = int(os.getenv("FAISS_NPROBE", "16"))  # IVF 搜索时检查的聚类数
USE_FAISS = os.getenv("USE_FAISS", "true").lower() == "true"

# Industrial safety caps (avoid pathological inputs blowing up seq-len / runtime)
ANN_TOPK_CAP = int(os.getenv("ANN_TOPK_CAP", "400"))
VF_OVERSAMPLE_CAP = int(os.getenv("VF_OVERSAMPLE_CAP", "200"))

# ========== Observability ==========
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=os.getenv("SENTRY_ENVIRONMENT", os.getenv("ENVIRONMENT", "production")),
            release=os.getenv("SENTRY_RELEASE"),
            integrations=[FastApiIntegration()],
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.05") or "0.05"),
        )
        print("🛰️ Sentry enabled")
    except Exception as e:
        print(f"⚠️ Sentry init failed: {e}")

# 云端模型下载 (Render 部署必备)
# 注意：Render 部署时，本地没有 .pt 文件，需要从 Drive 自动下载。
# 请在 Render 环境变量中配置（支持自定义命名）：
# DRIVE_ID_TWO_TOWER / DRIVE_ID_TWO_TOWER_50 = "你的ModelFileID"
# DRIVE_ID_PHOENIX / DRIVE_ID_PHOENIX_3 = "你的ModelFileID"
DRIVE_ID_TWO_TOWER = os.getenv("DRIVE_ID_TWO_TOWER") or os.getenv("DRIVE_ID_TWO_TOWER_50", "")
DRIVE_ID_PHOENIX = os.getenv("DRIVE_ID_PHOENIX") or os.getenv("DRIVE_ID_PHOENIX_3", "")

# 工业级 artifacts: 推荐使用 GCS 版本化目录，而不是请求时从 Drive 下载大文件。
# - ARTIFACT_GCS_BUCKET: GCS bucket 名称
# - ARTIFACT_VERSION: 版本号目录（例如 2026-02-07_build01）
# - PRELOAD_MODELS_ON_STARTUP: 启动时预热加载，避免请求路径下载/加载
ARTIFACT_GCS_BUCKET = (
    os.getenv("ARTIFACT_GCS_BUCKET")
    or os.getenv("GCS_BUCKET")
    or os.getenv("GCS_ARTIFACT_BUCKET")
    or "telegram-467705-recsys"
)
ARTIFACT_VERSION = os.getenv("ARTIFACT_VERSION", "")
ARTIFACTS_FORCE_DOWNLOAD = os.getenv("ARTIFACTS_FORCE_DOWNLOAD", "false").lower() == "true"
ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST = os.getenv("ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST", "false").lower() == "true"
PRELOAD_MODELS_ON_STARTUP = os.getenv("PRELOAD_MODELS_ON_STARTUP", "true").lower() == "true"

# 行为日志归档 (Mongo -> GCS)
ARCHIVE_GCS_BUCKET = os.getenv("ARCHIVE_GCS_BUCKET") or ARTIFACT_GCS_BUCKET or os.getenv("GCS_BUCKET", "")
ARCHIVE_GCS_PREFIX = os.getenv("ARCHIVE_GCS_PREFIX", "archives/user_actions")

# 模型路径覆盖 (可选): 直接指定要加载的文件名或绝对路径
TWO_TOWER_MODEL_PATH = os.getenv("TWO_TOWER_MODEL_PATH", "")
PHOENIX_MODEL_PATH = os.getenv("PHOENIX_MODEL_PATH", "")

# 定时任务 / 外部调度
CRON_SECRET = os.getenv("CRON_SECRET", "")
ENABLE_INTERNAL_SCHEDULER = os.getenv("ENABLE_INTERNAL_SCHEDULER", "true").lower() == "true"

# 设备 (使用 CPU 保证稳定性)
device = torch.device("cpu")

# ========== Serving Behavior Flags ==========

# Preload externalId <-> PostId mapping at startup to remove Mongo round trips on the hot path.
PRELOAD_NEWS_MAPPING_ON_STARTUP = os.getenv("PRELOAD_NEWS_MAPPING_ON_STARTUP", "true").lower() == "true"

# Safety policy: industrially, OON should be stricter than in-network.
# - in-network: SAFE + LOW_RISK allowed by default
# - OON: only SAFE allowed by default
VF_IN_NETWORK_ALLOW_LOW_RISK = os.getenv("VF_IN_NETWORK_ALLOW_LOW_RISK", "true").lower() == "true"
VF_OON_ALLOW_LOW_RISK = os.getenv("VF_OON_ALLOW_LOW_RISK", "false").lower() == "true"

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

# 4. Combined Feed Recommend (single call: ANN + Rank + VF)
class FeedRecommendRequest(BaseModel):
    userId: str
    limit: int = 20
    cursor: Optional[str] = None
    request_id: Optional[str] = None
    in_network_only: bool = False
    is_bottom_request: bool = False
    inNetworkCandidateIds: List[str] = []
    seen_ids: List[str] = []
    served_ids: List[str] = []

class FeedRecommendItem(BaseModel):
    postId: str
    score: float
    inNetwork: bool
    safe: bool = True
    reason: Optional[str] = None

class FeedRecommendResponse(BaseModel):
    requestId: str
    candidates: List[FeedRecommendItem]

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
_job_state = {
    "refresh_features": False,
    "crawl": False,
    "archive_user_actions": False,
    "import_news_corpus": False,
}
_job_lock = threading.RLock()

# Best-effort progress snapshots for long-running jobs.
# This is intentionally in-memory (small scale). If you later need stronger guarantees:
# persist to Mongo (admin collection) or use Cloud Run Jobs.
_job_progress: Dict[str, Dict[str, Any]] = {
    "import_news_corpus": {
        "running": False,
        "startedAt": None,
        "updatedAt": None,
        "finishedAt": None,
        "offset": 0,
        "limit": None,
        "batchSize": None,
        "processed": 0,
        "inserted": 0,
        "total": None,
        "lastExternalId": None,
        "lastResult": None,
        "lastError": None,
    },
}


def _set_job_progress(job: str, **kwargs):
    with _job_lock:
        cur = _job_progress.get(job)
        if cur is None:
            cur = {}
            _job_progress[job] = cur
        cur.update(kwargs)
        cur["updatedAt"] = datetime.utcnow().isoformat()


def _get_job_progress(job: str) -> Dict[str, Any]:
    with _job_lock:
        return dict(_job_progress.get(job) or {})

# ========== Mongo (online serving helpers) ==========

_mongo_client: Optional[MongoClient] = None
_mongo_db = None

# ===== News Mapping Cache (externalId <-> Mongo _id) =====

_news_mapping_lock = threading.Lock()
_external_id_to_post_id_cache: Dict[str, str] = {}
_post_id_to_external_id_cache: Dict[str, str] = {}
_news_mapping_loaded = False
_news_mapping_loaded_at: Optional[str] = None


def _get_mongo_db():
    """
    Lazily create a MongoDB client for online serving.

    We intentionally keep this lightweight and optional:
    - If MONGODB_URI is missing, features that depend on Mongo will degrade.
    """
    global _mongo_client, _mongo_db
    if _mongo_db is not None:
        return _mongo_db

    mongo_uri = os.getenv("MONGODB_URI", "")
    if not mongo_uri:
        return None

    if _mongo_client is None:
        _mongo_client = MongoClient(
            mongo_uri,
            serverSelectionTimeoutMS=int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "3000")),
            connectTimeoutMS=int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "3000")),
        )

    try:
        parsed = parse_uri(mongo_uri)
        db_name = parsed.get("database") or os.getenv("MONGODB_DB") or os.getenv("MONGODB_DATABASE") or "test"
    except Exception:
        db_name = os.getenv("MONGODB_DB") or os.getenv("MONGODB_DATABASE") or "test"

    _mongo_db = _mongo_client[db_name]
    return _mongo_db


def _warm_news_post_mapping(force: bool = False) -> Dict[str, Any]:
    """
    Load externalId <-> PostId mapping into memory for fast serving.

    This is safe for small scale (O(50k) docs). If you later scale to millions:
    - build & publish a mapping artifact, or
    - use a dedicated KV store for ids.
    """
    global _news_mapping_loaded, _news_mapping_loaded_at

    db = _get_mongo_db()
    if db is None:
        return {"ok": False, "reason": "mongo_not_configured"}

    posts = db["posts"]

    with _news_mapping_lock:
        if _news_mapping_loaded and not force and _external_id_to_post_id_cache:
            return {
                "ok": True,
                "cached": True,
                "count": len(_external_id_to_post_id_cache),
                "loadedAt": _news_mapping_loaded_at,
            }

        _external_id_to_post_id_cache.clear()
        _post_id_to_external_id_cache.clear()

        cursor = posts.find(
            {
                "deletedAt": None,
                "isNews": True,
                "newsMetadata.externalId": {"$exists": True, "$ne": None},
            },
            {"_id": 1, "newsMetadata.externalId": 1},
        ).batch_size(5000)

        count = 0
        for d in cursor:
            meta = d.get("newsMetadata") or {}
            ext = meta.get("externalId")
            if not ext:
                continue
            ext = str(ext)
            pid = str(d.get("_id"))
            if not pid:
                continue
            _external_id_to_post_id_cache[ext] = pid
            _post_id_to_external_id_cache[pid] = ext
            count += 1

        _news_mapping_loaded = True
        _news_mapping_loaded_at = datetime.utcnow().isoformat()
        return {"ok": True, "cached": False, "count": count, "loadedAt": _news_mapping_loaded_at}


def _fetch_user_actions(user_id: str, limit: int = 50) -> List[dict]:
    db = _get_mongo_db()
    if db is None:
        return []
    actions = db["user_actions"]
    cursor = actions.find(
        {
            "userId": user_id,
            "action": {"$in": ["like", "reply", "repost", "click", "impression"]},
            "targetPostId": {"$exists": True, "$ne": None},
        },
        {"targetPostId": 1, "action": 1, "targetAuthorId": 1, "timestamp": 1},
    ).sort("timestamp", -1).limit(int(limit))

    out = []
    for doc in cursor:
        tpid = doc.get("targetPostId")
        out.append(
            {
                "targetPostId": str(tpid) if tpid is not None else None,
                "action": doc.get("action"),
                "targetAuthorId": doc.get("targetAuthorId"),
                "timestamp": doc.get("timestamp").isoformat() if doc.get("timestamp") else None,
            }
        )
    return out


def _fetch_posts_by_ids(post_ids: List[str], cursor_ms: Optional[int] = None) -> dict:
    """
    Fetch Post docs from Mongo. Returns mapping: postId(str) -> doc(dict).
    """
    db = _get_mongo_db()
    if db is None:
        return {}
    posts = db["posts"]

    obj_ids = []
    for pid in post_ids:
        try:
            obj_ids.append(ObjectId(pid))
        except Exception:
            continue

    if not obj_ids:
        return {}

    query = {
        "_id": {"$in": obj_ids},
        "deletedAt": None,
    }
    if cursor_ms is not None:
        # Mongo stores datetimes in UTC (naive). Use utcfromtimestamp for comparisons.
        query["createdAt"] = {"$lt": datetime.utcfromtimestamp(int(cursor_ms) / 1000.0)}

    docs = posts.find(
        query,
        {
            "_id": 1,
            "authorId": 1,
            "content": 1,
            "createdAt": 1,
            "isNews": 1,
            "newsMetadata": 1,
            "isReply": 1,
            "replyToPostId": 1,
            "isRepost": 1,
            "originalPostId": 1,
            "conversationId": 1,
            "isNsfw": 1,
            "engagementScore": 1,
        },
    )

    out = {}
    for d in docs:
        out[str(d["_id"])] = d
    return out


def _fetch_news_post_ids_by_external_ids(external_ids: List[str]) -> dict:
    """
    Map external corpus ids (e.g. MIND `news_id` like `N12345`) -> Mongo Post._id string.
    """
    ext_ids = [str(x) for x in (external_ids or []) if x]
    if not ext_ids:
        return {}

    # Fast path: in-memory cache
    out: dict = {}
    missing: List[str] = []
    if _external_id_to_post_id_cache:
        for ext in ext_ids:
            pid = _external_id_to_post_id_cache.get(ext)
            if pid:
                out[ext] = pid
            else:
                missing.append(ext)
    else:
        missing = ext_ids

    if not missing:
        return out

    db = _get_mongo_db()
    if db is None:
        return out
    posts = db["posts"]

    cursor = posts.find(
        {"newsMetadata.externalId": {"$in": missing}, "deletedAt": None},
        {"_id": 1, "newsMetadata.externalId": 1},
    )

    # Slow path: query Mongo and update cache best-effort
    for d in cursor:
        meta = d.get("newsMetadata") or {}
        ext = meta.get("externalId")
        if ext:
            ext_s = str(ext)
            pid = str(d["_id"])
            out[ext_s] = pid
            with _news_mapping_lock:
                _external_id_to_post_id_cache[ext_s] = pid
                _post_id_to_external_id_cache[pid] = ext_s
    return out


def _fetch_external_news_ids_for_post_ids(post_ids: List[str]) -> dict:
    """
    Map Mongo Post._id string -> external corpus id (newsMetadata.externalId), for model history.
    """
    # Fast path: cache
    out: dict = {}
    missing_obj: List[ObjectId] = []

    for pid in post_ids or []:
        pid_s = str(pid)
        ext = _post_id_to_external_id_cache.get(pid_s)
        if ext:
            out[pid_s] = ext
            continue
        try:
            missing_obj.append(ObjectId(pid_s))
        except Exception:
            continue

    if not missing_obj:
        return out

    db = _get_mongo_db()
    if db is None:
        return out
    posts = db["posts"]

    cursor = posts.find(
        {
            "_id": {"$in": missing_obj},
            "deletedAt": None,
            "isNews": True,
            "newsMetadata.externalId": {"$exists": True, "$ne": None},
        },
        {"_id": 1, "newsMetadata.externalId": 1},
    )

    for d in cursor:
        meta = d.get("newsMetadata") or {}
        ext = meta.get("externalId")
        if ext:
            pid_s = str(d["_id"])
            ext_s = str(ext)
            out[pid_s] = ext_s
            with _news_mapping_lock:
                _post_id_to_external_id_cache[pid_s] = ext_s
                _external_id_to_post_id_cache[ext_s] = pid_s
    return out


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

_gcs_client = None


def _get_gcs_bucket(bucket_name: str = ""):
    """
    Lazily create a GCS client and return the configured bucket (if any).
    """
    name = (bucket_name or ARTIFACT_GCS_BUCKET or "").strip()
    if not name:
        return None
    try:
        from google.cloud import storage
    except Exception as e:
        print(f"  ⚠️ google-cloud-storage not available: {e}")
        return None

    global _gcs_client
    if _gcs_client is None:
        _gcs_client = storage.Client()
    return _gcs_client.bucket(name)


def _download_gcs_blob(bucket, blob_name: str, dst: Path) -> bool:
    try:
        blob = bucket.blob(blob_name)
        if not blob.exists():
            return False
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        blob.download_to_filename(str(tmp))
        tmp.replace(dst)
        return True
    except Exception as e:
        print(f"  ⚠️ GCS download failed: {blob_name} -> {dst} ({e})")
        return False


def sync_artifacts_from_gcs_if_configured() -> bool:
    """
    Best-effort sync of versioned artifacts from GCS into local MODELS_DIR/DATA_DIR.
    This is intended to run at startup (pre-warm) and not on the request path.
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return False

    version = (ARTIFACT_VERSION or "").strip()
    if not version:
        return False

    marker = MODELS_DIR / ".artifact_version"
    if marker.exists() and not ARTIFACTS_FORCE_DOWNLOAD:
        try:
            if marker.read_text(encoding="utf-8").strip() == version:
                # Still verify required files exist; if not, continue to download missing ones.
                pass
        except Exception:
            pass

    required = [
        (f"artifacts/{version}/two_tower/model.pt", MODELS_DIR / "two_tower_epoch_latest.pt"),
        (f"artifacts/{version}/phoenix/model.pt", MODELS_DIR / "phoenix_epoch_latest.pt"),
        (f"artifacts/{version}/faiss/faiss_{FAISS_INDEX_TYPE}.index", MODELS_DIR / f"faiss_{FAISS_INDEX_TYPE}.index"),
        (f"artifacts/{version}/faiss/faiss_id_mapping.pkl", MODELS_DIR / "faiss_id_mapping.pkl"),
    ]

    optional = [
        (f"artifacts/{version}/data/news_vocab.pkl", DATA_DIR / "news_vocab.pkl"),
        (f"artifacts/{version}/data/user_vocab.pkl", DATA_DIR / "user_vocab.pkl"),
        (f"artifacts/{version}/data/item_embeddings.npy", DATA_DIR / "item_embeddings.npy"),
        # Optional corpus metadata (used by one-time import jobs, not required for serving)
        (f"artifacts/{version}/data/news_dict.pkl", DATA_DIR / "news_dict.pkl"),
    ]

    ok = True

    print(f"☁️ Syncing artifacts from GCS: gs://{bucket.name}/artifacts/{version}/ ...")

    for remote, local in required:
        if local.exists() and not ARTIFACTS_FORCE_DOWNLOAD:
            continue
        if not _download_gcs_blob(bucket, remote, local):
            print(f"  ⚠️ Missing required artifact in GCS: gs://{bucket.name}/{remote}")
            ok = False

    for remote, local in optional:
        if local.exists() and not ARTIFACTS_FORCE_DOWNLOAD:
            continue
        _download_gcs_blob(bucket, remote, local)

    if ok:
        try:
            marker.write_text(version, encoding="utf-8")
        except Exception:
            pass
        print(f"  ✅ Artifacts synced from GCS (version={version})")
    else:
        print(f"  ⚠️ Artifacts sync incomplete (version={version})")

    return ok


def load_models_sync(allow_download: bool = False):
    """同步加载模型"""
    global two_tower_model, phoenix_model, item_embeddings_tensor, faiss_index
    global news_vocab, user_vocab, news_id_to_idx, idx_to_news_id, models_loaded
    
    if models_loaded:
        return
    
    print("🚀 Loading models and indices...")
    # 0) 可选：启动/开发时先拉取 artifacts（GCS/Drive），保证 vocab/model/index 文件存在。
    # 工业级默认：请求路径不触发下载；由启动预热或发布流程保证文件存在。
    if allow_download:
        try:
            sync_artifacts_from_gcs_if_configured()
        except Exception as e:
            print(f"  ⚠️ GCS artifacts sync failed: {e}")

        # Drive 仅作为兼容后备（不推荐在生产长期使用）
        from scripts.download_utils import download_model_from_drive

        if DRIVE_ID_TWO_TOWER:
            two_tower_download_path = _resolve_download_target("two_tower", TWO_TOWER_MODEL_PATH)
            download_model_from_drive(DRIVE_ID_TWO_TOWER, two_tower_download_path)

        if DRIVE_ID_PHOENIX:
            phoenix_download_path = _resolve_download_target("phoenix", PHOENIX_MODEL_PATH)
            download_model_from_drive(DRIVE_ID_PHOENIX, phoenix_download_path)

    # 1) 加载词表（若容器镜像不包含 data/，上面的 GCS sync 也会把它们下载下来）
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
        num_heads=PHOENIX_NUM_HEADS,
        num_layers=PHOENIX_NUM_LAYERS
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
        "faiss_index_type": FAISS_INDEX_TYPE if faiss_index else None,
        "news_mapping_loaded": bool(_external_id_to_post_id_cache),
        "news_mapping_size": len(_external_id_to_post_id_cache),
        "news_mapping_loaded_at": _news_mapping_loaded_at,
    }

@app.post("/ann/retrieve", response_model=ANNResponse)
async def ann_retrieve(request: ANNRequest):
    """Two-Tower ANN 召回 (FAISS 加速版)"""
    load_models_sync(allow_download=ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST)
    
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
    load_models_sync(allow_download=ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST)
    
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

    # Guard: PhoenixRanker uses a fixed-size positional embedding (default 512).
    # If we pass too many candidates, seq_len will exceed position_embedding and crash.
    try:
        max_seq = int(getattr(getattr(phoenix_model, "position_embedding", None), "num_embeddings", 512))
    except Exception:
        max_seq = 512
    max_candidates = max(1, max_seq - int(PHOENIX_MAX_HISTORY))
    if len(candidate_ids) > max_candidates:
        candidate_ids = candidate_ids[:max_candidates]
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

# ========== Combined Feed Recommend ==========

def _related_post_ids_from_doc(doc: dict) -> List[str]:
    ids = []
    for k in ["_id", "originalPostId", "replyToPostId", "conversationId"]:
        v = doc.get(k)
        if v is None:
            continue
        try:
            ids.append(str(v))
        except Exception:
            continue
    # Preserve order, remove duplicates
    out = []
    seen = set()
    for i in ids:
        if not i or i in seen:
            continue
        seen.add(i)
        out.append(i)
    return out


def _datetime_to_epoch_ms(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
        # PyMongo returns naive UTC datetimes by default. Treat naive as UTC to avoid local-time skew.
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    try:
        # best-effort: parse ISO string
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _weighted_score_from_prediction(pred: dict, in_network: bool) -> float:
    # Align with backend WeightedScorer weights (subset: like/reply/repost/click)
    like = float(pred.get("like", 0.0) or 0.0)
    reply = float(pred.get("reply", 0.0) or 0.0)
    repost = float(pred.get("repost", 0.0) or 0.0)
    click = float(pred.get("click", 0.0) or 0.0)
    dismiss = float(pred.get("dismiss", 0.0) or 0.0)
    block = float(pred.get("block", 0.0) or 0.0)

    score = like * 2.0 + reply * 5.0 + repost * 4.0 + click * 0.5
    score += dismiss * -5.0 + block * -10.0

    if not in_network:
        score *= 0.7
    return max(0.0, score)

def _vf_allowed_for_surface(vf_res, in_network: bool) -> bool:
    """
    Surface-aware safety policy:
    - in-network: allow SAFE and optionally LOW_RISK (default on)
    - OON: allow SAFE and optionally LOW_RISK (default off, stricter)
    """
    if vf_res is None:
        return False

    safe = bool(getattr(vf_res, "safe", False))
    if not safe:
        return False

    level = getattr(vf_res, "level", None)
    level_value = getattr(level, "value", None)
    if level_value is None:
        level_value = str(level) if level is not None else ""
    level_value = str(level_value)

    if not level_value:
        # Unknown levels: do not over-block in small scale; rely on `safe` bool.
        return True

    if in_network:
        if level_value == "safe":
            return True
        if level_value == "low_risk":
            return bool(VF_IN_NETWORK_ALLOW_LOW_RISK)
        return False

    # OON
    if level_value == "safe":
        return True
    if level_value == "low_risk":
        return bool(VF_OON_ALLOW_LOW_RISK)
    return False


@app.post("/feed/recommend", response_model=FeedRecommendResponse)
async def feed_recommend(request: FeedRecommendRequest):
    """
    Single-call endpoint to reduce cross-region round trips:
    - ANN retrieval (OON) via Two-Tower + FAISS
    - Phoenix ranking (multi-action probabilities)
    - VF safety filtering (post-selection), with degrade policy on VF failure
    """
    req_id = request.request_id or f"{uuid.uuid4()}-{request.userId}"

    models_available = True
    try:
        load_models_sync(allow_download=ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST)
    except Exception as e:
        print(f"⚠️ [feed/recommend] Model load failed, degrade to rules/in-network: {e}")
        models_available = False

    # Cursor support (optional, keeps pagination roughly consistent with backend cursor-based scroll)
    cursor_ms: Optional[int] = None
    if request.cursor:
        try:
            cursor_ms = int(datetime.fromisoformat(request.cursor.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            cursor_ms = None

    # 1) Build user history for retrieval/ranking (prefer Mongo, fall back to empty)
    user_actions = _fetch_user_actions(request.userId, limit=PHOENIX_MAX_HISTORY)
    raw_history_post_ids = [
        str(a.get("targetPostId"))
        for a in user_actions
        if a.get("targetPostId") is not None
    ]

    # Our production `targetPostId` is a Mongo ObjectId string. Two-Tower/Phoenix vocab uses
    # external corpus ids (e.g. MIND `N12345`). Map Post._id -> externalId for *news* actions.
    post_to_external = _fetch_external_news_ids_for_post_ids(raw_history_post_ids)

    history_post_ids: List[str] = []
    model_action_sequence: List[dict] = []
    for a in user_actions:
        pid = a.get("targetPostId")
        if pid is None:
            continue
        ext = post_to_external.get(str(pid))
        if not ext:
            continue
        history_post_ids.append(str(ext))
        model_action = dict(a)
        model_action["targetPostId"] = str(ext)
        model_action_sequence.append(model_action)

    history_post_ids = history_post_ids[:MAX_HISTORY]
    model_action_sequence = model_action_sequence[:PHOENIX_MAX_HISTORY]

    # 2) Retrieval (OON) unless in_network_only
    oon_ids: List[str] = []
    if not request.in_network_only and models_available:
        try:
            # Retrieval oversampling cap: keep within a safe budget so downstream
            # Phoenix positional embeddings (512) won't overflow.
            ann_topk = max(200, int(request.limit) * 10)
            ann_topk = min(ann_topk, max(200, int(ANN_TOPK_CAP)))
            ann_resp = await ann_retrieve(
                ANNRequest(
                    userId=request.userId,
                    historyPostIds=history_post_ids,
                    keywords=[],
                    topK=ann_topk,
                )
            )
            oon_external_ids = [c.postId for c in ann_resp.candidates]

            # Map external ids -> Mongo Post._id strings so backend can hydrate content.
            external_to_post = _fetch_news_post_ids_by_external_ids(oon_external_ids)
            oon_ids = [external_to_post.get(x) for x in oon_external_ids if external_to_post.get(x)]
        except Exception as e:
            # Retrieval failure: degrade to in-network only
            print(f"⚠️ [feed/recommend] ANN retrieval failed: {e}")
            oon_ids = []

    # 3) Merge candidates (in-network first, then OON), then fetch post docs
    in_network_set = set(map(str, request.inNetworkCandidateIds or []))
    merged_ids: List[str] = []
    seen_merge = set()
    for pid in (request.inNetworkCandidateIds or []) + (oon_ids or []):
        pid = str(pid)
        if not pid or pid in seen_merge:
            continue
        seen_merge.add(pid)
        merged_ids.append(pid)

    posts_by_id = _fetch_posts_by_ids(merged_ids, cursor_ms=cursor_ms)

    # 4) Seen/Served filtering using related IDs
    seen_ids = set(map(str, request.seen_ids or []))
    served_ids = set(map(str, request.served_ids or [])) if request.is_bottom_request else set()

    filtered_ids: List[str] = []
    dedup_related = set()
    for pid in merged_ids:
        doc = posts_by_id.get(pid)
        if not doc:
            continue
        related = _related_post_ids_from_doc(doc)
        if any(rid in seen_ids for rid in related):
            continue
        if served_ids and any(rid in served_ids for rid in related):
            continue
        # Cross-candidate related-ID dedup (keep highest-score later)
        if any(rid in dedup_related for rid in related):
            continue
        dedup_related.update(related)
        filtered_ids.append(pid)

    if not filtered_ids:
        return FeedRecommendResponse(requestId=req_id, candidates=[])

    # 5) Ranking (Phoenix for news items with externalId). For non-news items (or when Phoenix fails),
    # fall back to engagementScore + recency.
    scored: List[dict] = []
    pred_map = {}
    phoenix_ok = False

    now_ms = int(time.time() * 1000)

    # Only score news posts that have `newsMetadata.externalId` with Phoenix.
    phoenix_candidates: List[PhoenixCandidatePayload] = []
    phoenix_max_seq = 512
    try:
        if phoenix_model is not None:
            phoenix_max_seq = int(getattr(getattr(phoenix_model, "position_embedding", None), "num_embeddings", 512))
    except Exception:
        phoenix_max_seq = 512
    phoenix_max_candidates = max(1, phoenix_max_seq - int(PHOENIX_MAX_HISTORY))

    # If we have a lot of news candidates, only send a top slice into Phoenix to avoid seq-len overflow.
    # For the remainder, we fall back to the rule score (industrial degrade).
    phoenix_pool: List[tuple] = []
    for pid in filtered_ids:
        doc = posts_by_id.get(pid, {}) or {}
        meta = doc.get("newsMetadata") or {}
        ext = meta.get("externalId")
        if not ext:
            continue

        engagement = float(doc.get("engagementScore") or 0.0)
        created_ms = _datetime_to_epoch_ms(doc.get("createdAt"))
        if created_ms is not None:
            age_ms = max(0, now_ms - created_ms)
            half_life_ms = 6 * 60 * 60 * 1000
            decay = 0.5 ** (age_ms / float(half_life_ms))
            recency = 0.8 + (1.5 - 0.8) * decay
        else:
            recency = 1.0
        seed = engagement * recency
        phoenix_pool.append((seed, pid, str(ext), str(doc.get("authorId") or "")))

    phoenix_pool.sort(key=lambda x: x[0], reverse=True)
    phoenix_pool = phoenix_pool[:phoenix_max_candidates]

    for _, _pid, ext, author_id in phoenix_pool:
        phoenix_candidates.append(
            PhoenixCandidatePayload(
                postId=ext,
                authorId=author_id,
                inNetwork=False,
                hasVideo=False,
            )
        )

    if models_available and phoenix_candidates:
        try:
            phx_req = PhoenixRequest(
                userId=request.userId,
                userActionSequence=model_action_sequence,
                candidates=phoenix_candidates,
            )
            phx_resp = await phoenix_predict(phx_req)
            pred_map = {p.postId: p.model_dump() for p in phx_resp.predictions}
            phoenix_ok = True
        except Exception as e:
            print(f"⚠️ [feed/recommend] Phoenix ranking failed, fallback to rules: {e}")
            pred_map = {}
            phoenix_ok = False

    for pid in filtered_ids:
        doc = posts_by_id.get(pid, {}) or {}
        in_net = pid in in_network_set
        meta = doc.get("newsMetadata") or {}
        ext = meta.get("externalId")

        if ext and phoenix_ok:
            pred = pred_map.get(str(ext))
            if pred is not None:
                score = _weighted_score_from_prediction(pred, in_net)
                scored.append({"postId": pid, "score": float(score), "inNetwork": in_net})
                continue

        # Rule fallback (used for in-network social posts and as Phoenix degrade).
        engagement = float(doc.get("engagementScore") or 0.0)
        created_at = doc.get("createdAt")
        created_ms = _datetime_to_epoch_ms(created_at)
        if created_ms is not None:
            age_ms = max(0, now_ms - created_ms)
            half_life_ms = 6 * 60 * 60 * 1000
            decay = 0.5 ** (age_ms / float(half_life_ms))
            recency = 0.8 + (1.5 - 0.8) * decay
        else:
            recency = 1.0
        score = max(0.0, engagement * recency) * (1.0 if in_net else 0.7)
        scored.append({"postId": pid, "score": float(score), "inNetwork": in_net})

    scored.sort(key=lambda x: x["score"], reverse=True)

    # 6) Post-selection VF (run on oversampled topN). Degrade if VF unavailable.
    vf_cap = max(50, int(VF_OVERSAMPLE_CAP))
    oversample_n = min(len(scored), min(vf_cap, max(50, int(request.limit) * 5)))
    top_scored = scored[:oversample_n]

    safety_service = None
    try:
        safety_service = get_safety_service()
    except Exception as e:
        print(f"⚠️ [feed/recommend] Safety service init failed: {e}")
        safety_service = None

    safe_items: List[FeedRecommendItem] = []
    if safety_service is None:
        # Degrade: only in-network
        for item in top_scored:
            if item["inNetwork"]:
                safe_items.append(FeedRecommendItem(**item, safe=True))
    else:
        try:
            for item in top_scored:
                pid = item["postId"]
                doc = posts_by_id.get(pid, {})
                content = doc.get("content") or pid
                vf_res = safety_service.check(content=content, user_id=request.userId)
                if _vf_allowed_for_surface(vf_res, in_network=bool(item.get("inNetwork"))):
                    safe_items.append(FeedRecommendItem(**item, safe=True))
                # unsafe items are dropped
        except Exception as e:
            print(f"⚠️ [feed/recommend] VF failed, degrade to in-network: {e}")
            safe_items = [FeedRecommendItem(**it, safe=True) for it in top_scored if it["inNetwork"]]

    safe_items = safe_items[: int(request.limit)]
    return FeedRecommendResponse(requestId=req_id, candidates=safe_items)

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

    # Cloud Run does not reliably run background threads after the HTTP response is returned
    # unless "CPU always allocated" is enabled. For industrial-grade scheduled jobs, run
    # synchronously within the request and rely on Cloud Scheduler attempt-deadline.
    with _job_lock:
        if _job_state.get("refresh_features"):
            raise HTTPException(status_code=409, detail="refresh_features job is already running")
        _job_state["refresh_features"] = True

    started = time.time()
    try:
        from scripts.refresh_features import run_refresh_features_job

        result = run_refresh_features_job(
            days=days,
            max_users=max_users,
            max_history=max_history,
            batch_size=batch_size,
            rebuild_faiss=rebuild_faiss,
            filter_users_from_postgres=filter_users_from_postgres,
        )
        duration_ms = int((time.time() - started) * 1000)
        return {"status": "ok", "durationMs": duration_ms, **(result or {})}
    finally:
        with _job_lock:
            _job_state["refresh_features"] = False


@app.post("/jobs/crawl")
def crawl_job(request: Request):
    """触发新闻爬取（由 Cloud Scheduler 调用）"""
    _require_cron_auth(request)

    # Cloud Run does not reliably run background threads after the HTTP response is returned
    # unless "CPU always allocated" is enabled. To make hourly crawl industrial-grade, we
    # run the job synchronously within the request and return a summary.
    with _job_lock:
        if _job_state.get("crawl"):
            raise HTTPException(status_code=409, detail="crawl job is already running")
        _job_state["crawl"] = True

    started = time.time()
    try:
        result = run_crawler_job()
        duration_ms = int((time.time() - started) * 1000)
        return {"status": "ok", "durationMs": duration_ms, **(result or {})}
    finally:
        with _job_lock:
            _job_state["crawl"] = False


@app.get("/jobs/crawl/status")
def crawl_status(request: Request):
    """返回最近一次新闻爬取的结果摘要（用于排障/可观测性）"""
    _require_cron_auth(request)
    try:
        from crawler.news_fetcher import LAST_CRAWL_PATH

        if LAST_CRAWL_PATH.exists():
            with open(LAST_CRAWL_PATH, "r", encoding="utf-8") as f:
                return {"status": "ok", "last": json.load(f)}
        return {"status": "ok", "last": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to read crawl status: {e}")


def _archive_user_actions_to_gcs(days: int = 7, dry_run: bool = False) -> dict:
    db = _get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="MONGODB_URI not configured")

    if not ARCHIVE_GCS_BUCKET:
        raise HTTPException(status_code=500, detail="ARCHIVE_GCS_BUCKET not configured")

    bucket = _get_gcs_bucket(ARCHIVE_GCS_BUCKET)
    if bucket is None:
        raise HTTPException(status_code=500, detail="GCS client not available")

    days_i = max(1, int(days))
    since = datetime.now(timezone.utc) - timedelta(days=days_i)
    since_naive = since.replace(tzinfo=None)

    actions = db["user_actions"]
    cursor = actions.find(
        {"timestamp": {"$gte": since_naive}},
        {
            "_id": 1,
            "userId": 1,
            "action": 1,
            "targetPostId": 1,
            "targetAuthorId": 1,
            "timestamp": 1,
            "productSurface": 1,
            "requestId": 1,
        },
    ).sort("timestamp", 1)

    import gzip
    import tempfile

    writers = {}  # (y, m, d) -> (file_path, gzip_file, count)

    total = 0
    for doc in cursor:
        ts = doc.get("timestamp")
        if isinstance(ts, datetime) and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if not isinstance(ts, datetime):
            continue

        y, m, d = ts.year, ts.month, ts.day
        key = (y, m, d)
        if key not in writers:
            tmp = tempfile.NamedTemporaryFile(prefix=f"user_actions_{y}{m:02d}{d:02d}_", suffix=".jsonl.gz", delete=False)
            tmp_path = Path(tmp.name)
            tmp.close()
            gz = gzip.open(tmp_path, "wt", encoding="utf-8")
            writers[key] = [tmp_path, gz, 0]

        tmp_path, gz, cnt = writers[key]

        line = {
            "id": str(doc.get("_id")) if doc.get("_id") is not None else None,
            "userId": doc.get("userId"),
            "action": doc.get("action"),
            "targetPostId": str(doc.get("targetPostId")) if doc.get("targetPostId") is not None else None,
            "targetAuthorId": doc.get("targetAuthorId"),
            "timestamp": ts.isoformat(),
            "productSurface": doc.get("productSurface"),
            "requestId": doc.get("requestId"),
        }

        gz.write(json.dumps(line, ensure_ascii=False) + "\n")
        writers[key][2] = cnt + 1
        total += 1

    objects = []
    by_day = {}

    for (y, m, d), (tmp_path, gz, cnt) in writers.items():
        try:
            gz.close()
        except Exception:
            pass

        by_day[f"{y:04d}-{m:02d}-{d:02d}"] = int(cnt)

        object_name = (
            f"{ARCHIVE_GCS_PREFIX}/yyyy={y:04d}/mm={m:02d}/dd={d:02d}/"
            f"user_actions_{y:04d}{m:02d}{d:02d}_{int(time.time())}_{uuid.uuid4().hex}.jsonl.gz"
        )

        if dry_run:
            objects.append({"object": object_name, "count": int(cnt), "dry_run": True})
            continue

        blob = bucket.blob(object_name)
        blob.upload_from_filename(str(tmp_path), content_type="application/gzip")
        objects.append({"object": object_name, "count": int(cnt)})

        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    return {"archived": total, "objects": objects, "by_day": by_day, "since": since.isoformat(), "dry_run": bool(dry_run)}


def _load_news_dict_from_artifacts() -> dict:
    """
    Load `news_dict.pkl` (external corpus metadata) from local DATA_DIR.
    If missing, best-effort sync from GCS artifacts first.
    """
    path = DATA_DIR / "news_dict.pkl"
    if not path.exists():
        try:
            sync_artifacts_from_gcs_if_configured()
        except Exception:
            pass
    if not path.exists():
        raise HTTPException(
            status_code=500,
            detail=(
                "news_dict.pkl not found. Upload it to "
                f"gs://{ARTIFACT_GCS_BUCKET}/artifacts/{ARTIFACT_VERSION}/data/news_dict.pkl "
                "and redeploy (or trigger this job again)."
            ),
        )
    with open(path, "rb") as f:
        return pickle.load(f)


def _infer_import_anchor_datetime() -> datetime:
    """
    Use a stable anchor time so that chunked imports create deterministic `createdAt` ordering.
    Preferred: the YYYY-MM-DD prefix in ARTIFACT_VERSION (e.g. 2026-02-07_build01).
    Fallback: current UTC time.
    """
    try:
        ver = (ARTIFACT_VERSION or "").strip()
        if len(ver) >= 10 and ver[4] == "-" and ver[7] == "-":
            y = int(ver[0:4])
            m = int(ver[5:7])
            d = int(ver[8:10])
            return datetime(y, m, d)  # naive UTC-like timestamp (Mongo stores UTC)
    except Exception:
        pass
    return datetime.utcnow()


def _get_news_dict_total_if_present() -> Optional[int]:
    """
    Fast-ish: return total items in news_dict if present locally.
    We avoid triggering artifact sync in status endpoints.
    """
    path = DATA_DIR / "news_dict.pkl"
    if not path.exists():
        return None
    try:
        with open(path, "rb") as f:
            obj = pickle.load(f)
        return int(len(obj)) if isinstance(obj, dict) else None
    except Exception:
        return None


def _import_news_corpus_to_mongo(
    max_items: Optional[int] = None,
    batch_size: int = 500,
    dry_run: bool = False,
    offset: int = 0,
    progress_cb: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> dict:
    """
    One-time corpus import:
    - Reads external corpus metadata (e.g. MIND `news_dict.pkl`)
    - Upserts into Mongo `posts` as `isNews=true` with `newsMetadata.externalId = news_id`
    """
    db = _get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="MONGODB_URI not configured")
    posts = db["posts"]

    # Ensure lookup index exists for fast ANN externalId -> Post._id mapping.
    try:
        posts.create_index([("newsMetadata.externalId", 1)], unique=True, sparse=True, name="news_external_id_uq")
    except Exception as e:
        print(f"⚠️ [import-news-corpus] create_index(newsMetadata.externalId) failed: {e}")

    news_dict = _load_news_dict_from_artifacts()
    if not isinstance(news_dict, dict):
        raise HTTPException(status_code=500, detail="news_dict.pkl is not a dict")

    total = int(len(news_dict))
    offset_n = max(0, int(offset or 0))
    offset_n = min(offset_n, total)
    # Back-compat: max_items behaves like a per-call LIMIT (from the start when offset=0).
    limit_n = int(max_items) if max_items is not None else (total - offset_n)
    limit_n = max(0, min(limit_n, total - offset_n))
    bs = max(50, int(batch_size) if batch_size else 500)

    if dry_run:
        return {
            "dry_run": True,
            "total": total,
            "offset": offset_n,
            "limit": limit_n,
            "would_import": limit_n,
            "batch_size": bs,
            "next_offset": offset_n + limit_n,
            "done": bool(offset_n + limit_n >= total),
        }

    from pymongo import UpdateOne

    # Short-circuit if corpus is already fully imported (common when curl disconnects and user retries).
    existing_before = int(
        posts.count_documents({"isNews": True, "newsMetadata.externalId": {"$exists": True}})
    )
    if offset_n == 0 and limit_n >= total and existing_before >= total:
        return {
            "dry_run": False,
            "already_imported": True,
            "total": total,
            "existing_before": existing_before,
            "offset": offset_n,
            "limit": limit_n,
            "imported": 0,
            "inserted": 0,
            "batch_size": bs,
            "next_offset": total,
            "done": True,
        }

    anchor = _infer_import_anchor_datetime()
    ops = []
    inserted = 0
    processed = 0

    # Deterministic iteration for repeatability.
    sorted_keys = sorted(news_dict.keys(), key=lambda k: str(k))
    end = min(total, offset_n + limit_n)
    for global_idx in range(offset_n, end):
        external_id = sorted_keys[global_idx]
        info = news_dict.get(external_id)
        processed += 1

        try:
            external_id = str(external_id)
        except Exception:
            continue
        if not external_id:
            continue

        meta = info if isinstance(info, dict) else {}
        title = (meta.get("title") or "").strip() or f"News {external_id}"
        abstract = (meta.get("abstract") or "").strip()
        source_url = (meta.get("url") or meta.get("source_url") or "").strip()

        # Keep the canonical URL field unique/stable for Mongo index safety.
        stable_url = f"mind://{external_id}"

        content = f"# {title}\n\n{abstract}".strip()
        if source_url:
            content += f"\n\n**[阅读原文 / Read Original]({source_url})**"

        # Space feed expects these core fields.
        doc = {
            "authorId": "news_bot_official",
            "content": content,
            "media": [],
            "stats": {"likeCount": 0, "repostCount": 0, "quoteCount": 0, "commentCount": 0, "viewCount": 0},
            "isRepost": False,
            "isReply": False,
            "keywords": [],
            "isNsfw": False,
            "isPinned": False,
            "engagementScore": 0.0,
            "isNews": True,
            "newsMetadata": {
                "title": title,
                "source": "mind",
                "url": stable_url,
                "sourceUrl": source_url or None,
                "externalId": external_id,
                "summary": abstract[:800] if abstract else None,
            },
            # Spread timestamps slightly so cursor pagination stays stable.
            "createdAt": anchor - timedelta(milliseconds=global_idx),
            "updatedAt": anchor - timedelta(milliseconds=global_idx),
            "deletedAt": None,
        }

        ops.append(
            UpdateOne(
                {"newsMetadata.externalId": external_id},
                {"$setOnInsert": doc},
                upsert=True,
            )
        )

        if len(ops) >= bs:
            res = posts.bulk_write(ops, ordered=False)
            inserted += int(getattr(res, "upserted_count", 0) or 0)
            ops = []
            if progress_cb:
                progress_cb(
                    {
                        "processed": processed,
                        "inserted": inserted,
                        "lastExternalId": external_id,
                        "total": total,
                        "offset": offset_n,
                        "limit": limit_n,
                        "next_offset": offset_n + processed,
                        "done": bool(offset_n + processed >= total),
                    }
                )

    if ops:
        res = posts.bulk_write(ops, ordered=False)
        inserted += int(getattr(res, "upserted_count", 0) or 0)

    if progress_cb:
        progress_cb(
            {
                "processed": processed,
                "inserted": inserted,
                "lastExternalId": str(sorted_keys[min(end - 1, total - 1)]) if processed > 0 else None,
                "total": total,
                "offset": offset_n,
                "limit": limit_n,
                "next_offset": offset_n + processed,
                "done": bool(offset_n + processed >= total),
            }
        )

    # Best-effort: refresh in-memory mapping after import so serving path can avoid Mongo lookups.
    if inserted > 0:
        try:
            _warm_news_post_mapping(force=True)
        except Exception as e:
            print(f"⚠️ [import-news-corpus] warm mapping failed: {e}")

    return {
        "dry_run": False,
        "total": total,
        "existing_before": existing_before,
        "offset": offset_n,
        "limit": limit_n,
        "imported": processed,
        "inserted": inserted,
        "batch_size": bs,
        "next_offset": offset_n + processed,
        "done": bool(offset_n + processed >= total),
    }


@app.post("/jobs/archive-user-actions")
def archive_user_actions_job(request: Request, days: int = 7, dry_run: bool = False):
    """归档 Mongo user_actions 到 GCS（按日期分区 JSONL.GZ）"""
    _require_cron_auth(request)

    with _job_lock:
        if _job_state.get("archive_user_actions"):
            raise HTTPException(status_code=409, detail="archive_user_actions job is already running")
        _job_state["archive_user_actions"] = True

    started = time.time()
    try:
        result = _archive_user_actions_to_gcs(days=days, dry_run=dry_run)
        duration_ms = int((time.time() - started) * 1000)
        return {"status": "ok", "durationMs": duration_ms, **(result or {})}
    finally:
        with _job_lock:
            _job_state["archive_user_actions"] = False


@app.post("/jobs/import-news-corpus")
def import_news_corpus_job(
    request: Request,
    max_items: Optional[int] = None,
    offset: int = 0,
    batch_size: int = 500,
    dry_run: bool = False,
):
    """
    Import an external news corpus (e.g. MIND) into Mongo `posts` so that:
    - Two-Tower/Phoenix outputs (externalId) can be mapped to Post._id
    - Backend can hydrate and serve the recommended items
    """
    _require_cron_auth(request)

    with _job_lock:
        if _job_state.get("import_news_corpus"):
            raise HTTPException(status_code=409, detail="import_news_corpus job is already running")
        _job_state["import_news_corpus"] = True
        _set_job_progress(
            "import_news_corpus",
            running=True,
            startedAt=datetime.utcnow().isoformat(),
            finishedAt=None,
            lastError=None,
            lastResult=None,
            offset=int(offset or 0),
            limit=int(max_items) if max_items is not None else None,
            batchSize=int(batch_size) if batch_size else None,
            processed=0,
            inserted=0,
            total=_get_news_dict_total_if_present(),
            lastExternalId=None,
        )

    started = time.time()
    try:
        def _progress_cb(update: Dict[str, Any]):
            # Called after each bulk_write so operators can poll status
            _set_job_progress("import_news_corpus", **(update or {}), running=True)

        result = _import_news_corpus_to_mongo(
            max_items=max_items,
            offset=offset,
            batch_size=batch_size,
            dry_run=dry_run,
            progress_cb=_progress_cb,
        )
        duration_ms = int((time.time() - started) * 1000)
        _set_job_progress(
            "import_news_corpus",
            running=False,
            finishedAt=datetime.utcnow().isoformat(),
            lastResult={"status": "ok", "durationMs": duration_ms, **(result or {})},
        )
        return {"status": "ok", "durationMs": duration_ms, **(result or {})}
    except Exception as e:
        _set_job_progress(
            "import_news_corpus",
            running=False,
            finishedAt=datetime.utcnow().isoformat(),
            lastError=str(e),
        )
        raise
    finally:
        with _job_lock:
            _job_state["import_news_corpus"] = False
            # If the request was aborted but the finally runs, ensure we don't leave a stale running=true.
            cur = _get_job_progress("import_news_corpus")
            if cur.get("running"):
                _set_job_progress("import_news_corpus", running=False, finishedAt=datetime.utcnow().isoformat())


@app.get("/jobs/import-news-corpus/status")
def import_news_corpus_status(request: Request):
    """
    Operator endpoint: check whether the import job is running and current DB coverage.
    Useful when clients disconnect (curl "Empty reply") but the job continues server-side.
    """
    _require_cron_auth(request)

    db = _get_mongo_db()
    external_news_count = None
    if db is not None:
        try:
            external_news_count = int(
                db["posts"].count_documents({"isNews": True, "newsMetadata.externalId": {"$exists": True}})
            )
        except Exception:
            external_news_count = None

    progress = _get_job_progress("import_news_corpus")
    total = progress.get("total")
    if total is None:
        total = _get_news_dict_total_if_present()

    return {
        "status": "ok",
        "artifactVersion": ARTIFACT_VERSION or None,
        "running": bool(progress.get("running")),
        "progress": progress,
        "db": {"externalNewsCount": external_news_count},
        "corpus": {"total": total, "present": bool((DATA_DIR / "news_dict.pkl").exists())},
    }

# ========== 定时任务 (News Crawler) ==========
from apscheduler.schedulers.background import BackgroundScheduler
from crawler.news_fetcher import NewsCrawler

_crawler_singleton: Optional[NewsCrawler] = None


def _get_crawler_singleton() -> NewsCrawler:
    # Model/session init can be slow on cold starts. Reuse a single crawler instance
    # per process for predictable latency in Cloud Scheduler calls.
    global _crawler_singleton
    if _crawler_singleton is None:
        _crawler_singleton = NewsCrawler()
    return _crawler_singleton

scheduler = None

def run_crawler_job():
    """Wrapper to run crawler job safely"""
    print("⏰ [Scheduler] Starting hourly news crawl...")
    try:
        crawler = _get_crawler_singleton()
        result = crawler.run_job()
        if isinstance(result, dict):
            print(f"✅ [Scheduler] Crawl done: fetched={result.get('fetched_count')} clustered={result.get('clustered_count')} pushed={result.get('pushed_count')}")
        return result if isinstance(result, dict) else {}
    except Exception as e:
        print(f"❌ [Scheduler] Crawler failed: {e}")
        return {"error": str(e)}

@app.on_event("startup")
def preload_artifacts_and_models():
    """
    Industrial-grade warmup:
    - Sync versioned artifacts from GCS (if configured)
    - Load models/indices once at startup to avoid request-path downloads
    """
    try:
        if ARTIFACT_GCS_BUCKET and ARTIFACT_VERSION:
            sync_artifacts_from_gcs_if_configured()
    except Exception as e:
        print(f"⚠️ [Startup] Artifact sync failed: {e}")

    if not PRELOAD_MODELS_ON_STARTUP:
        print("⏭️ [Startup] PRELOAD_MODELS_ON_STARTUP disabled")
        return

    try:
        load_models_sync(allow_download=True)
    except Exception as e:
        # Do not crash the process: /feed/recommend has a degrade path.
        print(f"⚠️ [Startup] Model preload failed (service will degrade): {e}")

    # Optional warmup: preload externalId <-> PostId mapping to avoid Mongo round trips on serving path.
    if PRELOAD_NEWS_MAPPING_ON_STARTUP:
        try:
            r = _warm_news_post_mapping(force=False)
            if r.get("ok"):
                print(f"  ✅ News mapping ready: {r.get('count')} items (cached={r.get('cached')})")
            else:
                print(f"  ⚠️ News mapping warmup skipped: {r.get('reason')}")
        except Exception as e:
            print(f"  ⚠️ News mapping warmup failed: {e}")

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
