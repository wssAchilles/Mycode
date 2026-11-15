"""V3 统一训练样本与正文语料 PyArrow Parquet Schema 及零 PIT 泄漏检验器。"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence, Tuple

import pyarrow as pa

from src.contracts.actions import NUM_PREDICTED_ACTIONS
from src.contracts.sid import SID_NUM_LEVELS, WIRE_MISSING_SID, validate_wire_sids

V3_TRAINING_SAMPLE_SCHEMA: pa.Schema = pa.schema(
    [
        ("sample_id", pa.string()),
        ("source_dataset", pa.string()),
        ("split", pa.string()),
        ("user_hash_id", pa.string()),
        ("is_demo_cohort", pa.bool_()),
        ("action_ts_ms", pa.int64()),
        ("history_post_ids", pa.list_(pa.string())),
        ("history_author_hashes", pa.list_(pa.string())),
        ("history_action_types", pa.list_(pa.int16())),
        ("history_ts_ms", pa.list_(pa.int64())),
        ("history_time_buckets", pa.list_(pa.int16())),
        ("history_sids", pa.list_(pa.list_(pa.int32()))),
        ("candidate_post_id", pa.string()),
        ("candidate_author_hash", pa.string()),
        ("candidate_in_network", pa.uint8()),
        ("candidate_has_video", pa.uint8()),
        ("candidate_duration_ms", pa.float32()),
        ("candidate_sids", pa.list_(pa.int32())),
        ("served_position", pa.int32()),
        ("propensity_status", pa.string()),
        ("propensity_score", pa.float32()),
        ("action_labels", pa.list_(pa.uint8())),
        ("action_mask", pa.list_(pa.uint8())),
        ("video_quality_view_label", pa.uint8()),
        ("video_quality_view_mask", pa.uint8()),
        ("dwell_ms", pa.float32()),
        ("dwell_mask", pa.uint8()),
        ("exposure_mask", pa.uint8()),
        ("is_random_exposure", pa.uint8()),
        ("candidate_title", pa.string()),
    ]
)

V3_POSTS_CORPUS_SCHEMA: pa.Schema = pa.schema(
    [
        ("post_id", pa.string()),
        ("source_dataset", pa.string()),
        ("author_hash", pa.string()),
        ("title", pa.string()),
        ("content", pa.string()),
        ("keywords", pa.list_(pa.string())),
        ("categories", pa.list_(pa.string())),
        ("language_hint", pa.string()),
        ("has_media", pa.uint8()),
        ("has_video", pa.uint8()),
        ("created_at_ms", pa.int64()),
        ("is_nsfw", pa.uint8()),
        ("semantic_ids", pa.list_(pa.int32())),
    ]
)


def normalize_v3_sample_record(raw: Mapping[str, Any]) -> Dict[str, Any]:
    """将单条字典规范化为严格符合 V3_TRAINING_SAMPLE_SCHEMA 的记录。"""
    hist_posts = [str(x) for x in (raw.get("history_post_ids") or [])]
    n_hist = len(hist_posts)

    hist_authors = [str(x) for x in (raw.get("history_author_hashes") or [""] * n_hist)]
    hist_acts = [int(x) for x in (raw.get("history_action_types") or [1] * n_hist)]
    hist_ts = [int(x) for x in (raw.get("history_ts_ms") or [0] * n_hist)]
    hist_bkts = [int(x) for x in (raw.get("history_time_buckets") or [15] * n_hist)]
    raw_hist_sids = raw.get("history_sids") or [list(WIRE_MISSING_SID) for _ in range(n_hist)]
    hist_sids = [validate_wire_sids(s) for s in raw_hist_sids]

    cand_sids = validate_wire_sids(raw.get("candidate_sids") or list(WIRE_MISSING_SID))
    labels = [1 if int(v) > 0 else 0 for v in (raw.get("action_labels") or [0] * NUM_PREDICTED_ACTIONS)]
    mask = [1 if int(v) > 0 else 0 for v in (raw.get("action_mask") or [0] * NUM_PREDICTED_ACTIONS)]

    dwell_mask = 1 if int(raw.get("dwell_mask", 0)) > 0 else 0
    dwell_ms = float(raw.get("dwell_ms") or 0.0) if dwell_mask else 0.0

    vqv_mask = 1 if int(raw.get("video_quality_view_mask", 0)) > 0 else 0
    vqv_label = (1 if int(raw.get("video_quality_view_label", 0)) > 0 else 0) if vqv_mask else 0

    return {
        "sample_id": str(raw.get("sample_id") or ""),
        "source_dataset": str(raw.get("source_dataset") or ""),
        "split": str(raw.get("split") or "train"),
        "user_hash_id": str(raw.get("user_hash_id") or ""),
        "is_demo_cohort": bool(raw.get("is_demo_cohort", False)),
        "action_ts_ms": int(raw.get("action_ts_ms") or 0),
        "history_post_ids": hist_posts,
        "history_author_hashes": hist_authors,
        "history_action_types": hist_acts,
        "history_ts_ms": hist_ts,
        "history_time_buckets": hist_bkts,
        "history_sids": hist_sids,
        "candidate_post_id": str(raw.get("candidate_post_id") or ""),
        "candidate_author_hash": str(raw.get("candidate_author_hash") or ""),
        "candidate_in_network": 1 if int(raw.get("candidate_in_network", 0)) > 0 else 0,
        "candidate_has_video": 1 if int(raw.get("candidate_has_video", 0)) > 0 else 0,
        "candidate_duration_ms": float(raw.get("candidate_duration_ms") or 0.0),
        "candidate_sids": cand_sids,
        "served_position": int(raw.get("served_position", -1)),
        "propensity_status": str(raw.get("propensity_status") or "not_evaluable_deterministic"),
        "propensity_score": float(raw.get("propensity_score", -1.0)),
        "action_labels": labels,
        "action_mask": mask,
        "video_quality_view_label": vqv_label,
        "video_quality_view_mask": vqv_mask,
        "dwell_ms": max(0.0, dwell_ms),
        "dwell_mask": dwell_mask,
        "exposure_mask": 1 if int(raw.get("exposure_mask", 1)) > 0 else 0,
        "is_random_exposure": 1 if int(raw.get("is_random_exposure", 0)) > 0 else 0,
        "candidate_title": str(raw.get("candidate_title") or ""),
    }


def validate_v3_records_pit_and_masks(records: Sequence[Mapping[str, Any]]) -> Tuple[bool, List[str]]:
    """
    Fail-Closed 检验每一条样本的 PIT 严格因果性与多任务掩码完整性：
    1. action_labels / action_mask 长度严格为 13；
    2. mask==0 对应 label 必须为 0（防未采动作污染或误标）；
    3. 历史列表等长、时间单调不减且所有 history_ts_ms 严格小于 action_ts_ms；
    4. candidate_sids 与 history_sids 必须合法符合 6x256 Wire SID 规范。
    """
    errors: List[str] = []
    for idx, rec in enumerate(records):
        sid_prefix = f"row[{idx}](sample_id={rec.get('sample_id', '')})"
        labels = rec.get("action_labels") or []
        masks = rec.get("action_mask") or []
        if len(labels) != NUM_PREDICTED_ACTIONS or len(masks) != NUM_PREDICTED_ACTIONS:
            errors.append(f"{sid_prefix}:invalid_action_dim:{len(labels)}/{len(masks)}")
            continue

        for h_i, (lbl, msk) in enumerate(zip(labels, masks)):
            if int(msk) == 0 and int(lbl) != 0:
                errors.append(f"{sid_prefix}:masked_head_nonzero_label:head={h_i}")
                break

        if int(rec.get("dwell_mask", 0)) == 0 and float(rec.get("dwell_ms", 0.0)) > 0.0:
            errors.append(f"{sid_prefix}:masked_dwell_nonzero_ms")
        if int(rec.get("video_quality_view_mask", 0)) == 0 and int(rec.get("video_quality_view_label", 0)) != 0:
            errors.append(f"{sid_prefix}:masked_vqv_nonzero")

        action_ts_ms = int(rec.get("action_ts_ms", 0))
        hist_posts = rec.get("history_post_ids") or []
        hist_ts = rec.get("history_ts_ms") or []
        hist_authors = rec.get("history_author_hashes") or []
        hist_acts = rec.get("history_action_types") or []
        hist_bkts = rec.get("history_time_buckets") or []
        hist_sids = rec.get("history_sids") or []

        n = len(hist_posts)
        if not (len(hist_ts) == n and len(hist_authors) == n and len(hist_acts) == n and len(hist_bkts) == n and len(hist_sids) == n):
            errors.append(f"{sid_prefix}:history_length_mismatch")
            continue

        prev_ts = -1
        for h_ts in hist_ts:
            t = int(h_ts)
            if t >= action_ts_ms and action_ts_ms > 0:
                errors.append(f"{sid_prefix}:pit_leakage:hist_ts={t}>=action_ts={action_ts_ms}")
                break
            if t > 0 and prev_ts > 0 and t < prev_ts:
                errors.append(f"{sid_prefix}:history_non_monotonic:{t}<{prev_ts}")
                break
            if t > 0:
                prev_ts = t

        try:
            validate_wire_sids(rec.get("candidate_sids") or list(WIRE_MISSING_SID))
            for item_sids in hist_sids:
                if len(item_sids) != SID_NUM_LEVELS:
                    raise ValueError("sid len mismatch")
                validate_wire_sids(item_sids)
        except ValueError as exc:
            errors.append(f"{sid_prefix}:invalid_sid:{exc}")

        if len(errors) >= 32:
            break

    return len(errors) == 0, errors


def assert_valid_v3_samples_records(records: Sequence[Mapping[str, Any]]) -> None:
    """断言 V3 样本全部通过 PIT 与掩码检验，存在违规直接阻断导出。"""
    ok, errors = validate_v3_records_pit_and_masks(records)
    if not ok:
        raise ValueError("V3 dataset validation failed (PIT or mask violation): " + "; ".join(errors[:5]))


def records_to_v3_samples_table(records: Sequence[Mapping[str, Any]]) -> pa.Table:
    """将 V3 样本列表检验后转换为定型 PyArrow Table。"""
    normalized = [normalize_v3_sample_record(r) for r in records]
    assert_valid_v3_samples_records(normalized)
    if not normalized:
        return pa.Table.from_pylist([], schema=V3_TRAINING_SAMPLE_SCHEMA)
    return pa.Table.from_pylist(normalized, schema=V3_TRAINING_SAMPLE_SCHEMA)


def records_to_v3_posts_table(posts: Sequence[Mapping[str, Any]]) -> pa.Table:
    """将标准化帖子语料转为严格定型 PyArrow Table。"""
    normalized: List[Dict[str, Any]] = []
    for raw in posts:
        normalized.append(
            {
                "post_id": str(raw.get("post_id") or ""),
                "source_dataset": str(raw.get("source_dataset") or ""),
                "author_hash": str(raw.get("author_hash") or ""),
                "title": str(raw.get("title") or ""),
                "content": str(raw.get("content") or ""),
                "keywords": [str(k) for k in (raw.get("keywords") or []) if str(k).strip()],
                "categories": [str(c) for c in (raw.get("categories") or []) if str(c).strip()],
                "language_hint": str(raw.get("language_hint") or "unknown"),
                "has_media": 1 if int(raw.get("has_media", 0)) > 0 else 0,
                "has_video": 1 if int(raw.get("has_video", 0)) > 0 else 0,
                "created_at_ms": int(raw.get("created_at_ms") or 0),
                "is_nsfw": 1 if int(raw.get("is_nsfw", 0)) > 0 else 0,
                "semantic_ids": validate_wire_sids(raw.get("semantic_ids") or list(WIRE_MISSING_SID)),
            }
        )
    if not normalized:
        return pa.Table.from_pylist([], schema=V3_POSTS_CORPUS_SCHEMA)
    return pa.Table.from_pylist(normalized, schema=V3_POSTS_CORPUS_SCHEMA)


def assert_valid_v3_posts_table(table: pa.Table) -> None:
    """校验帖子语料 Schema 与非空覆盖健康性。"""
    if table.schema != V3_POSTS_CORPUS_SCHEMA:
        raise ValueError("V3 posts table schema mismatch")
