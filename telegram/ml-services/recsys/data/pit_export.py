"""严格时间截断（PIT）与合成样本隔离的数据导出器，支持 MongoDB 与 GCS 归档双源合流。"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import pickle
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from recsys.contracts.actions import ACTION_TYPE_MAP, PREDICTED_ACTIONS, canonicalize_action_name

DEFAULT_SYNTHETIC_PREFIXES: Tuple[str, ...] = ("demo_", "seed_", "synthetic_", "test_synthetic_")
_SYNTHETIC_MARKERS: Tuple[str, ...] = (
    "interview_demo",
    "prepare_interview_demo",
    "synthetic",
    "seed_all_data",
    "seedalldata",
)

# 相对时间间隔对数分桶上界（秒），共 16 桶 [0..15]
_TIME_BUCKET_BOUNDS_SEC: Tuple[int, ...] = (
    60,
    300,
    900,
    1800,
    3600,
    7200,
    21600,
    43200,
    86400,
    172800,
    345600,
    604800,
    1209600,
    2592000,
    7776000,
)


def compute_time_bucket(delta_seconds: float) -> int:
    """将历史行为与候选评估时刻的时间差映射为离散对数分桶 ID。"""
    sec = max(0.0, float(delta_seconds))
    for idx, bound in enumerate(_TIME_BUCKET_BOUNDS_SEC):
        if sec <= bound:
            return idx
    return len(_TIME_BUCKET_BOUNDS_SEC)


def _normalize_timestamp(raw: Any) -> Optional[datetime]:
    """统一将 Mongo datetime 或 ISO 字符串归一化为 UTC naive datetime。"""
    if isinstance(raw, datetime):
        if raw.tzinfo is not None:
            return raw.astimezone(timezone.utc).replace(tzinfo=None)
        return raw
    if isinstance(raw, (int, float)):
        # 兼容毫秒或秒级 Unix 时间戳
        val = float(raw)
        if val > 1e12:
            val /= 1000.0
        return datetime.fromtimestamp(val, tz=timezone.utc).replace(tzinfo=None)
    if isinstance(raw, str) and raw.strip():
        try:
            dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except Exception:
            return None
    return None


def is_synthetic_record(
    doc: Dict[str, Any],
    *,
    excluded_user_ids: Optional[Set[str]] = None,
    synthetic_prefixes: Sequence[str] = DEFAULT_SYNTHETIC_PREFIXES,
) -> bool:
    """识别并过滤演示脚本、种子填充及离线仿真产生的合成样本。"""
    user_id = str(doc.get("userId") or doc.get("user_id") or "").strip()
    if excluded_user_ids and user_id in excluded_user_ids:
        return True
    lowered_uid = user_id.lower()
    if any(lowered_uid.startswith(prefix) for prefix in synthetic_prefixes):
        return True

    metadata = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    if metadata.get("isSynthetic") or metadata.get("synthetic") or metadata.get("seed"):
        return True

    # 检查 requestId、experimentKeys 与 embeddingContract 等字段中的合成标记
    parts: List[str] = [
        str(doc.get("requestId") or ""),
        str(doc.get("selectionReason") or ""),
        str(doc.get("productSurface") or ""),
        str(metadata.get("source") or ""),
        str(metadata.get("decisionContextVersion") or ""),
    ]
    exp_keys = doc.get("experimentKeys")
    if isinstance(exp_keys, list):
        parts.extend(str(k) for k in exp_keys)

    joined = " ".join(parts).lower()
    return any(marker in joined for marker in _SYNTHETIC_MARKERS)


def connect_mongo(uri: str, db_name: Optional[str] = None):
    """连接 MongoDB，用于只读训练导出。"""
    from pymongo import MongoClient

    client = MongoClient(uri)
    if db_name:
        return client[db_name]
    db = client.get_default_database()
    if db is None:
        raise ValueError("无法从 URI 推断数据库名，请显式传入 --db-name")
    return db


def load_synthetic_user_ids_from_db(db) -> Set[str]:
    """从 user_feature_vectors 识别带有 interview_demo/seed 契约的演示用户以便自动隔离。"""
    synthetic_uids: Set[str] = set()
    try:
        cursor = db["user_feature_vectors"].find(
            {
                "$or": [
                    {"twoTowerEmbeddingContract.modelVersion": {"$regex": "demo|seed", "$options": "i"}},
                    {"modelVersion": {"$regex": "demo|seed", "$options": "i"}},
                    {"artifactVersion": {"$regex": "demo|seed", "$options": "i"}},
                ]
            },
            {"userId": 1},
        )
        for doc in cursor:
            if doc.get("userId"):
                synthetic_uids.add(str(doc["userId"]))
    except Exception:
        pass
    return synthetic_uids


def _record_from_raw_event(
    doc: Dict[str, Any],
    *,
    excluded_user_ids: Optional[Set[str]] = None,
    exclude_synthetic: bool = True,
) -> Optional[Dict[str, Any]]:
    if exclude_synthetic and is_synthetic_record(doc, excluded_user_ids=excluded_user_ids):
        return None
    uid = doc.get("userId")
    pid = doc.get("targetPostId") or doc.get("targetId") or doc.get("modelPostId")
    ts = _normalize_timestamp(doc.get("timestamp"))
    if not uid or not pid or ts is None:
        return None

    raw_action = str(doc.get("action") or doc.get("signalType") or "impression")
    action_name = canonicalize_action_name(raw_action)
    action_type_id = ACTION_TYPE_MAP.get(action_name, ACTION_TYPE_MAP["impression"])

    return {
        "user_id": str(uid),
        "post_id": str(doc.get("modelPostId") or pid),
        "serving_post_id": str(pid),
        "author_id": str(doc.get("targetAuthorId") or ""),
        "action_name": action_name,
        "action_type": int(action_type_id),
        "timestamp": ts,
        "dwell_ms": int(doc.get("dwellTimeMs") or 0),
        "in_network": bool(doc.get("inNetwork", False)),
        "recall_source": str(doc.get("recallSource") or ""),
    }


def load_actions_from_jsonl_files(
    paths: Iterable[Path],
    *,
    excluded_user_ids: Optional[Set[str]] = None,
    exclude_synthetic: bool = True,
) -> List[Dict[str, Any]]:
    """读取本地或从 GCS 拉取的 .jsonl / .jsonl.gz 用户行为归档。"""
    records: List[Dict[str, Any]] = []
    for path in paths:
        opener = gzip.open if path.name.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8") as f:
            for line in f:
                text = line.strip()
                if not text:
                    continue
                try:
                    raw = json.loads(text)
                except Exception:
                    continue
                rec = _record_from_raw_event(
                    raw,
                    excluded_user_ids=excluded_user_ids,
                    exclude_synthetic=exclude_synthetic,
                )
                if rec is not None:
                    records.append(rec)
    return records


def download_gcs_archive_files(gcs_prefix_uri: str, dest_dir: Path) -> List[Path]:
    """从 gs://bucket/prefix/ 下载所有归档 .jsonl.gz 文件到本地缓存目录。"""
    if not gcs_prefix_uri.startswith("gs://"):
        raise ValueError(f"非法 GCS URI: {gcs_prefix_uri}")
    without_scheme = gcs_prefix_uri[5:]
    bucket_name, _, prefix = without_scheme.partition("/")
    from google.cloud import storage

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    dest_dir.mkdir(parents=True, exist_ok=True)
    downloaded: List[Path] = []
    for blob in bucket.list_blobs(prefix=prefix):
        if not (blob.name.endswith(".jsonl.gz") or blob.name.endswith(".jsonl")):
            continue
        target = dest_dir / Path(blob.name).name
        if not target.exists():
            blob.download_to_filename(str(target))
        downloaded.append(target)
    return downloaded


