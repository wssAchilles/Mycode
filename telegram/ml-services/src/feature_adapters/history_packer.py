"""列式历史行为序列化适配器：无 Torch 依赖、纯 NumPy 构造 ONNX 输入张量。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any, Mapping, Optional, Sequence
import zlib

import numpy as np

from src.contracts.actions import ACTION_TYPE_MAP, NUM_PREDICTED_ACTIONS, canonicalize_action_name
from src.contracts.sid import SID_NUM_LEVELS, wire_to_model_sids

_HASH_MODULO = (1 << 30) - 2
_TIME_BUCKET_UPPER_BOUNDS_SEC = (
    60.0,
    300.0,
    900.0,
    1_800.0,
    3_600.0,
    10_800.0,
    21_600.0,
    43_200.0,
    86_400.0,
    172_800.0,
    259_200.0,
    604_800.0,
    1_209_600.0,
    2_592_000.0,
    7_776_000.0,
)


def stable_id_hash_u64(raw_id: Any) -> int:
    """跨进程稳定的轻量整数 ID 哈希（0 为 PAD，1 为 UNK，>=2 为 CRC32 映射）。"""
    if raw_id is None:
        return 0
    if isinstance(raw_id, int) and not isinstance(raw_id, bool):
        return 0 if raw_id <= 0 else int(2 + (zlib.crc32(str(raw_id).encode("utf-8")) % _HASH_MODULO))
    text = str(raw_id).strip()
    if not text or text == "<PAD>":
        return 0
    if text == "<UNK>":
        return 1
    return int(2 + (zlib.crc32(text.encode("utf-8")) % _HASH_MODULO))


def compute_time_bucket(delta_seconds: float, num_buckets: int = 16) -> int:
    """对时间差进行分位对数分桶 [0, num_buckets - 1]（PIT 绝对禁止负数时间差）。"""
    delta = max(0.0, float(delta_seconds))
    for idx, bound in enumerate(_TIME_BUCKET_UPPER_BOUNDS_SEC):
        if delta <= bound:
            return min(idx, max(1, int(num_buckets)) - 1)
    return max(0, int(num_buckets) - 1)


def _parse_ts_sec(raw_ts: Any) -> Optional[float]:
    if isinstance(raw_ts, datetime):
        dt = raw_ts if raw_ts.tzinfo else raw_ts.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    if isinstance(raw_ts, (int, float)) and not isinstance(raw_ts, bool):
        val = float(raw_ts)
        if not math.isfinite(val):
            return None
        return val / 1000.0 if val > 1e12 else val
    if isinstance(raw_ts, str) and raw_ts.strip():
        try:
            dt = datetime.fromisoformat(raw_ts.strip().replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except Exception:
            return None
    return None


@dataclass(frozen=True)
class PackedHistoryBatch:
    """纯 NumPy 定长序列包，可直接喂给 ONNX Runtime 会话。"""

    post_hashes: np.ndarray        # int64 (1, L)
    author_hashes: np.ndarray      # int64 (1, L)
    action_types: np.ndarray       # int64 (1, L)
    time_buckets: np.ndarray       # int64 (1, L)
    time_deltas_sec: np.ndarray    # float32 (1, L)
    history_sids: np.ndarray       # int64 (1, L, 6) -> ONNX/Gather 兼容的 1-indexed [0, 1..256]
    action_masks: np.ndarray       # uint8 (1, L, 13)
    attention_mask: np.ndarray     # int64 (1, L), 1=valid, 0=pad


def pack_columnar_history_sequence(
    columnar_sequence: Optional[Sequence[Mapping[str, Any]]] = None,
    *,
    legacy_actions: Optional[Sequence[Mapping[str, Any]]] = None,
    max_seq_len: int = 128,
    reference_ts_sec: Optional[float] = None,
) -> PackedHistoryBatch:
    """将 V3 列式序列或旧版 userActionSequence 统一打包为带 6x256 SID 与 action_mask[13] 的 NumPy 批次。"""
    cap = max(1, int(max_seq_len))
    now_sec = float(reference_ts_sec) if reference_ts_sec is not None else datetime.now(timezone.utc).timestamp()

    post_hashes = np.zeros((1, cap), dtype=np.int64)
    author_hashes = np.zeros((1, cap), dtype=np.int64)
    action_types = np.zeros((1, cap), dtype=np.int64)
    time_buckets = np.full((1, cap), 15, dtype=np.int64)
    time_deltas_sec = np.zeros((1, cap), dtype=np.float32)
    history_sids = np.zeros((1, cap, SID_NUM_LEVELS), dtype=np.int64)
    action_masks = np.zeros((1, cap, NUM_PREDICTED_ACTIONS), dtype=np.uint8)
    attention_mask = np.zeros((1, cap), dtype=np.int64)

    items: list[Mapping[str, Any]] = []
    if columnar_sequence:
        items = [x for x in columnar_sequence if isinstance(x, Mapping)][-cap:]
    elif legacy_actions:
        items = [x for x in legacy_actions if isinstance(x, Mapping)][-cap:]

    total = len(items)
    for idx, entry in enumerate(items):
        # 支持列式字段 (postIdHash, authorHash, actionType, semanticIds, actionMask, timeDeltaSec) 及旧版兼容键
        if "postIdHash" in entry:
            post_hashes[0, idx] = int(entry.get("postIdHash") or 0)
        else:
            raw_pid = entry.get("targetPostId") or entry.get("modelPostId") or entry.get("postId")
            post_hashes[0, idx] = stable_id_hash_u64(raw_pid)

        if "authorHash" in entry:
            author_hashes[0, idx] = int(entry.get("authorHash") or 0)
        else:
            raw_aid = entry.get("targetAuthorId") or entry.get("authorId")
            author_hashes[0, idx] = stable_id_hash_u64(raw_aid)

        if "actionType" in entry and isinstance(entry.get("actionType"), int):
            action_types[0, idx] = max(0, int(entry["actionType"]))
        else:
            act_name = canonicalize_action_name(str(entry.get("action") or entry.get("actionType") or "click"))
            action_types[0, idx] = int(ACTION_TYPE_MAP.get(act_name, ACTION_TYPE_MAP["click"]))

        if "timeDeltaSec" in entry and entry.get("timeDeltaSec") is not None:
            delta_s = max(0.0, float(entry["timeDeltaSec"]))
        else:
            parsed = _parse_ts_sec(entry.get("timestamp") or entry.get("actionTime"))
            delta_s = max(0.0, now_sec - parsed) if parsed is not None else float(max(0, total - 1 - idx) * 60)

        time_deltas_sec[0, idx] = delta_s
        time_buckets[0, idx] = compute_time_bucket(delta_s)

        raw_sids = entry.get("semanticIds")
        if isinstance(raw_sids, Sequence) and not isinstance(raw_sids, (str, bytes)) and len(raw_sids) == SID_NUM_LEVELS:
            history_sids[0, idx] = np.asarray(wire_to_model_sids(raw_sids), dtype=np.int64)

        raw_mask = entry.get("actionMask")
        if isinstance(raw_mask, Sequence) and not isinstance(raw_mask, (str, bytes)):
            copy_len = min(len(raw_mask), NUM_PREDICTED_ACTIONS)
            for m_i in range(copy_len):
                action_masks[0, idx, m_i] = 1 if int(raw_mask[m_i]) > 0 else 0

        attention_mask[0, idx] = 1

    return PackedHistoryBatch(
        post_hashes=post_hashes,
        author_hashes=author_hashes,
        action_types=action_types,
        time_buckets=time_buckets,
        time_deltas_sec=time_deltas_sec,
        history_sids=history_sids,
        action_masks=action_masks,
        attention_mask=attention_mask,
    )
