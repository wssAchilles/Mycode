"""MicroLens-100k 双格式兼容适配器（支持 Westlake 英文标题子集 & MMRec microlens.inter/.npy 兜底包）。"""

from __future__ import annotations

from collections import defaultdict, deque
import csv
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


def _load_microlens_titles_and_tags(root: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    posts: List[Dict[str, Any]] = []
    lookup: Dict[str, Dict[str, Any]] = {}

    title_csv = next((p for p in sorted(root.rglob("*.csv")) if "title" in p.name.lower()), None)
    tags_csv = next((p for p in sorted(root.rglob("*.csv")) if "tags_to_summary" in p.name.lower()), None)
    tags_map: Dict[str, List[str]] = {}
    if tags_csv is not None and tags_csv.exists():
        for row in pd.read_csv(tags_csv).to_dict(orient="records"):
            iid = str(row.get("item") or row.get("item_id") or "").strip()
            tag = str(row.get("tag") or row.get("tags") or row.get("summary") or "").strip()
            if iid and tag:
                tags_map.setdefault(iid, []).append(tag)

    if title_csv is not None and title_csv.exists():
        for row in pd.read_csv(title_csv).to_dict(orient="records"):
            iid = str(row.get("item") or row.get("item_id") or row.get("id") or "").strip()
            title = str(row.get("title") or row.get("title_en") or "").strip()
            if not iid:
                continue
            post_id = f"mlens_{iid}"
            kw = tags_map.get(iid, [])
            item = {
                "post_id": post_id,
                "source_dataset": "microlens",
                "author_hash": "a_microlens",
                "title": title,
                "content": f"{title}. {' '.join(kw)}".strip(),
                "keywords": kw,
                "categories": kw,
                "language_hint": detect_language_hint(title),
                "has_media": 1,
                "has_video": 1,
                "created_at_ms": 0,
                "is_nsfw": 0,
                "semantic_ids": list(WIRE_MISSING_SID),
            }
            posts.append(item)
            lookup[iid] = item
            lookup[post_id] = item
    return posts, lookup


def convert_microlens_to_v3_records(
    microlens_dir: Path,
    *,
    max_history: int = 50,
    min_history: int = 2,
    val_ratio: float = 0.15,
    salt: str = "tg_v3_microlens",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    解析 MicroLens-100k pairs.csv 或 MMRec 兜底格式 microlens.inter。
    重要契约约束：纯正反馈隐式交互无真实曝光负样本，因此强制设置 exposure_mask=0,
    propensity_status='unobserved_positive_only'，绝不污染真实 CTR 校准评估。
    """
    base = Path(microlens_dir)
    if not base.exists():
        raise FileNotFoundError(f"MicroLens directory not found: {base}")

    posts, item_lookup = _load_microlens_titles_and_tags(base)
    action_mask = get_dataset_action_mask("microlens")

    inter_file = next((p for p in sorted(base.rglob("*.inter")) if p.is_file()), None)
    pairs_file = next((p for p in sorted(base.rglob("*pairs*")) if p.is_file() and p.suffix in {".csv", ".tsv"}), None)
    src_file = pairs_file or inter_file
    if src_file is None:
        raise FileNotFoundError(f"no pairs or .inter interaction file found in {base}")

    sep = "\t" if src_file.suffix in {".tsv", ".inter"} else ","
    # 检测 MMRec `.inter` 表头 `user_id:token\titem_id:token\ttimestamp:float`
    by_user: Dict[str, List[Tuple[int, str, int]]] = defaultdict(list)
    raw_rows = 0

    df_iter = pd.read_csv(src_file, sep=sep, chunksize=200_000)
    for chunk in df_iter:
        cols_clean = {c: c.split(":")[0].strip().lower() for c in chunk.columns}
        chunk = chunk.rename(columns=cols_clean)
        u_col = next((c for c in ("user_id", "user", "uid") if c in chunk.columns), chunk.columns[0])
        i_col = next((c for c in ("item_id", "item", "iid") if c in chunk.columns), chunk.columns[1])
        t_col = next((c for c in ("timestamp", "time", "ts") if c in chunk.columns), None)
        has_comment_col = "comment" in chunk.columns or "review" in chunk.columns

        for idx_row, row in enumerate(chunk.to_dict(orient="records")):
            raw_rows += 1
            uid = str(row.get(u_col) or "").strip()
            iid = str(row.get(i_col) or "").strip()
            if not uid or not iid:
                continue
            raw_ts = float(row.get(t_col) or (1_650_000_000 + raw_rows)) if t_col else float(1_650_000_000 + raw_rows)
            ts_ms = int(raw_ts if raw_ts > 1e12 else raw_ts * 1000.0)
            has_reply = 1 if (has_comment_col and str(row.get("comment") or row.get("review") or "").strip()) else 0
            by_user[uid].append((ts_ms, iid, has_reply))

    all_ts = sorted(item[0] for rows in by_user.values() for item in rows)
    val_cutoff_ms = all_ts[int(len(all_ts) * (1.0 - val_ratio))] if len(all_ts) >= 20 and val_ratio > 0.0 else (1 << 62)

    records: List[Dict[str, Any]] = []
    stats: Dict[str, Any] = {
        "mode": "pairs" if pairs_file else "mmrec_inter_fallback",
        "raw_rows": raw_rows,
        "skipped_cold_history": 0,
        "train": 0,
        "val": 0,
    }

    for raw_uid, events in by_user.items():
        u_hash = anonymize_entity_id(raw_uid, prefix="mlens_u_", salt=salt)
        events.sort(key=lambda x: (x[0], x[1]))
        # 严格按相等时间戳隔离防泄密：即使 .inter 自带顺序若 ts 重复则分到同组
        history_buf: Deque[Tuple[int, str, int]] = deque(maxlen=max_history)

        i = 0
        while i < len(events):
            cur_ts = events[i][0]
            j = i + 1
            while j < len(events) and events[j][0] == cur_ts:
                j += 1
            group = events[i:j]
            i = j

            if len(history_buf) >= min_history:
                hist_list = list(history_buf)
                hist_pids = [f"mlens_{x[1]}" for x in hist_list]
                hist_authors = ["a_microlens"] * len(hist_list)
                hist_acts = [ACTION_TYPE_MAP["reply"] if x[2] else ACTION_TYPE_MAP["click"] for x in hist_list]
                hist_ts = [int(x[0]) for x in hist_list]
                hist_bkts = [compute_time_bucket((cur_ts - int(x[0])) / 1000.0) for x in hist_list]
                hist_sids = [list(WIRE_MISSING_SID) for _ in hist_list]

                for pos, (_ts, iid, has_reply) in enumerate(group):
                    labels = [0] * NUM_PREDICTED_ACTIONS
                    labels[ACTION_INDEX_BY_NAME["click"]] = 1
                    labels[ACTION_INDEX_BY_NAME["reply"]] = has_reply
                    split_name = "val" if cur_ts >= val_cutoff_ms else "train"
                    stats[split_name] += 1
                    meta = item_lookup.get(iid, {})

                    records.append(
                        {
                            "sample_id": f"mlens:{raw_uid}:{cur_ts}:{pos}:{iid}",
                            "source_dataset": "microlens",
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
                            "candidate_post_id": f"mlens_{iid}",
                            "candidate_author_hash": "a_microlens",
                            "candidate_in_network": 0,
                            "candidate_has_video": 1,
                            "candidate_duration_ms": 0.0,
                            "candidate_sids": list(WIRE_MISSING_SID),
                            "served_position": -1,
                            "propensity_status": "unobserved_positive_only",
                            "propensity_score": -1.0,
                            "action_labels": labels,
                            "action_mask": list(action_mask),
                            "video_quality_view_label": 0,
                            "video_quality_view_mask": 0,
                            "dwell_ms": 0.0,
                            "dwell_mask": 0,
                            "exposure_mask": 0,  # 显式标记无曝光负样本
                            "is_random_exposure": 0,
                            "candidate_title": str(meta.get("title") or ""),
                        }
                    )
            else:
                stats["skipped_cold_history"] += len(group)

            for item in group:
                history_buf.append(item)

    return records, posts, stats