def merge_and_group_user_actions(
    records: Sequence[Dict[str, Any]],
    *,
    min_actions_per_user: int = 3,
) -> Dict[str, List[Dict[str, Any]]]:
    """对多源行为日志去重并按用户聚合与时间升序排列。"""
    deduped: Dict[Tuple[str, str, str, int], Dict[str, Any]] = {}
    for rec in records:
        ts_ms = int(rec["timestamp"].replace(tzinfo=timezone.utc).timestamp() * 1000)
        key = (rec["user_id"], rec["action_name"], rec["post_id"], ts_ms)
        prev = deduped.get(key)
        if prev is None or rec.get("dwell_ms", 0) > prev.get("dwell_ms", 0):
            deduped[key] = rec

    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for rec in deduped.values():
        grouped[rec["user_id"]].append(rec)

    filtered: Dict[str, List[Dict[str, Any]]] = {}
    for uid, acts in grouped.items():
        if len(acts) >= min_actions_per_user:
            acts.sort(key=lambda x: x["timestamp"])
            filtered[uid] = acts
    return filtered


def export_user_actions_from_mongo(
    db,
    *,
    days: int = 30,
    min_actions_per_user: int = 3,
    include_user_signals: bool = True,
    extra_records: Sequence[Dict[str, Any]] = (),
    exclude_synthetic: bool = True,
) -> Dict[str, List[Dict[str, Any]]]:
    """从 MongoDB user_actions（及可选 user_signals / GCS 归档）联合导出并清理合成数据。"""
    excluded_uids = load_synthetic_user_ids_from_db(db) if exclude_synthetic else set()
    since = datetime.utcnow() - timedelta(days=days)

    records: List[Dict[str, Any]] = list(extra_records)
    actions_cursor = db["user_actions"].find(
        {"timestamp": {"$gte": since}},
        {
            "userId": 1,
            "action": 1,
            "targetPostId": 1,
            "modelPostId": 1,
            "targetAuthorId": 1,
            "timestamp": 1,
            "dwellTimeMs": 1,
            "inNetwork": 1,
            "recallSource": 1,
            "requestId": 1,
            "productSurface": 1,
            "experimentKeys": 1,
            "metadata": 1,
        },
    )
    for doc in actions_cursor:
        rec = _record_from_raw_event(doc, excluded_user_ids=excluded_uids if exclude_synthetic else None)
        if rec is not None:
            records.append(rec)

    if include_user_signals and "user_signals" in db.list_collection_names():
        sig_cursor = db["user_signals"].find(
            {"timestamp": {"$gte": since}},
            {
                "userId": 1,
                "signalType": 1,
                "targetId": 1,
                "targetAuthorId": 1,
                "timestamp": 1,
                "dwellTimeMs": 1,
                "productSurface": 1,
                "metadata": 1,
            },
        )
        for doc in sig_cursor:
            rec = _record_from_raw_event(doc, excluded_user_ids=excluded_uids if exclude_synthetic else None)
            if rec is not None:
                records.append(rec)

    return merge_and_group_user_actions(records, min_actions_per_user=min_actions_per_user)


