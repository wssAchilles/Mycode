#!/usr/bin/env python3
"""
刷新特征脚本（不重新训练模型）
功能:
- 基于当天新增用户行为，计算 Two-Tower 用户嵌入
- 将嵌入写入 MongoDB 的 user_feature_vectors
- 可选：重建 item_embeddings + FAISS 索引（用于模型权重更新后同步）
"""

import argparse
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch
from pymongo import MongoClient, UpdateOne

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
        db_name = os.getenv("MONGODB_DB_NAME", "")
        if not db_name:
            raise RuntimeError("MONGODB_DB_NAME 未配置且 URI 中无默认库名")
        db = client[db_name]
    return client, db


def _load_postgres_user_ids(
    limit: Optional[int] = None,
    only_active_since: Optional[datetime] = None
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
            params = (only_active_since,)
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
    max_history: int
) -> List[str]:
    cursor = actions_col.find(
        {
            "userId": user_id,
            "timestamp": {"$gte": since},
            "action": {"$in": list(action_types)},
            "targetPostId": {"$exists": True, "$ne": None},
        },
        {"targetPostId": 1, "timestamp": 1},
    ).sort("timestamp", -1).limit(max_history * 2)

    post_ids = [str(doc.get("targetPostId")) for doc in cursor if doc.get("targetPostId")]
    post_ids = list(reversed(post_ids))
    return post_ids[-max_history:]


def _batch(iterable: List[str], size: int) -> List[List[str]]:
    return [iterable[i:i + size] for i in range(0, len(iterable), size)]


def run_refresh_features_job(
    days: int = 1,
    max_users: Optional[int] = None,
    max_history: int = 50,
    batch_size: int = 128,
    action_types: Optional[Sequence[str]] = None,
    rebuild_faiss: bool = False,
    filter_users_from_postgres: bool = False,
) -> Dict[str, int]:
    # 延迟导入，避免脚本启动时就加载模型
    import app as ml_app

    ml_app.load_models_sync()
    model = ml_app.two_tower_model
    news_vocab = ml_app.news_vocab or {}
    user_vocab = ml_app.user_vocab or {}

    if model is None:
        raise RuntimeError("Two-Tower 模型未加载")

    if "<UNK>" not in news_vocab or "<UNK>" not in user_vocab:
        raise RuntimeError("news_vocab 或 user_vocab 缺少 <UNK> 索引")

    client, db = _load_mongo()
    actions_col = db["user_actions"]
    features_col = db["user_feature_vectors"]

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
            user_ids = [uid for uid in user_ids if uid in pg_ids]

    if not user_ids:
        return {"users_processed": 0, "embeddings_written": 0}

    unk_user_idx = user_vocab.get("<UNK>", 1)
    unk_news_idx = news_vocab.get("<UNK>", 1)

    total_processed = 0
    total_written = 0

    for batch_user_ids in _batch(user_ids, batch_size):
        histories: List[List[int]] = []
        masks: List[List[float]] = []
        user_indices: List[int] = []
        quality_scores: List[float] = []

        for user_id in batch_user_ids:
            history_ids = _fetch_user_history(
                actions_col,
                user_id,
                since,
                action_types,
                max_history,
            )

            mapped = [
                news_vocab.get(pid, unk_news_idx)
                for pid in history_ids
            ]
            known_count = sum(1 for idx in mapped if idx != unk_news_idx)

            if len(mapped) > max_history:
                mapped = mapped[-max_history:]
                mask = [1.0] * max_history
            else:
                pad_len = max_history - len(mapped)
                mask = [1.0] * len(mapped) + [0.0] * pad_len
                mapped = mapped + [0] * pad_len

            histories.append(mapped)
            masks.append(mask)
            user_indices.append(user_vocab.get(user_id, unk_user_idx))
            quality_scores.append(min(1.0, known_count / max(1, max_history)))

        user_tensor = torch.tensor(user_indices, dtype=torch.long, device=ml_app.device)
        history_tensor = torch.tensor(histories, dtype=torch.long, device=ml_app.device)
        mask_tensor = torch.tensor(masks, dtype=torch.float, device=ml_app.device)

        with torch.no_grad():
            user_vec = model.user_encoder(user_tensor, history_tensor, mask_tensor)
            user_vec_np = user_vec.cpu().numpy()

        now = datetime.utcnow()
        expires_at = now + timedelta(days=30)
        model_version = (
            os.getenv("TWO_TOWER_MODEL_VERSION")
            or os.getenv("MODEL_VERSION")
            or os.getenv("TWO_TOWER_MODEL_PATH")
            or "two_tower"
        )

        updates = []
        for i, user_id in enumerate(batch_user_ids):
            updates.append(
                UpdateOne(
                    {"userId": user_id},
                    {
                        "$set": {
                            "twoTowerEmbedding": user_vec_np[i].tolist(),
                            "qualityScore": quality_scores[i],
                            "modelVersion": model_version,
                            "computedAt": now,
                            "expiresAt": expires_at,
                            "updatedAt": now,
                        },
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
        # 重新导出 item_embeddings，并重建 FAISS 索引
        emb_weight = model.news_encoder.news_embedding.weight.detach().cpu().numpy().astype(np.float32)
        np.save(ml_app.DATA_DIR / "item_embeddings.npy", emb_weight)

        try:
            from scripts.build_faiss_index import build_index

            index_type = os.getenv("FAISS_INDEX_TYPE", "ivf_pq")
            build_index(index_type=index_type, normalize=True, benchmark=False)
        except Exception as e:
            print(f"❌ FAISS rebuild failed: {e}")

    client.close()
    return {"users_processed": total_processed, "embeddings_written": total_written}


def main():
    parser = argparse.ArgumentParser(description="Refresh user features without retraining")
    parser.add_argument("--days", type=int, default=1, help="Lookback days for user actions")
    parser.add_argument("--max-users", type=int, default=None, help="Limit number of users")
    parser.add_argument("--max-history", type=int, default=50, help="Max history length")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size")
    parser.add_argument("--rebuild-faiss", action="store_true", help="Rebuild FAISS index")
    parser.add_argument("--filter-users-from-postgres", action="store_true", help="Filter users by Postgres")
    args = parser.parse_args()

    stats = run_refresh_features_job(
        days=args.days,
        max_users=args.max_users,
        max_history=args.max_history,
        batch_size=args.batch_size,
        rebuild_faiss=args.rebuild_faiss,
        filter_users_from_postgres=args.filter_users_from_postgres,
    )
    print(f"✅ Refresh completed: {stats}")


if __name__ == "__main__":
    main()
