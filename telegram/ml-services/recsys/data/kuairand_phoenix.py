"""KuaiRand-27K 原始多信号日志到 Phoenix V2 严格 PIT 多候选 Slate 样本的流式转换器。"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import pickle
import tempfile
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Set, Tuple
import zlib

import pandas as pd

from recsys.contracts.actions import ACTION_TYPE_MAP, PREDICTED_ACTIONS
from recsys.data.pit_export import compute_time_bucket

# KuaiRand 日志提取的必要列（其余统计辅助列按需跳过以压缩内存）
_INTERACTION_COLUMNS: Tuple[str, ...] = (
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

# 同一历史条目的主导交互动作选择优先级
_HISTORY_ACTION_PRIORITY: Tuple[Tuple[str, str], ...] = (
    ("is_hate", "not_interested"),
    ("is_follow", "follow_author"),
    ("is_forward", "repost"),
    ("is_comment", "reply"),
    ("is_like", "like"),
    ("is_profile_enter", "profile_click"),
    ("long_view", "video_quality_view"),
    ("is_click", "click"),
)

# KuaiRand 与真实短视频场景对齐的最小有效停留判定阈值（毫秒）
_DWELL_POSITIVE_MS = 5_000.0
_VIDEO_VIEW_MIN_MS = 3_000.0
_DEFAULT_HISTORY_KEEP = 64


@dataclass(frozen=True)
class KuaiRandConvertConfig:
    """KuaiRand -> Phoenix V2 PIT 流式预处理参数配置。"""

    kuairand_dir: Path
    output_dir: Path
    train_filename: str = "phoenix_v2_kuairand_train.pkl"
    val_rand_filename: str = "phoenix_v2_kuairand_val_rand.pkl"
    max_history: int = _DEFAULT_HISTORY_KEEP
    min_history: int = 3
    max_candidates: int = 32
    max_train_slates: int = 0  # 0 表示不限制总量
    max_val_rand_slates: int = 0
    num_buckets: int = 16
    user_sample_mod: int = 1  # >1 时按确定性哈希抽取约 1/N 用户的完整时间线
    chunk_size: int = 250_000
    shard_slates: int = 0  # >0 时将样本流式写入 train/ 与 eval_random/ 压缩分片目录，显著降低内存峰值
    exclude_ads: bool = True
    seed: int = 42


@dataclass
class KuaiRandConvertStats:
    """记录转换过程中的关键质量指标，写入清单便于后续训练门禁审计。"""

    raw_rows_read: int = 0
    selected_rows: int = 0
    users_emitted: int = 0
    train_slates: int = 0
    train_candidates: int = 0
    val_rand_slates: int = 0
    val_rand_candidates: int = 0
    skipped_ads: int = 0
    skipped_cold_history: int = 0
    video_metadata_matched: int = 0
    source_files: List[str] = field(default_factory=list)


def discover_kuairand_files(
    root: Path,
) -> Tuple[List[Path], List[Path], Optional[Path]]:
    """自动发现 KuaiRand 标准日志、随机曝光日志以及视频基础特征文件。"""
    base = Path(root)
    if not base.exists():
        raise FileNotFoundError(f"KuaiRand 目录不存在: {base}")

    all_csv = sorted(p for p in base.rglob("*.csv") if p.is_file())
    standard_files = [
        p
        for p in all_csv
        if p.name.startswith("log_standard")
    ]
    random_files = [
        p
        for p in all_csv
        if p.name.startswith("log_random")
    ]
    # 若目录下未严格按官方命名分段，回退匹配通用 log_*.csv
    if not standard_files and not random_files:
        for p in all_csv:
            if p.name.startswith("log_"):
                if "random" in p.name.lower():
                    random_files.append(p)
                else:
                    standard_files.append(p)

    video_basic: Optional[Path] = None
    for preferred in (
        "video_features_basic_27k.csv",
        "video_features_basic_1k.csv",
        "video_features_basic_pure.csv",
    ):
        matched = next((p for p in all_csv if p.name == preferred), None)
        if matched is not None:
            video_basic = matched
            break

    return standard_files, random_files, video_basic


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        if val is None or val == "" or (isinstance(val, float) and pd.isna(val)):
            return default
        return int(float(val))
    except Exception:
        return default


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if val is None or val == "" or (isinstance(val, float) and pd.isna(val)):
            return default
        f = float(val)
        return f if pd.notna(f) else default
    except Exception:
        return default


def _user_bucket(user_id_raw: str, mod: int) -> int:
    """对 user_id 做稳定分桶，优先使用数字取模以保持连续性与均匀性。"""
    text = str(user_id_raw).strip()
    if text.isdigit():
        return int(text) % max(1, mod)
    return (zlib.crc32(text.encode("utf-8")) & 0x7FFFFFFF) % max(1, mod)


def _format_utc_iso_ms(time_ms: int) -> str:
    sec = float(time_ms) / 1000.0
    return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()


def map_kuairand_row_to_labels(
    row: Dict[str, Any],
) -> Tuple[Dict[str, float], float, int, Optional[int]]:
    """
    将单条 KuaiRand 多信号交互映射为 Phoenix V2 PREDICTED_ACTIONS 多任务标签：
      - 返回 (labels_dict, play_time_ms, dominant_history_action_id_or_0, has_meaningful_history_signal)
    """
    is_click = _safe_int(row.get("is_click"), 0) > 0
    is_like = _safe_int(row.get("is_like"), 0) > 0
    is_follow = _safe_int(row.get("is_follow"), 0) > 0
    is_comment = _safe_int(row.get("is_comment"), 0) > 0
    is_forward = _safe_int(row.get("is_forward"), 0) > 0
    is_hate = _safe_int(row.get("is_hate"), 0) > 0
    long_view = _safe_int(row.get("long_view"), 0) > 0
    is_profile = _safe_int(row.get("is_profile_enter"), 0) > 0

    play_ms = max(0.0, _safe_float(row.get("play_time_ms"), 0.0))
    dur_ms = max(0.0, _safe_float(row.get("duration_ms"), 0.0))
    watch_ratio = (play_ms / dur_ms) if dur_ms > 0.0 else 0.0

    # 与真实短播完/深度消费契约一致：区分被动划过（<3s 且未点击）与真实停留消费
    dwell_pos = long_view or play_ms >= _DWELL_POSITIVE_MS or (dur_ms > 0.0 and watch_ratio >= 0.5)
    video_view_pos = is_click or long_view or play_ms >= _VIDEO_VIEW_MIN_MS

    labels: Dict[str, float] = {name: 0.0 for name in PREDICTED_ACTIONS}
    labels["click"] = 1.0 if is_click else 0.0
    labels["like"] = 1.0 if is_like else 0.0
    labels["reply"] = 1.0 if is_comment else 0.0
    labels["repost"] = 1.0 if is_forward else 0.0
    labels["share"] = 1.0 if is_forward else 0.0
    labels["dwell"] = 1.0 if dwell_pos else 0.0
    labels["video_view"] = 1.0 if video_view_pos else 0.0
    labels["follow_author"] = 1.0 if is_follow else 0.0
    labels["not_interested"] = 1.0 if is_hate else 0.0

    flags = {
        "is_hate": is_hate,
        "is_follow": is_follow,
        "is_forward": is_forward,
        "is_comment": is_comment,
        "is_like": is_like,
        "is_profile_enter": is_profile,
        "long_view": long_view,
        "is_click": is_click,
    }
    dominant_action_id: Optional[int] = None
    for raw_flag, canonical_name in _HISTORY_ACTION_PRIORITY:
        if flags.get(raw_flag):
            dominant_action_id = ACTION_TYPE_MAP[canonical_name]
            break
    # 若存在较长有效停留但未触发显式点击按钮，亦记为 dwell 历史信号
    if dominant_action_id is None and dwell_pos:
        dominant_action_id = ACTION_TYPE_MAP["dwell"]

    return labels, play_ms, (dominant_action_id or 0), dominant_action_id


def load_needed_video_metadata(
    video_basic_path: Optional[Path],
    needed_video_ids: Optional[Set[str]] = None,
    chunk_size: int = 500_000,
) -> Dict[str, Tuple[str, bool]]:
    """
    分块扫描 video_features_basic_*.csv，仅缓存日志真实出现过的 video_id -> (author_id, is_ad)。
    当视频总库高达数千万行时，可将常驻内存压低一个数量级以上。
    """
    if video_basic_path is None or not video_basic_path.exists():
        return {}

    meta: Dict[str, Tuple[str, bool]] = {}
    reader_header = pd.read_csv(video_basic_path, nrows=0)
    avail_cols = [c for c in ("video_id", "author_id", "video_type") if c in reader_header.columns]
    if "video_id" not in avail_cols:
        return {}

    for chunk in pd.read_csv(
        video_basic_path,
        usecols=avail_cols,
        chunksize=chunk_size,
        low_memory=False,
    ):
        vid_series = chunk["video_id"].astype(str)
        if needed_video_ids is not None:
            mask = vid_series.isin(needed_video_ids)
            if not mask.any():
                continue
            chunk = chunk.loc[mask]

        for row in chunk.itertuples(index=False):
            vid = str(getattr(row, "video_id")).strip()
            if not vid or vid == "nan":
                continue
            raw_aid = getattr(row, "author_id", "")
            aid_str = "" if raw_aid is None or str(raw_aid) == "nan" else str(raw_aid).split(".", 1)[0].strip()
            vtype = str(getattr(row, "video_type", "") or "").strip().upper()
            meta[vid] = (aid_str, vtype == "AD")

    return meta


def _emit_user_slates(
    raw_user_id: str,
    events: List[Tuple[int, str, Dict[str, Any]]],
    *,
    video_meta: Dict[str, Tuple[str, bool]],
    max_history: int,
    min_history: int,
    max_candidates: int,
    exclude_ads: bool,
    stats: KuaiRandConvertStats,
    train_out: List[Dict[str, Any]],
    val_rand_out: List[Dict[str, Any]],
    max_train_slates: int,
    max_val_rand_slates: int,
) -> None:
    """
    按严格时间因果顺序为单用户构造 PIT 多候选 Slate：
      - 同一个 time_ms 的所有候选共享完全一致的 history（严格来自 hist_ts < time_ms）
      - 候选之间绝不相互进入历史，且与 is_rand 拆分后再切 chunk 评估
    """
    if not events:
        return

    events.sort(key=lambda item: (item[0], item[1]))
    uid_ns = f"kuairand_u_{raw_user_id}"
    prior_history: Deque[Tuple[str, str, int, int]] = deque(maxlen=max(1, max_history))
    user_emitted = False

    idx = 0
    total = len(events)
    while idx < total:
        slate_ts = events[idx][0]
        end = idx
        while end < total and events[end][0] == slate_ts:
            end += 1

        batch_rows = events[idx:end]
        idx = end

        # 第一步：仅使用严格早于 slate_ts 的历史构造成对历史四元组
        history_tuples: List[Tuple[str, str, int, int]] = []
        if len(prior_history) >= min_history:
            history_tuples = [
                (
                    h_pid,
                    h_aid,
                    h_act,
                    compute_time_bucket((slate_ts - h_ts) / 1000.0),
                )
                for (h_pid, h_aid, h_act, h_ts) in prior_history
            ]

        std_cands: List[Dict[str, Any]] = []
        rand_cands: List[Dict[str, Any]] = []
        next_history_items: List[Tuple[str, str, int, int]] = []

        for _, vid_raw, row in batch_rows:
            meta_entry = video_meta.get(vid_raw)
            if meta_entry is not None:
                stats.video_metadata_matched += 1
                raw_aid, is_ad = meta_entry
            else:
                raw_aid = str(row.get("author_id") or "").strip()
                is_ad = False

            if exclude_ads and is_ad:
                stats.skipped_ads += 1
                continue

            post_ns = f"kuairand_v_{vid_raw}"
            author_ns = f"kuairand_a_{raw_aid}" if raw_aid else ""

            labels, play_ms, _, hist_act_id = map_kuairand_row_to_labels(row)
            if hist_act_id is not None:
                next_history_items.append((post_ns, author_ns, int(hist_act_id), slate_ts))

            if len(prior_history) < min_history:
                stats.skipped_cold_history += 1
                continue

            is_rand_flag = _safe_int(row.get("is_rand"), 0) > 0
            tab_val = _safe_int(row.get("tab"), -1)
            in_network = tab_val == 0

            cand_entry = {
                "candidate_post_id": post_ns,
                "candidate_author_id": author_ns,
                "labels": labels,
                "dwell_ms": int(play_ms),
                "in_network": in_network,
                "has_video": True,
                "is_positive": bool(
                    any(labels[a] > 0.0 for a in ("click", "like", "reply", "repost", "follow_author", "dwell"))
                    and labels["not_interested"] == 0.0
                ),
            }
            if is_rand_flag:
                rand_cands.append(cand_entry)
            else:
                std_cands.append(cand_entry)

        action_iso = _format_utc_iso_ms(slate_ts)
        if std_cands:
            for c_start in range(0, len(std_cands), max_candidates):
                if max_train_slates > 0 and stats.train_slates >= max_train_slates:
                    break
                chunk = std_cands[c_start : c_start + max_candidates]
                train_out.append(
                    {
                        "user_id": uid_ns,
                        "history": list(history_tuples),
                        "candidates": chunk,
                        "action_time": action_iso,
                        "source": "kuairand_standard",
                        "is_rand": False,
                    }
                )
                stats.train_slates += 1
                stats.train_candidates += len(chunk)
                user_emitted = True

        if rand_cands:
            for c_start in range(0, len(rand_cands), max_candidates):
                if max_val_rand_slates > 0 and stats.val_rand_slates >= max_val_rand_slates:
                    break
                chunk = rand_cands[c_start : c_start + max_candidates]
                val_rand_out.append(
                    {
                        "user_id": uid_ns,
                        "history": list(history_tuples),
                        "candidates": chunk,
                        "action_time": action_iso,
                        "source": "kuairand_random",
                        "is_rand": True,
                    }
                )
                stats.val_rand_slates += 1
                stats.val_rand_candidates += len(chunk)
                user_emitted = True

        # 第二步：当前时间戳的候选全部发出后，才可将有意义行为写入历史供后续时刻读取
        for item in next_history_items:
            prior_history.append(item)

    if user_emitted:
        stats.users_emitted += 1


def _partition_interactions_to_buckets(
    interaction_files: Sequence[Tuple[Path, bool]],
    *,
    buckets_dir: Path,
    num_buckets: int,
    user_sample_mod: int,
    chunk_size: int,
    stats: KuaiRandConvertStats,
) -> Set[str]:
    """
    Pass 1：流式读取所有 KuaiRand 交互日志，按 user_id 哈希写入 N 个紧凑桶文件，
    并收集出现过的 video_id 集合，确保大文件下内存占用有严格上界。
    """
    needed_videos: Set[str] = set()
    bucket_paths = [buckets_dir / f"bucket_{i}.tsv.gz" for i in range(num_buckets)]
    handles = [gzip.open(p, "wt", encoding="utf-8", newline="") for p in bucket_paths]
    writers = [csv.writer(h, delimiter="\t") for h in handles]

    try:
        for file_path, is_random_file in interaction_files:
            stats.source_files.append(str(file_path))
            header_cols = list(pd.read_csv(file_path, nrows=0).columns)
            usecols = [c for c in _INTERACTION_COLUMNS if c in header_cols]
            if "author_id" in header_cols and "author_id" not in usecols:
                usecols.append("author_id")

            for chunk in pd.read_csv(file_path, usecols=usecols, chunksize=chunk_size, low_memory=False):
                stats.raw_rows_read += len(chunk)
                if "is_rand" not in chunk.columns:
                    chunk["is_rand"] = 1 if is_random_file else 0
                for col in _INTERACTION_COLUMNS:
                    if col not in chunk.columns:
                        chunk[col] = -1 if col == "tab" else 0
                if user_sample_mod > 1:
                    uniq_uids = chunk["user_id"].unique()
                    keep_uids = {u for u in uniq_uids if _user_bucket(str(u), user_sample_mod) == 0}
                    chunk = chunk[chunk["user_id"].isin(keep_uids)]
                    if chunk.empty:
                        continue

                stats.selected_rows += len(chunk)
                needed_videos.update(chunk["video_id"].astype(str).tolist())

                # 统一按固定列顺序序列化到临时桶文件，确保缺失列也能安全对齐
                fixed_cols = list(_INTERACTION_COLUMNS) + (["author_id"] if "author_id" in chunk.columns else [])
                uid_bucket_cache: Dict[str, int] = {}
                for row_tuple in chunk[fixed_cols].itertuples(index=False, name=None):
                    uid_str = str(row_tuple[0]).strip()
                    b_idx = uid_bucket_cache.get(uid_str)
                    if b_idx is None:
                        b_idx = _user_bucket(uid_str, num_buckets)
                        uid_bucket_cache[uid_str] = b_idx
                    writers[b_idx].writerow(row_tuple)

                if stats.raw_rows_read % (chunk_size * 10) < chunk_size:
                    print(
                        f"[kuairand-pass1] file={file_path.name} raw_rows={stats.raw_rows_read} selected_rows={stats.selected_rows}",
                        flush=True,
                    )
    finally:
        for h in handles:
            h.close()

    return needed_videos


def _write_slates_sharded(
    slates: Sequence[Dict[str, Any]],
    *,
    shard_dir: Path,
    bucket_idx: int,
    shard_slates: int,
) -> List[str]:
    """按分片上限流式写出 gzip 压缩的分片文件并返回路径列表。"""
    if not slates:
        return []
    shard_dir.mkdir(parents=True, exist_ok=True)
    written: List[str] = []
    step = max(1, int(shard_slates))
    for sub_idx, start in enumerate(range(0, len(slates), step)):
        chunk = list(slates[start : start + step])
        out_path = shard_dir / f"part_{bucket_idx:04d}_{sub_idx:03d}.pkl.gz"
        with gzip.open(out_path, "wb") as f:
            pickle.dump(chunk, f, protocol=pickle.HIGHEST_PROTOCOL)
        written.append(str(out_path))
    return written


def convert_kuairand_to_phoenix_v2(config: KuaiRandConvertConfig) -> Dict[str, Any]:
    """
    将 KuaiRand-27K 原始 CSV 目录转换为 Phoenix V2 预训练集与无偏随机测试集。
    产物：
      - shard_slates == 0: phoenix_v2_kuairand_train.pkl / phoenix_v2_kuairand_val_rand.pkl
      - shard_slates > 0: train/part_*.pkl.gz 与 eval_random/part_*.pkl.gz 流式分片目录
      - kuairand_phoenix_manifest.json（统计摘要）
    """
    std_files, rand_files, video_basic_path = discover_kuairand_files(config.kuairand_dir)
    if not std_files and not rand_files:
        raise FileNotFoundError(f"在 {config.kuairand_dir} 下未找到任何 log_standard_*.csv 或 log_random_*.csv")

    interaction_files: List[Tuple[Path, bool]] = [(p, False) for p in std_files] + [(p, True) for p in rand_files]
    output_dir = Path(config.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stats = KuaiRandConvertStats()

    use_shards = int(config.shard_slates) > 0
    train_shard_dir = output_dir / "train"
    val_shard_dir = output_dir / "eval_random"
    shard_files_train: List[str] = []
    shard_files_val: List[str] = []
    train_slates: List[Dict[str, Any]] = []
    val_rand_slates: List[Dict[str, Any]] = []
    num_buckets = max(1, int(config.num_buckets))

    with tempfile.TemporaryDirectory(prefix="kuairand_buckets_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        needed_videos = _partition_interactions_to_buckets(
            interaction_files,
            buckets_dir=tmp_path,
            num_buckets=num_buckets,
            user_sample_mod=max(1, int(config.user_sample_mod)),
            chunk_size=max(10_000, int(config.chunk_size)),
            stats=stats,
        )

        video_meta = load_needed_video_metadata(
            video_basic_path,
            needed_video_ids=needed_videos,
            chunk_size=max(50_000, int(config.chunk_size)),
        )
        stats.video_metadata_matched = len(video_meta)
        del needed_videos

        # Pass 2：逐桶加载单个用户分片，构建严格 PIT 历史与多候选 Slate
        for b_idx in range(num_buckets):
            train_done = config.max_train_slates > 0 and stats.train_slates >= config.max_train_slates
            rand_done = (not rand_files) or (
                config.max_val_rand_slates > 0 and stats.val_rand_slates >= config.max_val_rand_slates
            )
            if train_done and rand_done:
                break

            b_path = tmp_path / f"bucket_{b_idx}.tsv.gz"
            if not b_path.exists() or b_path.stat().st_size == 0:
                continue

            by_user: Dict[str, List[Tuple[int, str, Dict[str, Any]]]] = defaultdict(list)
            with gzip.open(b_path, "rt", encoding="utf-8", newline="") as f:
                reader = csv.reader(f, delimiter="\t")
                for row_vals in reader:
                    if len(row_vals) < len(_INTERACTION_COLUMNS):
                        continue
                    row_dict = dict(zip(_INTERACTION_COLUMNS, row_vals[: len(_INTERACTION_COLUMNS)]))
                    if len(row_vals) > len(_INTERACTION_COLUMNS):
                        row_dict["author_id"] = row_vals[len(_INTERACTION_COLUMNS)]
                    uid_raw = str(row_dict["user_id"]).strip()
                    vid_raw = str(row_dict["video_id"]).strip()
                    ts_ms = _safe_int(row_dict.get("time_ms"), 0)
                    if not uid_raw or not vid_raw or ts_ms <= 0:
                        continue
                    by_user[uid_raw].append((ts_ms, vid_raw, row_dict))

            bucket_train: List[Dict[str, Any]] = [] if use_shards else train_slates
            bucket_val: List[Dict[str, Any]] = [] if use_shards else val_rand_slates
            for uid_raw in sorted(by_user.keys()):
                _emit_user_slates(
                    uid_raw,
                    by_user[uid_raw],
                    video_meta=video_meta,
                    max_history=max(1, int(config.max_history)),
                    min_history=max(0, int(config.min_history)),
                    max_candidates=max(1, int(config.max_candidates)),
                    exclude_ads=bool(config.exclude_ads),
                    stats=stats,
                    train_out=bucket_train,
                    val_rand_out=bucket_val,
                    max_train_slates=int(config.max_train_slates),
                    max_val_rand_slates=int(config.max_val_rand_slates),
                )
            del by_user

            if use_shards:
                bucket_train.sort(key=lambda s: s["action_time"])
                bucket_val.sort(key=lambda s: s["action_time"])
                shard_files_train.extend(
                    _write_slates_sharded(
                        bucket_train,
                        shard_dir=train_shard_dir,
                        bucket_idx=b_idx,
                        shard_slates=config.shard_slates,
                    )
                )
                shard_files_val.extend(
                    _write_slates_sharded(
                        bucket_val,
                        shard_dir=val_shard_dir,
                        bucket_idx=b_idx,
                        shard_slates=config.shard_slates,
                    )
                )
                del bucket_train
                del bucket_val

            print(
                f"[kuairand-pass2] bucket={b_idx + 1}/{num_buckets} train_slates={stats.train_slates} eval_slates={stats.val_rand_slates}",
                flush=True,
            )

    if use_shards:
        train_out_path = train_shard_dir
        val_out_path = val_shard_dir
    else:
        train_slates.sort(key=lambda s: s["action_time"])
        val_rand_slates.sort(key=lambda s: s["action_time"])
        train_out_path = output_dir / config.train_filename
        val_out_path = output_dir / config.val_rand_filename
        with open(train_out_path, "wb") as f:
            pickle.dump(train_slates, f, protocol=pickle.HIGHEST_PROTOCOL)
        with open(val_out_path, "wb") as f:
            pickle.dump(val_rand_slates, f, protocol=pickle.HIGHEST_PROTOCOL)

    manifest = {
        "schema": "phoenix_v2_kuairand_pit_v1",
        "sharded": use_shards,
        "kuairandDir": str(config.kuairand_dir),
        "videoBasicFile": str(video_basic_path) if video_basic_path else None,
        "trainSamplesPath": str(train_out_path),
        "valRandSamplesPath": str(val_out_path),
        "trainShardCount": len(shard_files_train) if use_shards else 1,
        "valRandShardCount": len(shard_files_val) if use_shards else 1,
        "rawRowsRead": stats.raw_rows_read,
        "selectedRows": stats.selected_rows,
        "usersEmitted": stats.users_emitted,
        "trainSlates": stats.train_slates,
        "trainCandidates": stats.train_candidates,
        "valRandSlates": stats.val_rand_slates,
        "valRandCandidates": stats.val_rand_candidates,
        "skippedAds": stats.skipped_ads,
        "skippedColdHistory": stats.skipped_cold_history,
        "videoMetadataMatched": stats.video_metadata_matched,
        "userSampleMod": config.user_sample_mod,
        "maxHistory": config.max_history,
        "minHistory": config.min_history,
        "maxCandidates": config.max_candidates,
        "sourceFiles": stats.source_files,
    }
    (output_dir / "kuairand_phoenix_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest


def parse_args() -> argparse.Namespace:
    default_ml_dir = Path(__file__).resolve().parent.parent.parent
    parser = argparse.ArgumentParser(description="将 KuaiRand-27K CSV 转换为 Phoenix V2 PIT 训练与无偏验证集")
    parser.add_argument("--kuairand-dir", type=Path, required=True, help="KuaiRand 数据根目录（包含 log_*.csv）")
    parser.add_argument("--output-dir", type=Path, default=default_ml_dir / "data", help="输出目录")
    parser.add_argument("--train-filename", default="phoenix_v2_kuairand_train.pkl", help="标准预训练集文件名")
    parser.add_argument("--val-rand-filename", default="phoenix_v2_kuairand_val_rand.pkl", help="无偏随机验证集文件名")
    parser.add_argument("--max-history", type=int, default=64, help="单样本最大历史序列长度")
    parser.add_argument("--min-history", type=int, default=3, help="发射候选样本所需的最小历史动作数")
    parser.add_argument("--max-candidates", type=int, default=32, help="单组 slate 最大候选切分长度")
    parser.add_argument("--max-train-slates", type=int, default=0, help="标准预训练 slate 上限，0 不限制")
    parser.add_argument("--max-val-rand-slates", type=int, default=0, help="无偏随机验证 slate 上限，0 不限制")
    parser.add_argument("--num-buckets", type=int, default=16, help="流式分桶数（越大内存越省）")
    parser.add_argument("--user-sample-mod", type=int, default=1, help="大于 1 时按 1/N 完整抽取用户时间线")
    parser.add_argument("--chunk-size", type=int, default=250_000, help="pandas 读取分块大小")
    parser.add_argument("--shard-slates", type=int, default=0, help="大于 0 时流式写出 gzip 压缩分片目录")
    parser.add_argument("--include-ads", action="store_true", help="是否保留 video_type=AD 的商业广告视频")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = KuaiRandConvertConfig(
        kuairand_dir=args.kuairand_dir,
        output_dir=args.output_dir,
        train_filename=args.train_filename,
        val_rand_filename=args.val_rand_filename,
        max_history=args.max_history,
        min_history=args.min_history,
        max_candidates=args.max_candidates,
        max_train_slates=args.max_train_slates,
        max_val_rand_slates=args.max_val_rand_slates,
        num_buckets=args.num_buckets,
        user_sample_mod=args.user_sample_mod,
        chunk_size=args.chunk_size,
        shard_slates=args.shard_slates,
        exclude_ads=not args.include_ads,
    )
    manifest = convert_kuairand_to_phoenix_v2(cfg)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
