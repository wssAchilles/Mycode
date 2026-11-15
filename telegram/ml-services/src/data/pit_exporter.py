"""线上 MongoDB 只读脱敏 PIT + 426 篇全量正文导出器（产出 Parquet V3 快照与 SHA-256 清单）。"""

from __future__ import annotations

import argparse
from bisect import bisect_left
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

import pyarrow as pa
import pyarrow.parquet as pq

from src.contracts.actions import (
    ACTION_INDEX_BY_NAME,
    ACTION_TYPE_MAP,
    NUM_PREDICTED_ACTIONS,
    PREDICTED_ACTIONS,
    canonicalize_action_name,
    get_dataset_action_mask,
)
from src.contracts.artifacts import compute_file_sha256
from src.contracts.sid import WIRE_MISSING_SID
from src.data.parquet_schema import (
    assert_valid_v3_posts_table,
    records_to_v3_posts_table,
    records_to_v3_samples_table,
)
from src.feature_adapters.history_packer import compute_time_bucket

_EMAIL_PII_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_PII_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\-\s]{8,14}\d)(?!\d)")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_SYNTHETIC_PREFIXES: Tuple[str, ...] = ("interview_demo", "seed_", "demo_", "test_")

_EXPOSURE_ACTIONS = {"impression", "delivery"}
_DWELL_POSITIVE_MS = 5_000.0
_VIDEO_VIEW_MIN_MS = 3_000.0

V3_ACTIONS_PARQUET_SCHEMA: pa.Schema = pa.schema(
    [
        ("event_id", pa.string()),
        ("user_hash_id", pa.string()),
        ("is_demo_cohort", pa.bool_()),
        ("post_id", pa.string()),
        ("author_hash", pa.string()),
        ("action", pa.string()),
        ("action_id", pa.int16()),
        ("timestamp_ms", pa.int64()),
        ("dwell_time_ms", pa.float32()),
        ("served_position", pa.int32()),
        ("request_id", pa.string()),
        ("product_surface", pa.string()),
        ("recall_source", pa.string()),
        ("in_network", pa.uint8()),
    ]
)


def anonymize_entity_id(raw_id: Any, *, prefix: str, salt: str = "tg_v3_pit_2026") -> str:
    """使用确定性 SHA-256 脱敏用户/作者等隐私标识符，不泄露原始账号或 UUID。"""
    text = str(raw_id or "").strip()
    if not text:
        return f"{prefix}unknown"
    digest = hashlib.sha256(f"{salt}:{prefix}{text}".encode("utf-8")).hexdigest()[:16]
    return f"{prefix}{digest}"


def sanitize_post_text(text: str) -> str:
    """对帖子正文进行 PII 脱敏清洗（替换邮箱和电话串，完整保留新闻/社交语义）。"""
    cleaned = str(text or "")
    cleaned = _EMAIL_PII_RE.sub("[EMAIL]", cleaned)
    cleaned = _PHONE_PII_RE.sub("[PHONE]", cleaned)
    return cleaned.strip()


def detect_language_hint(text: str) -> str:
    """基于字符分布识别文本中英文占比，用于监控多源双语覆盖分布。"""
    sample = str(text or "")
    if not sample.strip():
        return "unknown"
    cjk_count = len(_CJK_RE.findall(sample))
    latin_count = len(_LATIN_RE.findall(sample))
    total = cjk_count + latin_count
    if total == 0:
        return "unknown"
    cjk_ratio = cjk_count / float(total)
    if 0.15 <= cjk_ratio < 0.65 and latin_count >= 10:
        return "mixed"
    if cjk_ratio >= 0.15:
        return "zh"
    return "en"