def build_post_metadata_map(db, post_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    """
    修复旧脚本仅传字符串查询 Mongo _id 的 Bug：
    同时按 bson.ObjectId 和 newsMetadata.externalId 批量检索帖子作者与媒体特征。
    """
    unique_ids = [str(pid) for pid in post_ids if pid]
    if not unique_ids or db is None:
        return {}

    from bson import ObjectId

    obj_ids: List[Any] = []
    ext_ids: List[str] = []
    for pid in unique_ids:
        try:
            obj_ids.append(ObjectId(pid))
        except Exception:
            ext_ids.append(pid)

    clauses: List[Dict[str, Any]] = []
    if obj_ids:
        clauses.append({"_id": {"$in": obj_ids}})
    if ext_ids:
        clauses.append({"newsMetadata.externalId": {"$in": ext_ids}})
    if not clauses:
        return {}

    query: Dict[str, Any] = {"$or": clauses} if len(clauses) > 1 else clauses[0]
    post_meta_map: Dict[str, Dict[str, Any]] = {}
    for doc in db["posts"].find(
        query,
        {"_id": 1, "authorId": 1, "isNews": 1, "media": 1, "newsMetadata.externalId": 1},
    ):
        media = doc.get("media") if isinstance(doc.get("media"), list) else []
        has_video = any(str((m or {}).get("type", "")).lower() == "video" for m in media)
        info = {
            "author_id": str(doc.get("authorId") or ""),
            "is_news": bool(doc.get("isNews", False)),
            "has_video": has_video,
        }
        post_meta_map[str(doc["_id"])] = info
        ext = (doc.get("newsMetadata") or {}).get("externalId")
        if ext:
            post_meta_map[str(ext)] = info

    return post_meta_map


def build_training_samples(
    user_actions: Dict[str, List[Dict[str, Any]]],
    post_metadata_map: Dict[str, Dict[str, Any]],
    *,
    max_history_len: int = 64,
    min_history_len: int = 3,
    num_negatives: int = 7,
    label_window_hours: float = 24.0,
    seed: int = 42,
) -> List[dict]:
    """
    严格时间截断（Point-In-Time）训练样本构造函数：
      - history 只允许包含 timestamp < candidate_ts 的历史动作，严防未来交互泄漏
      - 候选目标标签仅聚合 [candidate_ts, candidate_ts + label_window] 内的行为
    """
    rng = random.Random(seed)
    all_post_ids = list({a["post_id"] for actions in user_actions.values() for a in actions})
    samples: List[dict] = []
    label_window = timedelta(hours=max(0.1, float(label_window_hours)))

    for user_id, raw_actions in user_actions.items():
        actions = sorted(raw_actions, key=lambda x: x["timestamp"])
        interacted_posts = {a["post_id"] for a in actions}
        seen_candidate_posts: Set[str] = set()

        for idx, anchor in enumerate(actions):
            pid = anchor["post_id"]
            if pid in seen_candidate_posts:
                continue
            seen_candidate_posts.add(pid)
            cand_ts = anchor["timestamp"]

            # 严格因果历史截断：只保留时间戳严格早于当前候选评估时刻的行为
            prior_history = [a for a in actions[:idx] if a["timestamp"] < cand_ts]
            if len(prior_history) < min_history_len:
                continue
            recent_history = prior_history[-max_history_len:]

            # 仅统计评估窗口内针对同一帖子的反馈，禁止把几天后的行为反向写进未来窗口之外
            window_end = cand_ts + label_window
            labels: Dict[str, float] = {name: 0.0 for name in PREDICTED_ACTIONS}
            dwell_ms = 0
            for act in actions[idx:]:
                if act["timestamp"] > window_end:
                    break
                if act["post_id"] != pid:
                    continue
                act_name = canonicalize_action_name(act["action_name"])
                if act_name in labels:
                    labels[act_name] = 1.0
                if act.get("dwell_ms", 0) > dwell_ms:
                    dwell_ms = int(act["dwell_ms"])
            if dwell_ms > 0:
                labels["dwell"] = 1.0

            meta = post_metadata_map.get(pid) or post_metadata_map.get(anchor.get("serving_post_id", ""), {})
            author_id = anchor.get("author_id") or meta.get("author_id", "")
            history_tuples = [
                (
                    h["post_id"],
                    h.get("author_id") or (post_metadata_map.get(h["post_id"], {})).get("author_id", ""),
                    h["action_type"],
                    compute_time_bucket((cand_ts - h["timestamp"]).total_seconds()),
                )
                for h in recent_history
            ]

            samples.append(
                {
                    "user_id": user_id,
                    "history": history_tuples,
                    "candidate_post_id": pid,
                    "candidate_author_id": author_id,
                    "labels": labels,
                    "dwell_ms": dwell_ms,
                    "in_network": bool(anchor.get("in_network", False)),
                    "has_video": bool(meta.get("has_video", False)),
                    "action_time": cand_ts.isoformat(),
                    "is_positive": True,
                }
            )

        if not all_post_ids or len(actions) < min_history_len:
            continue

        # 负采样使用用户最后一个动作时刻之后（无任何未观察历史穿插）作为参考锚点
        neg_pool = [p for p in all_post_ids if p not in interacted_posts]
        if not neg_pool:
            neg_pool = all_post_ids
        neg_count = min(num_negatives * max(1, len(seen_candidate_posts)), len(neg_pool))
        sampled_negs = rng.sample(neg_pool, neg_count)
        ref_ts = actions[-1]["timestamp"] + timedelta(seconds=1)
        recent_history = actions[-max_history_len:]
        neg_history_tuples = [
            (
                h["post_id"],
                h.get("author_id") or (post_metadata_map.get(h["post_id"], {})).get("author_id", ""),
                h["action_type"],
                compute_time_bucket((ref_ts - h["timestamp"]).total_seconds()),
            )
            for h in recent_history
        ]

        for neg_pid in sampled_negs:
            neg_meta = post_metadata_map.get(neg_pid, {})
            samples.append(
                {
                    "user_id": user_id,
                    "history": neg_history_tuples,
                    "candidate_post_id": neg_pid,
                    "candidate_author_id": neg_meta.get("author_id", ""),
                    "labels": {name: 0.0 for name in PREDICTED_ACTIONS},
                    "dwell_ms": 0,
                    "in_network": False,
                    "has_video": bool(neg_meta.get("has_video", False)),
                    "action_time": ref_ts.isoformat(),
                    "is_positive": False,
                }
            )

    samples.sort(key=lambda s: s.get("action_time", ""))
    return samples


def build_vocabs(samples: Sequence[dict]) -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int]]:
    """构建带 0=<PAD>、1=<UNK> 约定的 user/post/author 词表。"""
    user_ids: Set[str] = set()
    post_ids: Set[str] = set()
    author_ids: Set[str] = set()

    for sample in samples:
        if sample.get("user_id"):
            user_ids.add(str(sample["user_id"]))
        if sample.get("candidate_post_id"):
            post_ids.add(str(sample["candidate_post_id"]))
        if sample.get("candidate_author_id"):
            author_ids.add(str(sample["candidate_author_id"]))
        for item in sample.get("history", []):
            pid, aid = item[0], item[1]
            if pid:
                post_ids.add(str(pid))
            if aid:
                author_ids.add(str(aid))

    user_vocab = {"<PAD>": 0, "<UNK>": 1}
    for uid in sorted(user_ids):
        user_vocab.setdefault(uid, len(user_vocab))

    post_vocab = {"<PAD>": 0, "<UNK>": 1}
    for pid in sorted(post_ids):
        post_vocab.setdefault(pid, len(post_vocab))

    author_vocab = {"<PAD>": 0, "<UNK>": 1}
    for aid in sorted(author_ids):
        author_vocab.setdefault(aid, len(author_vocab))

    return user_vocab, post_vocab, author_vocab


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="从 MongoDB/GCS 导出时间一致（PIT）的 Phoenix V2 训练样本")
    parser.add_argument("--mongo-uri", default="", help="MongoDB 连接 URI（留空则仅读取本地或 GCS 归档）")
    parser.add_argument("--db-name", default=None, help="Mongo 数据库名")
    parser.add_argument("--gcs-archive-uri", default="", help="可选 GCS 归档路径，如 gs://bucket/archives/user_actions/")
    parser.add_argument("--local-jsonl-dir", type=Path, default=None, help="可选本地 .jsonl / .jsonl.gz 归档目录")
    parser.add_argument("--days", type=int, default=30, help="回溯导出天数")
    parser.add_argument("--min-actions", type=int, default=3, help="单用户最小行为阈值")
    parser.add_argument("--max-history", type=int, default=64, help="最大历史序列长度")
    parser.add_argument("--num-negatives", type=int, default=7, help="每正样本负采样比例")
    parser.add_argument("--include-user-signals", action="store_true", help="同时合入 user_signals 集合")
    parser.add_argument("--keep-synthetic", action="store_true", help="保留合成/演示数据（默认剔除）")
    parser.add_argument("--output", type=Path, default=None, help="输出样本 pkl 路径")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    extra_records: List[Dict[str, Any]] = []
    cache_dir = Path(__file__).resolve().parent.parent.parent / "data" / "gcs_archive_cache"

    archive_files: List[Path] = []
    if args.local_jsonl_dir and args.local_jsonl_dir.exists():
        archive_files.extend(sorted(args.local_jsonl_dir.rglob("*.jsonl*")))
    if args.gcs_archive_uri:
        archive_files.extend(download_gcs_archive_files(args.gcs_archive_uri, cache_dir))
    if archive_files:
        extra_records.extend(
            load_actions_from_jsonl_files(
                archive_files,
                exclude_synthetic=not args.keep_synthetic,
            )
        )

    db = connect_mongo(args.mongo_uri, args.db_name) if args.mongo_uri else None
    if db is not None:
        user_actions = export_user_actions_from_mongo(
            db,
            days=args.days,
            min_actions_per_user=args.min_actions,
            include_user_signals=args.include_user_signals,
            extra_records=extra_records,
            exclude_synthetic=not args.keep_synthetic,
        )
    else:
        if not extra_records:
            raise SystemExit("必须提供 --mongo-uri 或可读取的归档文件 (--gcs-archive-uri / --local-jsonl-dir)")
        user_actions = merge_and_group_user_actions(extra_records, min_actions_per_user=args.min_actions)

    all_post_ids = {
        pid
        for actions in user_actions.values()
        for a in actions
        for pid in (a["post_id"], a.get("serving_post_id", ""))
        if pid
    }
    post_meta_map = build_post_metadata_map(db, all_post_ids) if db is not None else {}

    samples = build_training_samples(
        user_actions,
        post_meta_map,
        max_history_len=args.max_history,
        min_history_len=min(3, args.min_actions),
        num_negatives=args.num_negatives,
    )
    user_vocab, post_vocab, author_vocab = build_vocabs(samples)

    output_dir = args.output.parent if args.output else Path(__file__).resolve().parent.parent.parent / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output or (output_dir / "phoenix_v2_samples.pkl")

    with open(output_path, "wb") as f:
        pickle.dump(samples, f, protocol=pickle.HIGHEST_PROTOCOL)
    for name, vocab in [("user_vocab", user_vocab), ("post_vocab", post_vocab), ("author_vocab", author_vocab)]:
        with open(output_dir / f"phoenix_v2_{name}.pkl", "wb") as f:
            pickle.dump(vocab, f, protocol=pickle.HIGHEST_PROTOCOL)

    summary = {
        "samples": len(samples),
        "positives": sum(1 for s in samples if s["is_positive"]),
        "negatives": sum(1 for s in samples if not s["is_positive"]),
        "users": len(user_vocab),
        "posts": len(post_vocab),
        "authors": len(author_vocab),
        "output": str(output_path),
    }
    (output_dir / "phoenix_v2_export_manifest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
