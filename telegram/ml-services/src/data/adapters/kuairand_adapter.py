"""KuaiRand-27K V3 Parquet 转换适配器：严禁全周期统计表，同毫秒 Slate 隔离 + 9 路真实 action_mask。"""

from __future__ import annotations

from collections import defaultdict, deque
import csv
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
import zlib

import pandas as pd

from src.contracts.actions import (
    ACTION_INDEX_BY_NAME,
    ACTION_TYPE_MAP,
    NUM_PREDICTED_ACTIONS,
    get_dataset_action_mask,
)
from src.contracts.sid import WIRE_MISSING_SID
from src.data.pit_exporter import anonymize_entity_id, detect_language_hint, safe_finite_float
from src.feature_adapters.history_packer import compute_time_bucket

_INTERACTION_COLS = (
    "user_id",
    "video_id",
    "time_ms",
    "is_click",
    "is_like",
    "is_follow",
    "is_comment",
    "is_forward",
    "is_hate",
    "long_view",
    "play_time_ms",
    "duration_ms",
    "is_profile_enter",
    "is_rand",
    "tab",
)

_HISTORY_PRIORITY: Tuple[Tuple[str, str], ...] = (
    ("is_hate", "not_interested"),
    ("is_follow", "follow_author"),
    ("is_forward", "repost"),
    ("is_comment", "reply"),
    ("is_like", "like"),
    ("is_profile_enter", "profile_click"),
    ("long_view", "video_quality_view"),
    ("is_click", "click"),
)


def _discover_kuairand_inputs(root: Path) -> Tuple[List[Path], List[Path], Optional[Path], Optional[Path]]:
    """严格白名单发现机制：显式跳过 video_features_statistic* 全周期静态统计表防止未来泄露。"""
    base = Path(root)
    if not base.exists():
        raise FileNotFoundError(f"KuaiRand directory does not exist: {base}")

    all_csv = [p for p in sorted(base.rglob("*.csv")) if p.is_file() and "statistic" not in p.name.lower()]
    std_logs = [p for p in all_csv if p.name.startswith("log_standard")]
    rand_logs = [p for p in all_csv if p.name.startswith("log_random")]
    if not std_logs and not rand_logs:
        std_logs = [p for p in all_csv if p.name.startswith("log_")]

    basic_meta = next((p for p in all_csv if p.name.startswith("video_features_basic")), None)
    captions_csv = next((p for p in all_csv if "caption" in p.name.lower()), None)
    return std_logs, rand_logs, basic_meta, captions_csv


def _load_video_meta(basic_path: Optional[Path], captions_path: Optional[Path]) -> Dict[str, Dict[str, Any]]:
    meta: Dict[str, Dict[str, Any]] = {}
    if basic_path is not None and basic_path.exists():
        for chunk in pd.read_csv(
            basic_path,
            usecols=lambda c: c in {"video_id", "author_id", "video_type", "upload_type", "duration_ms"},
            chunksize=200_000,
        ):
            for row in chunk.itertuples(index=False):
                vid = str(getattr(row, "video_id", ""))
                if not vid:
                    continue
                vtype = str(getattr(row, "video_type", "") or "").upper()
                utype = str(getattr(row, "upload_type", "") or "").upper()
                is_ad = ("AD" in vtype) or ("AD" in utype) or ("SPONSOR" in vtype)
                meta[vid] = {
                    "author_id": str(getattr(row, "author_id", "") or "unknown"),
                    "is_ad": is_ad,
                    "duration_ms": float(getattr(row, "duration_ms", 0.0) or 0.0),
                    "title": "",
                }

    if captions_path is not None and captions_path.exists():
        for chunk in pd.read_csv(captions_path, chunksize=100_000):
            vid_col = "final_video_id" if "final_video_id" in chunk.columns else "video_id"
            if vid_col not in chunk.columns:
                continue
            for row in chunk.to_dict(orient="records"):
                vid = str(row.get(vid_col) or "").strip()
                if not vid:
                    continue
                caption = str(row.get("caption") or "").strip()
                cover = str(row.get("show_cover_text") or "").strip()
                combined = f"{caption} {cover}".strip()
                entry = meta.setdefault(vid, {"author_id": "unknown", "is_ad": False, "duration_ms": 0.0, "title": ""})
                if combined:
                    entry["title"] = combined[:240]
    return meta