def _to_utc_datetime(raw: Any) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        val = float(raw)
        if val > 1e12:
            val /= 1000.0
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(raw, str) and raw.strip():
        try:
            dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def is_synthetic_action_doc(doc: Mapping[str, Any], user_id: str) -> bool:
    """识别并过滤明显的测试伪造行为前瞻噪声，真实 democohortmanifests 用户独立打标保留。"""
    if bool(doc.get("isSynthetic") or doc.get("synthetic")):
        return True
    lower = user_id.lower()
    return any(lower.startswith(pfx) for pfx in _SYNTHETIC_PREFIXES)


def load_demo_cohort_user_ids(db: Any) -> Set[str]:
    """从 democohortmanifests 只读获取所有 cohort 用户 ID 集合，用于样本属性打标。"""
    names = set(db.list_collection_names()) if hasattr(db, "list_collection_names") else set()
    if "democohortmanifests" not in names:
        return set()
    cohort_ids: Set[str] = set()
    for doc in db["democohortmanifests"].find({}, {"userIds": 1}):
        for uid in doc.get("userIds") or []:
            text = str(uid).strip()
            if text:
                cohort_ids.add(text)
    return cohort_ids


def export_posts_corpus_from_mongo(
    db: Any,
    *,
    salt: str = "tg_v3_pit_2026",
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """只读拉取 posts 集合并脱敏产出 (corpus_records, post_lookup_by_id)。"""
    posts_col = db["posts"]
    projection = {
        "_id": 1,
        "authorId": 1,
        "title": 1,
        "content": 1,
        "keywords": 1,
        "tags": 1,
        "media": 1,
        "isNews": 1,
        "isNsfw": 1,
        "createdAt": 1,
        "deletedAt": 1,
        "newsMetadata": 1,
    }
    corpus_records: List[Dict[str, Any]] = []
    post_lookup: Dict[str, Dict[str, Any]] = {}

    for doc in posts_col.find({"deletedAt": None}, projection):
        pid = str(doc.get("_id") or "").strip()
        if not pid:
            continue
        author_hash = anonymize_entity_id(doc.get("authorId"), prefix="a_", salt=salt)
        raw_content = sanitize_post_text(str(doc.get("content") or ""))
        raw_title = sanitize_post_text(str(doc.get("title") or ""))
        news_meta = doc.get("newsMetadata") if isinstance(doc.get("newsMetadata"), Mapping) else {}
        if not raw_title and news_meta.get("title"):
            raw_title = sanitize_post_text(str(news_meta.get("title") or ""))

        keywords = [str(k).strip() for k in (doc.get("keywords") or []) if str(k).strip()]
        categories = [str(t).strip() for t in (doc.get("tags") or []) if str(t).strip()]
        if news_meta.get("category"):
            categories.append(str(news_meta["category"]).strip())

        media = doc.get("media") or []
        has_media = bool(isinstance(media, list) and len(media) > 0)
        has_video = bool(
            isinstance(media, list)
            and any(isinstance(m, Mapping) and str(m.get("type", "")).lower() == "video" for m in media)
        )
        created_dt = _to_utc_datetime(doc.get("createdAt"))
        created_ms = int(created_dt.timestamp() * 1000) if created_dt else 0
        lang_hint = detect_language_hint(f"{raw_title} {raw_content}")

        record = {
            "post_id": pid,
            "source_dataset": "prod_pit_v3",
            "author_hash": author_hash,
            "title": raw_title,
            "content": raw_content,
            "keywords": keywords,
            "categories": categories,
            "language_hint": lang_hint,
            "has_media": 1 if has_media else 0,
            "has_video": 1 if has_video else 0,
            "created_at_ms": created_ms,
            "is_nsfw": 1 if bool(doc.get("isNsfw")) else 0,
            "semantic_ids": list(WIRE_MISSING_SID),
        }
        corpus_records.append(record)
        post_lookup[pid] = record

        ext_id = str(news_meta.get("externalId") or "").strip()
        if ext_id and ext_id not in post_lookup:
            post_lookup[ext_id] = record

    return corpus_records, post_lookup


def export_raw_actions_from_mongo(
    db: Any,
    *,
    days: int = 0,
    salt: str = "tg_v3_pit_2026",
    cohort_user_ids: Optional[Set[str]] = None,
    post_lookup: Optional[Mapping[str, Mapping[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    只读拉取 user_actions（days<=0 表全量历史），保留 served_position (`rank`) 与 dwellTimeMs，
    返回 (脱敏有序事件列表, 被过滤的合成垃圾样本数)。
    """
    ua_col = db["user_actions"]
    query: Dict[str, Any] = {}
    if int(days) > 0:
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        query["timestamp"] = {"$gte": since}

    projection = {
        "_id": 1,
        "userId": 1,
        "action": 1,
        "targetPostId": 1,
        "modelPostId": 1,
        "targetAuthorId": 1,
        "timestamp": 1,
        "dwellTimeMs": 1,
        "rank": 1,
        "requestId": 1,
        "productSurface": 1,
        "recallSource": 1,
        "inNetwork": 1,
        "isSynthetic": 1,
    }
    cohort_set = cohort_user_ids if cohort_user_ids is not None else set()
    skipped_synthetic = 0
    raw_events: List[Dict[str, Any]] = []

    for doc in ua_col.find(query, projection):
        raw_uid = str(doc.get("userId") or "").strip()
        if not raw_uid:
            continue
        if is_synthetic_action_doc(doc, raw_uid):
            skipped_synthetic += 1
            continue

        raw_pid = str(doc.get("targetPostId") or doc.get("modelPostId") or "").strip()
        if not raw_pid:
            continue
        dt = _to_utc_datetime(doc.get("timestamp"))
        if dt is None:
            continue

        action_name = canonicalize_action_name(str(doc.get("action") or ""))
        if not action_name:
            continue
        ts_ms = int(round(dt.timestamp() * 1000))
        post_meta = (post_lookup or {}).get(raw_pid, {})
        author_hash = (
            anonymize_entity_id(doc.get("targetAuthorId"), prefix="a_", salt=salt)
            if doc.get("targetAuthorId")
            else str(post_meta.get("author_hash") or "a_unknown")
        )
        raw_rank = doc.get("rank")
        served_position = int(raw_rank) if isinstance(raw_rank, (int, float)) and int(raw_rank) >= 0 else -1
        dwell_ms = float(doc.get("dwellTimeMs") or 0.0) if doc.get("dwellTimeMs") is not None else 0.0

        raw_events.append(
            {
                "event_id": str(doc.get("_id") or ""),
                "user_hash_id": anonymize_entity_id(raw_uid, prefix="u_", salt=salt),
                "is_demo_cohort": raw_uid in cohort_set,
                "post_id": raw_pid,
                "author_hash": author_hash,
                "action": action_name,
                "action_id": int(ACTION_TYPE_MAP.get(action_name, 1)),
                "timestamp_ms": ts_ms,
                "dwell_time_ms": max(0.0, dwell_ms),
                "served_position": served_position,
                "request_id": str(doc.get("requestId") or ""),
                "product_surface": str(doc.get("productSurface") or ""),
                "recall_source": str(doc.get("recallSource") or ""),
                "in_network": 1 if bool(doc.get("inNetwork", False)) else 0,
            }
        )

    raw_events.sort(key=lambda r: (r["user_hash_id"], r["timestamp_ms"], r["event_id"]))
    return raw_events, skipped_synthetic


def build_prod_pit_samples_v3(
    events: Sequence[Mapping[str, Any]],
    *,
    post_lookup: Optional[Mapping[str, Mapping[str, Any]]] = None,
    max_history: int = 64,
    min_history: int = 1,
    val_ratio: float = 0.15,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """
    严格零泄漏 PIT 切片构造：
    - 将同用户的同 (request_id, post_id) 或同毫秒事件归并成同一条候选样本（保留 served_position）；
    - 对同页内多候选确保历史序列仅包含严格 ts < min_slate_ts 的先序行为，同页其它曝光不相互泄密；
    - 全 13 维 action_mask=1，严格处理 dwellTimeMs 与 has_video -> video_quality_view。
    """
    by_user: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
    for ev in events:
        by_user[str(ev["user_hash_id"])].append(ev)

    full_mask = get_dataset_action_mask("prod_pit_v3")
    all_samples: List[Dict[str, Any]] = []
    stats = {"total_users": len(by_user), "skipped_cold_history": 0, "slates_emitted": 0}

    # 先求出全部事件的时间戳分位以做严格时序 train/val 切分
    all_ts = sorted(int(e["timestamp_ms"]) for e in events)
    val_cutoff_ms = all_ts[int(len(all_ts) * (1.0 - val_ratio))] if len(all_ts) >= 20 and val_ratio > 0.0 else (1 << 62)

    for user_hash, u_events in by_user.items():
        ordered = sorted(u_events, key=lambda r: (int(r["timestamp_ms"]), str(r["event_id"])))

        # 按 request_id (若有) 或时间桶(1500ms 同一并发页面)分组，同时按组的最早时间排序保证严苛因果
        slates_map: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
        for ev in ordered:
            req_id = str(ev.get("request_id") or "").strip()
            group_key = f"req:{req_id}" if req_id else f"ts:{int(ev['timestamp_ms']) // 1500}"
            slates_map[group_key].append(ev)

        slates = sorted(slates_map.values(), key=lambda grp: min(int(x["timestamp_ms"]) for x in grp))
        # 预先抽取全局严格递增的真实交互事件流（排除纯 exposure/delivery），彻底避免跨 slate 异步延迟动作交错导致历史乱序
        user_interactions: List[Mapping[str, Any]] = [
            ev for ev in ordered if ev["action"] not in _EXPOSURE_ACTIONS
        ]
        user_interaction_ts: List[int] = [int(ev["timestamp_ms"]) for ev in user_interactions]

        for slate_idx, grp in enumerate(slates):
            slate_min_ts_ms = min(int(x["timestamp_ms"]) for x in grp)
            # 绝对严守 PIT 且保证 100% 单调：用 bisect_left 截取严格早于当前 slate 最早时刻的全部前置交互
            cut = bisect_left(user_interaction_ts, slate_min_ts_ms)
            causal_hist = user_interactions[max(0, cut - max_history) : cut]

            # 在当前 slate 内按 post_id 归并全部动作与展位信号
            by_post: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
            for item in grp:
                by_post[str(item["post_id"])].append(item)

            if len(causal_hist) >= min_history:
                hist_post_ids = [str(h["post_id"]) for h in causal_hist]
                hist_authors = [str(h.get("author_hash") or "a_unknown") for h in causal_hist]
                hist_acts = [int(h["action_id"]) for h in causal_hist]
                hist_ts = [int(h["timestamp_ms"]) for h in causal_hist]
                hist_bkts = [compute_time_bucket((slate_min_ts_ms - int(h["timestamp_ms"])) / 1000.0) for h in causal_hist]
                hist_sids = [list((post_lookup or {}).get(str(h["post_id"]), {}).get("semantic_ids") or WIRE_MISSING_SID) for h in causal_hist]

                stats["slates_emitted"] += 1
                split_name = "val" if slate_min_ts_ms >= val_cutoff_ms else "train"

                for post_id, p_evs in by_post.items():
                    labels = [0] * NUM_PREDICTED_ACTIONS
                    max_dwell_ms = 0.0
                    served_pos = -1
                    in_net = 0
                    is_demo = bool(p_evs[0].get("is_demo_cohort", False))
                    author_hash = str(p_evs[0].get("author_hash") or "a_unknown")
                    has_explicit_dwell_ms = False

                    for ev in p_evs:
                        act = str(ev["action"])
                        if ev["served_position"] >= 0 and (served_pos < 0 or ev["served_position"] < served_pos):
                            served_pos = int(ev["served_position"])
                        in_net = max(in_net, int(ev.get("in_network", 0)))
                        d_ms = float(ev.get("dwell_time_ms") or 0.0)
                        if d_ms > 0.0:
                            has_explicit_dwell_ms = True
                            max_dwell_ms = max(max_dwell_ms, d_ms)
                        if act in ACTION_INDEX_BY_NAME:
                            labels[ACTION_INDEX_BY_NAME[act]] = 1

                    # 对停留与视频质量完成标签做物理阈值一致性修正
                    if has_explicit_dwell_ms and max_dwell_ms >= _DWELL_POSITIVE_MS:
                        labels[ACTION_INDEX_BY_NAME["dwell"]] = 1
                    p_meta = (post_lookup or {}).get(post_id, {})
                    has_video = int(p_meta.get("has_video", 0))
                    if has_video and max_dwell_ms >= _VIDEO_VIEW_MIN_MS:
                        labels[ACTION_INDEX_BY_NAME["video_view"]] = 1

                    vqv_label = 1 if (has_video and labels[ACTION_INDEX_BY_NAME["dwell"]] == 1) else 0
                    cand_ts_ms = max(int(ev["timestamp_ms"]) for ev in p_evs)

                    all_samples.append(
                        {
                            "sample_id": f"prod:{user_hash}:{slate_idx}:{post_id}",
                            "source_dataset": "prod_pit_v3",
                            "split": split_name,
                            "user_hash_id": user_hash,
                            "is_demo_cohort": is_demo,
                            "action_ts_ms": cand_ts_ms,
                            "history_post_ids": hist_post_ids,
                            "history_author_hashes": hist_authors,
                            "history_action_types": hist_acts,
                            "history_ts_ms": hist_ts,
                            "history_time_buckets": hist_bkts,
                            "history_sids": hist_sids,
                            "candidate_post_id": post_id,
                            "candidate_author_hash": author_hash,
                            "candidate_in_network": in_net,
                            "candidate_has_video": has_video,
                            "candidate_duration_ms": float(p_meta.get("duration_ms") or 0.0),
                            "candidate_sids": list(p_meta.get("semantic_ids") or WIRE_MISSING_SID),
                            "served_position": served_pos,
                            "propensity_status": "not_evaluable_deterministic",
                            "propensity_score": -1.0,
                            "action_labels": labels,
                            "action_mask": list(full_mask),
                            "video_quality_view_label": vqv_label,
                            "video_quality_view_mask": 1 if has_video else 0,
                            "dwell_ms": max_dwell_ms if has_explicit_dwell_ms else 0.0,
                            "dwell_mask": 1 if has_explicit_dwell_ms else 0,
                            "exposure_mask": 1,
                            "is_random_exposure": 0,
                            "candidate_title": str(p_meta.get("title") or p_meta.get("content") or "")[:240],
                        }
                    )
            else:
                stats["skipped_cold_history"] += len(by_post)

    return all_samples, stats


def export_mongo_pit_v3_snapshot(
    mongo_uri: str,
    *,
    output_dir: Path,
    db_name: Optional[str] = None,
    days: int = 0,
    max_history: int = 64,
    min_history: int = 1,
    salt: str = "tg_v3_pit_2026",
) -> Dict[str, Any]:
    """只读连接 MongoDB 导出 3 张标准 V3 Parquet 快照与可信 SHA-256 清单，绝不泄漏敏感凭据。"""
    from pymongo import MongoClient

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10_000, readPreference="secondaryPreferred")
    try:
        db = client[db_name] if db_name else (client.get_default_database() if client.get_default_database() is not None else client["telegram_clone"])
        cohort_ids = load_demo_cohort_user_ids(db)
        corpus_records, post_lookup = export_posts_corpus_from_mongo(db, salt=salt)
        events, skipped_synthetic = export_raw_actions_from_mongo(
            db,
            days=days,
            salt=salt,
            cohort_user_ids=cohort_ids,
            post_lookup=post_lookup,
        )
    finally:
        client.close()

    samples, sample_stats = build_prod_pit_samples_v3(
        events,
        post_lookup=post_lookup,
        max_history=max_history,
        min_history=min_history,
    )

    posts_table = records_to_v3_posts_table(corpus_records)
    assert_valid_v3_posts_table(posts_table)
    posts_path = out_dir / "prod_posts_corpus_v3.parquet"
    pq.write_table(posts_table, posts_path, compression="zstd")

    actions_table = pa.Table.from_pylist(events, schema=V3_ACTIONS_PARQUET_SCHEMA)
    actions_path = out_dir / "prod_actions_pit_v3.parquet"
    pq.write_table(actions_table, actions_path, compression="zstd")

    samples_table = records_to_v3_samples_table(samples)
    samples_path = out_dir / "prod_pit_samples_v3.parquet"
    pq.write_table(samples_table, samples_path, compression="zstd")

    nonempty_content_posts = sum(1 for p in corpus_records if str(p.get("content") or "").strip())
    lang_counts: Dict[str, int] = defaultdict(int)
    for p in corpus_records:
        lang_counts[str(p.get("language_hint") or "unknown")] += 1

    action_counts: Dict[str, int] = defaultdict(int)
    cohort_action_cnt = 0
    for e in events:
        action_counts[str(e["action"])] += 1
        if e["is_demo_cohort"]:
            cohort_action_cnt += 1

    manifest = {
        "schema": "prod_pit_v3",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "daysLookback": int(days),
        "zeroPitLeakageVerified": True,
        "postsTotal": len(corpus_records),
        "postsWithNonEmptyContent": nonempty_content_posts,
        "postsLanguageCounts": dict(lang_counts),
        "actionsTotal": len(events),
        "actionsInDemoCohort": cohort_action_cnt,
        "actionsNotInDemoCohort": len(events) - cohort_action_cnt,
        "actionsWithServedPosition": sum(1 for e in events if e["served_position"] >= 0),
        "actionsWithDwellMs": sum(1 for e in events if e["dwell_time_ms"] > 0.0),
        "skippedSyntheticActions": skipped_synthetic,
        "actionDistribution": dict(action_counts),
        "samplesTotal": len(samples),
        "samplesStats": sample_stats,
        "files": {
            posts_path.name: {"rows": len(corpus_records), "sha256": compute_file_sha256(posts_path), "sizeBytes": posts_path.stat().st_size},
            actions_path.name: {"rows": len(events), "sha256": compute_file_sha256(actions_path), "sizeBytes": actions_path.stat().st_size},
            samples_path.name: {"rows": len(samples), "sha256": compute_file_sha256(samples_path), "sizeBytes": samples_path.stat().st_size},
        },
    }
    manifest_path = out_dir / "prod_pit_v3_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只读脱敏导出线上 Mongo PIT V3 Parquet 数据集")
    parser.add_argument("--output-dir", type=Path, default=Path("data/prod_pit_v3"))
    parser.add_argument("--db-name", default=os.getenv("MONGODB_DB_NAME", ""))
    parser.add_argument("--days", type=int, default=0, help="0 表示全量导出历史")
    parser.add_argument("--max-history", type=int, default=64)
    parser.add_argument("--min-history", type=int, default=1)
    parser.add_argument("--salt", default="tg_v3_pit_2026")
    return parser.parse_args()


def main() -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv(Path(__file__).resolve().parents[3] / ".env")
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    except Exception:
        pass

    args = parse_args()
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("MONGODB_URI is required for read-only PIT export")

    report = export_mongo_pit_v3_snapshot(
        uri,
        output_dir=args.output_dir,
        db_name=args.db_name or None,
        days=args.days,
        max_history=args.max_history,
        min_history=args.min_history,
        salt=args.salt,
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
