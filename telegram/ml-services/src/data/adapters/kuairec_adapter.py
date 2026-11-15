"""KuaiRec 2.0 稠密互动 + 中文标题三级类目 V3 Parquet 转换适配器。"""

from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple

import pandas as pd

from src.contracts.actions import (
    ACTION_INDEX_BY_NAME,
    ACTION_TYPE_MAP,
    NUM_PREDICTED_ACTIONS,
    get_dataset_action_mask,
)
from src.contracts.sid import WIRE_MISSING_SID
from src.data.pit_exporter import anonymize_entity_id, detect_language_hint
from src.feature_adapters.history_packer import compute_time_bucket


def _load_kuairec_captions(root: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    posts: List[Dict[str, Any]] = []
    lookup: Dict[str, Dict[str, Any]] = {}
    cap_path = next((p for p in sorted(root.rglob("*.csv")) if "caption" in p.name.lower()), None)
    if cap_path is None or not cap_path.exists():
        return posts, lookup

    df = pd.read_csv(cap_path)
    for row in df.to_dict(orient="records"):
        vid = str(row.get("video_id") or "").strip()
        if not vid:
            continue
        post_id = f"kuairec_v_{vid}"
        caption = str(row.get("manual_cover_text") or row.get("caption") or "").strip()
        topic = str(row.get("topic_tag") or "").strip()
        cats = [
            str(row.get(col) or "").strip()
            for col in ("first_level_category_name", "second_level_category_name", "third_level_category_name")
            if str(row.get(col) or "").strip()
        ]
        item = {
            "post_id": post_id,
            "source_dataset": "kuairec",
            "author_hash": "a_kuairec_unknown",
            "title": caption[:240],
            "content": " ".join(part for part in (caption, topic) if part),
            "keywords": [k for k in topic.split(",") if k.strip()] if topic else [],
            "categories": cats,
            "language_hint": detect_language_hint(caption or " ".join(cats)),
            "has_media": 1,
            "has_video": 1,
            "created_at_ms": 0,
            "is_nsfw": 0,
            "semantic_ids": list(WIRE_MISSING_SID),
        }
        posts.append(item)
        lookup[vid] = item
        lookup[post_id] = item
    return posts, lookup


def convert_kuairec_to_v3_records(
    kuairec_dir: Path,
    *,
    matrix_filename: str = "small_matrix.csv",
    max_history: int = 64,
    min_history: int = 3,
    val_ratio: float = 0.15,
    salt: str = "tg_v3_kuairec",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, int]]:
    """读取 KuaiRec 矩阵与中文类目表，输出统一 V3 Parquet 样本（保留 watch_ratio 正负信号及准确 action_mask）。"""
    base = Path(kuairec_dir)
    mat_path = next((p for p in sorted(base.rglob(matrix_filename)) if p.is_file()), None)
    if mat_path is None:
        mat_path = next((p for p in sorted(base.rglob("*matrix*.csv")) if p.is_file()), None)
    if mat_path is None:
        raise FileNotFoundError(f"KuaiRec matrix CSV not found in {base}")

    posts, cap_lookup = _load_kuairec_captions(base)
    action_mask = get_dataset_action_mask("kuairec")

    by_user: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    stats = {"raw_rows": 0, "skipped_cold_history": 0, "train": 0, "val": 0}

    for chunk in pd.read_csv(mat_path, chunksize=200_000):
        for row in chunk.to_dict(orient="records"):
            stats["raw_rows"] += 1
            uid = str(row.get("user_id") or "").strip()
            vid = str(row.get("video_id") or "").strip()
            raw_ts = float(row.get("timestamp") or row.get("time_ms") or 0.0)
            if not uid or not vid or raw_ts <= 0.0:
                continue
            ts_ms = int(raw_ts if raw_ts > 1e12 else raw_ts * 1000.0)
            row["_vid"] = vid
            row["_ts_ms"] = ts_ms
            by_user[uid].append(row)

    all_ts = sorted(r["_ts_ms"] for rows in by_user.values() for r in rows)
    val_cutoff_ms = all_ts[int(len(all_ts) * (1.0 - val_ratio))] if len(all_ts) >= 20 and val_ratio > 0.0 else (1 << 62)

    records: List[Dict[str, Any]] = []
    for raw_uid, u_rows in by_user.items():
        u_hash = anonymize_entity_id(raw_uid, prefix="krec_u_", salt=salt)
        u_rows.sort(key=lambda r: (r["_ts_ms"], r["_vid"]))
        history_buf: Deque[Dict[str, Any]] = deque(maxlen=max_history)

        idx = 0
        total = len(u_rows)
        while idx < total:
            cur_ts = u_rows[idx]["_ts_ms"]
            end = idx + 1
            while end < total and u_rows[end]["_ts_ms"] == cur_ts:
                end += 1
            slate = u_rows[idx:end]
            idx = end

            if len(history_buf) >= min_history:
                hist_list = list(history_buf)
                hist_pids = [f"kuairec_v_{h['_vid']}" for h in hist_list]
                hist_authors = ["a_kuairec_unknown"] * len(hist_list)
                hist_acts = [int(h["_hist_action_id"]) for h in hist_list]
                hist_ts = [int(h["_ts_ms"]) for h in hist_list]
                hist_bkts = [compute_time_bucket((cur_ts - int(h["_ts_ms"])) / 1000.0) for h in hist_list]
                hist_sids = [list(WIRE_MISSING_SID) for _ in hist_list]

                for pos, row in enumerate(slate):
                    vid = row["_vid"]
                    post_id = f"kuairec_v_{vid}"
                    watch_ratio = float(row.get("watch_ratio") or 0.0)
                    play_ms = float(row.get("play_duration") or row.get("play_time_ms") or 0.0)
                    dur_ms = float(row.get("video_duration") or row.get("duration_ms") or 0.0)

                    labels = [0] * NUM_PREDICTED_ACTIONS
                    labels[ACTION_INDEX_BY_NAME["click"]] = 1 if watch_ratio >= 0.55 else 0
                    labels[ACTION_INDEX_BY_NAME["like"]] = 1 if watch_ratio >= 2.0 else 0
                    labels[ACTION_INDEX_BY_NAME["dwell"]] = 1 if (watch_ratio >= 0.5 or play_ms >= 5_000.0) else 0
                    labels[ACTION_INDEX_BY_NAME["video_view"]] = 1 if (play_ms >= 3_000.0 or watch_ratio >= 0.3) else 0
                    labels[ACTION_INDEX_BY_NAME["not_interested"]] = 1 if watch_ratio < 0.12 else 0
                    vqv_label = 1 if watch_ratio >= 1.0 else 0

                    split_name = "val" if cur_ts >= val_cutoff_ms else "train"
                    stats[split_name] += 1
                    meta = cap_lookup.get(vid, {})

                    records.append(
                        {
                            "sample_id": f"krec:{raw_uid}:{cur_ts}:{pos}:{vid}",
                            "source_dataset": "kuairec",
                            "split": split_name,
                            "user_hash_id": u_hash,
                            "is_demo_cohort": False,
                            "action_ts_ms": cur_ts,
                            "history_post_ids": hist_pids,
                            "history_author_hashes": hist_authors,
                            "history_action_types": hist_acts,
                            "history_ts_ms": hist_ts,
                            "history_time_buckets": hist_bkts,
                            "history_sids": hist_sids,
                            "candidate_post_id": post_id,
                            "candidate_author_hash": "a_kuairec_unknown",
                            "candidate_in_network": 0,
                            "candidate_has_video": 1,
                            "candidate_duration_ms": max(0.0, dur_ms),
                            "candidate_sids": list(WIRE_MISSING_SID),
                            "served_position": pos,
                            "propensity_status": "not_evaluable_deterministic",
                            "propensity_score": -1.0,
                            "action_labels": labels,
                            "action_mask": list(action_mask),
                            "video_quality_view_label": vqv_label,
                            "video_quality_view_mask": 1,
                            "dwell_ms": max(0.0, play_ms),
                            "dwell_mask": 1 if play_ms > 0.0 else 0,
                            "exposure_mask": 1,
                            "is_random_exposure": 0,
                            "candidate_title": str(meta.get("title") or ""),
                        }
                    )
            else:
                stats["skipped_cold_history"] += len(slate)

            for row in slate:
                wr = float(row.get("watch_ratio") or 0.0)
                if wr < 0.12:
                    act_id = ACTION_TYPE_MAP["not_interested"]
                elif wr >= 2.0:
                    act_id = ACTION_TYPE_MAP["like"]
                elif wr >= 1.0:
                    act_id = ACTION_TYPE_MAP["video_quality_view"]
                elif wr >= 0.55:
                    act_id = ACTION_TYPE_MAP["click"]
                else:
                    continue
                item = dict(row)
                item["_hist_action_id"] = act_id
                history_buf.append(item)

    return records, posts, stats
