"""特征刷新服务：写入用户向量及其契约元数据，并按需重建投影空间一致的 FAISS 索引。"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch
from bson import ObjectId
from pymongo import MongoClient, UpdateOne

from recsys.contracts.ann import build_user_embedding_contract, infer_id_namespace, resolve_embedding_space

try:
    import psycopg2
except Exception:
    psycopg2 = None


def _load_mongo() -> Tuple[MongoClient, object]:
    mongo_uri = os.getenv("MONGODB_URI", "")
    if not mongo_uri:
        raise RuntimeError("MONGODB_URI 未配置")

    client = MongoClient(mongo_uri)
    db = client.get_default_database()
    if db is None:
        db_name = os.getenv("MONGODB_DB_NAME", "") or os.getenv("MONGODB_DB", "")
        if not db_name:
            raise RuntimeError("MONGODB_DB_NAME 未配置且 URI 中无默认库名")
        db = client[db_name]
    return client, db


def _load_postgres_user_ids(
    limit: Optional[int] = None,
    only_active_since: Optional[datetime] = None,
) -> Optional[set]:
    if psycopg2 is None:
        return None

    pg_url = os.getenv("DATABASE_URL", "")
    if not pg_url:
        return None

    conn = psycopg2.connect(pg_url)
    try:
        cur = conn.cursor()
        if only_active_since is not None:
            query = 'SELECT id FROM users WHERE "lastSeen" >= %s'
            params: Tuple[Any, ...] = (only_active_since,)
        else:
            query = "SELECT id FROM users"
            params = ()

        if limit:
            query += " LIMIT %s"
            params = (*params, limit)

        cur.execute(query, params)
        rows = cur.fetchall()
        return {r[0] for r in rows}
    finally:
        conn.close()


def _fetch_active_user_ids(actions_col, since: datetime, limit: Optional[int]) -> List[str]:
    query = {"timestamp": {"$gte": since}}
    user_ids = actions_col.distinct("userId", query)
    if limit:
        user_ids = user_ids[:limit]
    return user_ids


def _fetch_user_history(
    actions_col,
    user_id: str,
    since: datetime,
    action_types: Sequence[str],
    max_history: int,
) -> List[str]:
    cursor = actions_col.find(
        {
            "userId": user_id,
            "timestamp": {"$gte": since},
            "action": {"$in": list(action_types)},
            "targetPostId": {"$exists": True, "$ne": None},
        },
        {"targetPostId": 1, "modelPostId": 1, "timestamp": 1},
    ).sort("timestamp", -1).limit(max_history * 2)

    post_ids: List[str] = []
    for doc in cursor:
        raw_id = doc.get("modelPostId") or doc.get("targetPostId")
        if raw_id is not None:
            post_ids.append(str(raw_id))
    post_ids = list(reversed(post_ids))
    return post_ids[-max_history:]


def _resolve_external_id_map(
    posts_col,
    raw_post_ids: Sequence[str],
    news_vocab: Dict[str, int],
) -> Dict[str, str]:
    """当词表使用外部 ID（如 kuai_ / N...）时，批量反查 Post.newsMetadata.externalId。"""
    unresolved = [pid for pid in raw_post_ids if pid not in news_vocab]
    if not unresolved or posts_col is None:
        return {}

    obj_ids = []
    for pid in unresolved:
        try:
            obj_ids.append(ObjectId(pid))
        except Exception:
            continue
    if not obj_ids:
        return {}

    mapping: Dict[str, str] = {}
    for doc in posts_col.find(
        {"_id": {"$in": obj_ids}, "deletedAt": None},
        {"_id": 1, "newsMetadata.externalId": 1},
    ):
        meta = doc.get("newsMetadata") or {}
        ext = meta.get("externalId")
        if ext:
            mapping[str(doc["_id"])] = str(ext)
    return mapping


def _batch(iterable: List[str], size: int) -> List[List[str]]:
    return [iterable[i : i + size] for i in range(0, len(iterable), size)]


def _resolve_two_tower_model_version(ml_app) -> str:
    """解析用于标识本次向量产出版本的 Two-Tower 模型版本号。"""
    version = (
        os.getenv("TWO_TOWER_MODEL_VERSION")
        or getattr(ml_app, "ARTIFACT_VERSION", "")
        or os.getenv("MODEL_VERSION")
        or os.getenv("TWO_TOWER_MODEL_PATH")
        or ""
    )
    version = str(version).strip()
    return version or "two_tower_unknown"


def run_refresh_features_job(
    days: int = 1,
    max_users: Optional[int] = None,
    max_history: int = 50,
    batch_size: int = 128,
    action_types: Optional[Sequence[str]] = None,
    rebuild_faiss: bool = False,
    filter_users_from_postgres: bool = False,
) -> Dict[str, Any]:
    """计算近线用户 Two-Tower 向量并写入 MongoDB，附带完整 EmbeddingContract。"""
    import app as ml_app

    ml_app.load_two_tower_sync(allow_download=True)
    model = ml_app.two_tower_model
    news_vocab = ml_app.news_vocab or {}
    user_vocab = ml_app.user_vocab or {}
    idx_to_news_id = getattr(ml_app, "idx_to_news_id", None) or {v: k for k, v in news_vocab.items()}
    model_version = _resolve_two_tower_model_version(ml_app)
    artifact_version = str(getattr(ml_app, "ARTIFACT_VERSION", "") or model_version)
    model_profile = str(getattr(ml_app, "ARTIFACT_PROFILE", "") or "unknown")
    embedding_dim = int(getattr(ml_app, "EMBEDDING_DIM", 0) or 0)

    if model is None:
        raise RuntimeError("Two-Tower 模型未加载")

    if "<UNK>" not in news_vocab or "<UNK>" not in user_vocab:
        raise RuntimeError("news_vocab 或 user_vocab 缺少 <UNK> 索引")

    id_namespace = infer_id_namespace(idx_to_news_id, configured=os.getenv("ANN_ID_NAMESPACE", ""))
    embedding_space = resolve_embedding_space(
        id_namespace,
        configured=os.getenv("ANN_EMBEDDING_SPACE", "recommendation_two_tower_v1"),
    )
    user_contract = build_user_embedding_contract(
        embedding_dim=embedding_dim,
        model_version=model_version,
        artifact_version=artifact_version,
        embedding_space=embedding_space,
    )

    client, db = _load_mongo()
    actions_col = db["user_actions"]
    features_col = db["user_feature_vectors"]
    posts_col = db["posts"]

    since = datetime.utcnow() - timedelta(days=days)
    if action_types is None:
        action_types = [
            "like",
            "reply",
            "repost",
            "quote",
            "click",
            "share",
            "video_view",
            "video_quality_view",
            "dwell",
        ]

    user_ids = _fetch_active_user_ids(actions_col, since, max_users)

    if filter_users_from_postgres:
        pg_ids = _load_postgres_user_ids(
            limit=max_users,
            only_active_since=since,
        )
        if pg_ids is not None:
            filtered_user_ids = [uid for uid in user_ids if uid in pg_ids]
            if filtered_user_ids or not user_ids:
                user_ids = filtered_user_ids
            else:
                print(
                    "⚠️ Postgres 活跃用户过滤未命中 Mongo 行为用户，回退到 Mongo 近期行为用户。"
                )

    if not user_ids:
        client.close()
        return {
            "users_processed": 0,
            "embeddings_written": 0,
            "model_version": model_version,
            "artifact_version": artifact_version,
            "model_profile": model_profile,
            "embedding_dim": embedding_dim,
            "embedding_space": embedding_space,
        }

    unk_user_idx = int(user_vocab.get("<UNK>", 1))
    unk_news_idx = int(news_vocab.get("<UNK>", 1))

    total_processed = 0
    total_written = 0
    now = datetime.utcnow()
    expires_at = now + timedelta(days=30)

    for batch_user_ids in _batch(user_ids, batch_size):
        raw_histories: List[List[str]] = []
        unresolved_post_ids: set[str] = set()
        for uid in batch_user_ids:
            hist = _fetch_user_history(actions_col, uid, since, action_types, max_history)
            raw_histories.append(hist)
            for pid in hist:
                if pid not in news_vocab:
                    unresolved_post_ids.add(pid)

        ext_map = _resolve_external_id_map(posts_col, list(unresolved_post_ids), news_vocab)

        user_indices: List[int] = []
        history_indices_batch: List[List[int]] = []
        history_masks_batch: List[List[float]] = []
        quality_scores: List[float] = []

        for uid, history_ids in zip(batch_user_ids, raw_histories):
            user_indices.append(int(user_vocab.get(uid, unk_user_idx)))
            mapped: List[int] = []
            for pid in history_ids:
                resolved_pid = ext_map.get(pid, pid)
                mapped.append(int(news_vocab.get(resolved_pid, unk_news_idx)))

            valid_len = len(mapped)
            if valid_len > max_history:
                mapped = mapped[-max_history:]
                mask = [1.0] * max_history
            else:
                pad_len = max_history - valid_len
                mask = [1.0] * valid_len + [0.0] * pad_len
                mapped = mapped + [0] * pad_len

            history_indices_batch.append(mapped)
            history_masks_batch.append(mask)
            quality_scores.append(min(1.0, max(0.1, valid_len / 20.0)))

        user_tensor = torch.tensor(user_indices, dtype=torch.long, device=ml_app.device)
        history_tensor = torch.tensor(history_indices_batch, dtype=torch.long, device=ml_app.device)
        mask_tensor = torch.tensor(history_masks_batch, dtype=torch.float, device=ml_app.device)

        with torch.no_grad():
            user_vec = model.user_encoder(user_tensor, history_tensor, mask_tensor)
            user_vec_np = user_vec.cpu().numpy().astype(np.float32)
            norms = np.linalg.norm(user_vec_np, axis=1, keepdims=True)
            user_vec_np = user_vec_np / (norms + 1e-10)

        updates = []
        for i, uid in enumerate(batch_user_ids):
            updates.append(
                UpdateOne(
                    {"userId": uid},
                    {
                        "$set": {
                            "twoTowerEmbedding": user_vec_np[i].tolist(),
                            "twoTowerEmbeddingContract": user_contract,
                            "qualityScore": quality_scores[i],
                            "modelVersion": model_version,
                            "artifactVersion": artifact_version,
                            "modelProfile": model_profile,
                            "embeddingDim": embedding_dim,
                            "computedAt": now,
                            "expiresAt": expires_at,
                            "updatedAt": now,
                        },
                        "$unset": {"twoTowerEmbeddingQuarantineReason": ""},
                        "$setOnInsert": {"createdAt": now},
                        "$inc": {"version": 1},
                    },
                    upsert=True,
                )
            )

        if updates:
            result = features_col.bulk_write(updates, ordered=False)
            total_written += result.upserted_count + result.modified_count

        total_processed += len(batch_user_ids)

    if rebuild_faiss:
        # 严格调用完整 NewsEncoder 投影（MLP + L2 norm）导出物料向量，避免与用户塔空间割裂
        item_embeddings = model.encode_all_items(batch_size=2048, device=ml_app.device, dtype=np.float32)
        np.save(ml_app.DATA_DIR / "item_embeddings.npy", item_embeddings)

        try:
            from scripts.build_faiss_index import build_index

            index_type = os.getenv("FAISS_INDEX_TYPE", "ivf_pq")
            build_index(index_type=index_type, normalize=True, benchmark=False)
        except Exception as e:
            print(f"❌ FAISS 索引重建失败: {e}")

    client.close()
    return {
        "users_processed": total_processed,
        "embeddings_written": total_written,
        "model_version": model_version,
        "artifact_version": artifact_version,
        "model_profile": model_profile,
        "embedding_dim": embedding_dim,
        "embedding_space": embedding_space,
    }