def convert_kuairand_to_v3_records(
    kuairand_dir: Path,
    *,
    max_history: int = 64,
    min_history: int = 3,
    user_sample_mod: int = 1,
    chunk_size: int = 200_000,
    exclude_ads: bool = True,
    val_ratio: float = 0.15,
    salt: str = "tg_v3_kuairand",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, int]]:
    """
    将 KuaiRand 原始目录流式转为 (sample_records, posts_corpus_records, stats)。
    确保严格因果顺序：同 time_ms 曝光彼此隔离，历史序列严格 max(hist_ts) < action_ts_ms。
    """
    std_logs, rand_logs, basic_path, captions_path = _discover_kuairand_inputs(kuairand_dir)
    if not std_logs and not rand_logs:
        raise FileNotFoundError(f"no KuaiRand log_*.csv files found in {kuairand_dir}")

    video_meta = _load_video_meta(basic_path, captions_path)
    action_mask = get_dataset_action_mask("kuairand")

    by_user: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    stats = {"raw_rows": 0, "skipped_ads": 0, "skipped_cold_history": 0, "train": 0, "val": 0, "eval_random": 0}

    for is_rand_default, path_list in ((0, std_logs), (1, rand_logs)):
        for csv_path in path_list:
            header = pd.read_csv(csv_path, nrows=0).columns.tolist()
            usecols = [c for c in _INTERACTION_COLS if c in header]
            for chunk in pd.read_csv(csv_path, usecols=usecols, chunksize=max(1, int(chunk_size))):
                for row in chunk.to_dict(orient="records"):
                    stats["raw_rows"] += 1
                    raw_uid = str(row.get("user_id") or "").strip()
                    if not raw_uid:
                        continue
                    if user_sample_mod > 1 and (zlib.crc32(raw_uid.encode("utf-8")) % int(user_sample_mod)) != 0:
                        continue

                    vid = str(row.get("video_id") or "").strip()
                    meta = video_meta.get(vid, {})
                    if exclude_ads and meta.get("is_ad"):
                        stats["skipped_ads"] += 1
                        continue

                    ts_ms = int(safe_finite_float(row.get("time_ms"), 0.0))
                    if ts_ms <= 0:
                        continue

                    is_rand = int(safe_finite_float(row.get("is_rand"), float(is_rand_default)))
                    row["_vid"] = vid
                    row["_ts_ms"] = ts_ms
                    row["_is_rand"] = 1 if is_rand > 0 else 0
                    row["_author_id"] = str(meta.get("author_id") or "unknown")
                    row["_duration_ms"] = safe_finite_float(
                        row.get("duration_ms") if row.get("duration_ms") is not None else meta.get("duration_ms"),
                        0.0,
                    )
                    row["_title"] = str(meta.get("title") or "")
                    by_user[raw_uid].append(row)

    # 基于非随机事件时间分位切分 train / val
    std_times = sorted(r["_ts_ms"] for rows in by_user.values() for r in rows if r["_is_rand"] == 0)
    val_cutoff_ms = std_times[int(len(std_times) * (1.0 - val_ratio))] if len(std_times) >= 20 and val_ratio > 0.0 else (1 << 62)

    records: List[Dict[str, Any]] = []
    posts_seen: Dict[str, Dict[str, Any]] = {}

    for raw_uid, u_rows in by_user.items():
        u_hash = anonymize_entity_id(raw_uid, prefix="kuai_u_", salt=salt)
        u_rows.sort(key=lambda r: (r["_ts_ms"], r["_vid"]))
        history_buf: Deque[Dict[str, Any]] = deque(maxlen=max_history)

        # 按精确 time_ms 分同秒 Slate 防止同行页内泄露
        idx = 0
        total_rows = len(u_rows)
        while idx < total_rows:
            cur_ts_ms = u_rows[idx]["_ts_ms"]
            end = idx + 1
            while end < total_rows and u_rows[end]["_ts_ms"] == cur_ts_ms:
                end += 1
            slate = u_rows[idx:end]
            idx = end

            if len(history_buf) >= min_history:
                hist_list = list(history_buf)
                hist_pids = [f"kuairand_v_{h['_vid']}" for h in hist_list]
                hist_auths = [anonymize_entity_id(h["_author_id"], prefix="kuai_a_", salt=salt) for h in hist_list]
                hist_acts = [int(h["_hist_action_id"]) for h in hist_list]
                hist_ts = [int(h["_ts_ms"]) for h in hist_list]
                hist_bkts = [compute_time_bucket((cur_ts_ms - int(h["_ts_ms"])) / 1000.0) for h in hist_list]
                hist_sids = [list(WIRE_MISSING_SID) for _ in hist_list]

                for pos_in_slate, row in enumerate(slate):
                    vid = row["_vid"]
                    post_id = f"kuairand_v_{vid}"
                    author_hash = anonymize_entity_id(row["_author_id"], prefix="kuai_a_", salt=salt)
                    play_ms = safe_finite_float(row.get("play_time_ms"), 0.0)
                    dur_ms = safe_finite_float(row.get("_duration_ms"), 0.0)
                    is_click = int(safe_finite_float(row.get("is_click"), 0.0) > 0)
                    long_view = int(safe_finite_float(row.get("long_view"), 0.0) > 0)

                    labels = [0] * NUM_PREDICTED_ACTIONS
                    labels[ACTION_INDEX_BY_NAME["click"]] = is_click
                    labels[ACTION_INDEX_BY_NAME["like"]] = int(safe_finite_float(row.get("is_like"), 0.0) > 0)
                    labels[ACTION_INDEX_BY_NAME["reply"]] = int(safe_finite_float(row.get("is_comment"), 0.0) > 0)
                    fwd = int(safe_finite_float(row.get("is_forward"), 0.0) > 0)
                    labels[ACTION_INDEX_BY_NAME["repost"]] = fwd
                    labels[ACTION_INDEX_BY_NAME["share"]] = fwd
                    labels[ACTION_INDEX_BY_NAME["follow_author"]] = int(safe_finite_float(row.get("is_follow"), 0.0) > 0)
                    labels[ACTION_INDEX_BY_NAME["not_interested"]] = int(safe_finite_float(row.get("is_hate"), 0.0) > 0)

                    # 被动未点击且超短滑过 (例如 900ms) 严格不标 dwell 正例
                    engaged_any = any(labels[i] > 0 for i in range(6)) or labels[ACTION_INDEX_BY_NAME["follow_author"]] > 0
                    labels[ACTION_INDEX_BY_NAME["dwell"]] = 1 if (long_view or (engaged_any and play_ms >= 5_000.0)) else 0
                    labels[ACTION_INDEX_BY_NAME["video_view"]] = 1 if (play_ms >= 3_000.0 and (is_click or long_view or play_ms >= 3_000.0)) else 0
                    vqv_label = 1 if (long_view or (dur_ms > 0 and (play_ms / dur_ms) >= 0.8)) else 0

                    split_name = "eval_random" if row["_is_rand"] else ("val" if cur_ts_ms >= val_cutoff_ms else "train")
                    stats[split_name] += 1

                    records.append(
                        {
                            "sample_id": f"kuai:{raw_uid}:{cur_ts_ms}:{pos_in_slate}:{vid}",
                            "source_dataset": "kuairand",
                            "split": split_name,
                            "user_hash_id": u_hash,
                            "is_demo_cohort": False,
                            "action_ts_ms": cur_ts_ms,
                            "history_post_ids": hist_pids,
                            "history_author_hashes": hist_auths,
                            "history_action_types": hist_acts,
                            "history_ts_ms": hist_ts,
                            "history_time_buckets": hist_bkts,
                            "history_sids": hist_sids,
                            "candidate_post_id": post_id,
                            "candidate_author_hash": author_hash,
                            "candidate_in_network": 1 if int(row.get("tab") or 1) == 0 else 0,
                            "candidate_has_video": 1,
                            "candidate_duration_ms": max(0.0, dur_ms),
                            "candidate_sids": list(WIRE_MISSING_SID),
                            "served_position": pos_in_slate,
                            "propensity_status": "logged_randomized" if row["_is_rand"] else "not_evaluable_deterministic",
                            "propensity_score": 0.05 if row["_is_rand"] else -1.0,
                            "action_labels": labels,
                            "action_mask": list(action_mask),
                            "video_quality_view_label": vqv_label,
                            "video_quality_view_mask": 1,
                            "dwell_ms": max(0.0, play_ms),
                            "dwell_mask": 1,
                            "exposure_mask": 1,
                            "is_random_exposure": row["_is_rand"],
                            "candidate_title": row["_title"],
                        }
                    )

                    if post_id not in posts_seen and row["_title"]:
                        posts_seen[post_id] = {
                            "post_id": post_id,
                            "source_dataset": "kuairand",
                            "author_hash": author_hash,
                            "title": row["_title"],
                            "content": row["_title"],
                            "keywords": [],
                            "categories": [],
                            "language_hint": detect_language_hint(row["_title"]),
                            "has_media": 1,
                            "has_video": 1,
                            "created_at_ms": cur_ts_ms,
                            "is_nsfw": 0,
                            "semantic_ids": list(WIRE_MISSING_SID),
                        }
            else:
                stats["skipped_cold_history"] += len(slate)

            # 同批完成后再将真交互写入历史缓冲（忽略纯未互动曝光防历史膨胀）
            for row in slate:
                chosen_action: Optional[str] = None
                for col_name, act_name in _HISTORY_PRIORITY:
                    if safe_finite_float(row.get(col_name), 0.0) > 0.0:
                        chosen_action = act_name
                        break
                if chosen_action is None and safe_finite_float(row.get("play_time_ms"), 0.0) >= 5_000.0:
                    chosen_action = "dwell"
                if chosen_action is not None:
                    hist_item = dict(row)
                    hist_item["_hist_action_id"] = ACTION_TYPE_MAP[chosen_action]
                    history_buf.append(hist_item)

    return records, list(posts_seen.values()), stats
