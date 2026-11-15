"""MIND-Large 英文新闻曝光日志 V3 Parquet 转换适配器：action_mask 仅激活 click，严格无未来泄露。"""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from src.contracts.actions import (
    ACTION_INDEX_BY_NAME,
    ACTION_TYPE_MAP,
    NUM_PREDICTED_ACTIONS,
    get_dataset_action_mask,
)
from src.contracts.sid import WIRE_MISSING_SID
from src.data.pit_exporter import anonymize_entity_id
from src.feature_adapters.history_packer import compute_time_bucket


def _parse_mind_time_ms(raw_time: str) -> int:
    text = str(raw_time or "").strip()
    if not text:
        return 0
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except ValueError:
            continue
    return 0


def _load_mind_news_tsv(news_path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    posts: List[Dict[str, Any]] = []
    lookup: Dict[str, Dict[str, Any]] = {}
    if not news_path.exists():
        return posts, lookup

    with open(news_path, "r", encoding="utf-8", errors="ignore") as handle:
        reader = csv.reader(handle, delimiter="\t")
        for row in reader:
            if len(row) < 4:
                continue
            news_id = str(row[0]).strip()
            category = str(row[1]).strip()
            subcat = str(row[2]).strip()
            title = str(row[3]).strip()
            abstract = str(row[4]).strip() if len(row) > 4 else ""
            if not news_id:
                continue

            post_id = f"mind_{news_id}"
            cats = [c for c in (category, subcat) if c]
            item = {
                "post_id": post_id,
                "source_dataset": "mind",
                "author_hash": "a_mind_editorial",
                "title": title,
                "content": f"{title}. {abstract}".strip(". "),
                "keywords": cats,
                "categories": cats,
                "language_hint": "en",
                "has_media": 0,
                "has_video": 0,
                "created_at_ms": 0,
                "is_nsfw": 0,
                "semantic_ids": list(WIRE_MISSING_SID),
            }
            posts.append(item)
            lookup[news_id] = item
            lookup[post_id] = item
    return posts, lookup


def convert_mind_to_v3_records(
    mind_dir: Path,
    *,
    split: str = "train",
    max_history: int = 50,
    min_history: int = 1,
    salt: str = "tg_v3_mind",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, int]]:
    """
    解析 MIND behaviors.tsv & news.tsv。
    - 每条 behavior 行记录的是当次曝光之前已经发生的点击序列 `history`；
    - 强制为每个历史条目分配严格小于 action_ts_ms 的递增虚拟先后序时间戳 (`action_ts_ms - (L-i)*1000`) 供 PIT 验证；
    - 仅 action_mask[click]=1，其余 12 路与 dwell/vqv 均 strict masked=0。
    """
    base = Path(mind_dir)
    news_path = base / "news.tsv"
    behaviors_path = base / "behaviors.tsv"
    if not behaviors_path.exists():
        raise FileNotFoundError(f"MIND behaviors.tsv not found in {base}")

    posts, news_lookup = _load_mind_news_tsv(news_path)
    action_mask = get_dataset_action_mask("mind")
    click_idx = ACTION_INDEX_BY_NAME["click"]
    click_act_id = ACTION_TYPE_MAP["click"]

    records: List[Dict[str, Any]] = []
    stats = {"behaviors_read": 0, "skipped_cold_history": 0, "candidates_emitted": 0}

    with open(behaviors_path, "r", encoding="utf-8", errors="ignore") as handle:
        reader = csv.reader(handle, delimiter="\t")
        for row in reader:
            if len(row) < 5:
                continue
            stats["behaviors_read"] += 1
            imp_id, raw_uid, raw_time, raw_hist, raw_imprs = row[:5]
            action_ts_ms = _parse_mind_time_ms(raw_time) or 1_600_000_000_000

            hist_tokens = [tok.strip() for tok in str(raw_hist or "").split() if tok.strip()][-max_history:]
            if len(hist_tokens) < min_history:
                stats["skipped_cold_history"] += 1
                continue

            n_hist = len(hist_tokens)
            hist_pids = [f"mind_{nid}" for nid in hist_tokens]
            hist_authors = ["a_mind_editorial"] * n_hist
            hist_acts = [click_act_id] * n_hist
            # 对 MIND 隐式点击序列保持单调递增且严格小于当前曝光时间戳
            hist_ts = [action_ts_ms - ((n_hist - pos) * 60_000) for pos in range(n_hist)]
            hist_bkts = [compute_time_bucket((action_ts_ms - ts) / 1000.0) for ts in hist_ts]
            hist_sids = [list(WIRE_MISSING_SID) for _ in range(n_hist)]

            user_hash = anonymize_entity_id(raw_uid, prefix="mind_u_", salt=salt)
            impr_tokens = [tok.strip() for tok in str(raw_imprs or "").split() if tok.strip()]
            for pos, token in enumerate(impr_tokens):
                if "-" in token:
                    nid, raw_lbl = token.rsplit("-", 1)
                    clicked = 1 if str(raw_lbl).strip() == "1" else 0
                else:
                    nid = token
                    clicked = 0
                labels = [0] * NUM_PREDICTED_ACTIONS
                labels[click_idx] = clicked
                cand_post_id = f"mind_{nid}"
                cand_meta = news_lookup.get(nid, {})

                stats["candidates_emitted"] += 1
                records.append(
                    {
                        "sample_id": f"mind:{imp_id}:{pos}:{nid}",
                        "source_dataset": "mind",
                        "split": split,
                        "user_hash_id": user_hash,
                        "is_demo_cohort": False,
                        "action_ts_ms": action_ts_ms,
                        "history_post_ids": hist_pids,
                        "history_author_hashes": hist_authors,
                        "history_action_types": hist_acts,
                        "history_ts_ms": hist_ts,
                        "history_time_buckets": hist_bkts,
                        "history_sids": hist_sids,
                        "candidate_post_id": cand_post_id,
                        "candidate_author_hash": "a_mind_editorial",
                        "candidate_in_network": 0,
                        "candidate_has_video": 0,
                        "candidate_duration_ms": 0.0,
                        "candidate_sids": list(WIRE_MISSING_SID),
                        "served_position": pos,
                        "propensity_status": "not_evaluable_deterministic",
                        "propensity_score": -1.0,
                        "action_labels": labels,
                        "action_mask": list(action_mask),
                        "video_quality_view_label": 0,
                        "video_quality_view_mask": 0,
                        "dwell_ms": 0.0,
                        "dwell_mask": 0,
                        "exposure_mask": 1,
                        "is_random_exposure": 0,
                        "candidate_title": str(cand_meta.get("title") or ""),
                    }
                )

    return records, posts, stats
