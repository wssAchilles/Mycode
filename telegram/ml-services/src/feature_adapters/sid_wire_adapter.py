"""批量 SID 跨格式转换适配器：确保 ONNX 输入张量严格使用 uint16 1-indexed [0, 1..256]。"""

from __future__ import annotations

from typing import List, Optional, Sequence

import numpy as np

from src.contracts.sid import (
    SID_NUM_LEVELS,
    model_to_wire_sids,
    pack_sids_u64,
    wire_to_model_sids,
)


def batch_wire_to_model_sids(batch_wire_sids: Sequence[Optional[Sequence[int]]]) -> np.ndarray:
    """将一批 Wire int32[-1, 0..255] SID 转为 shape=(N, 6) 的 uint16[0, 1..256] 张量。"""
    n = len(batch_wire_sids)
    out = np.zeros((n, SID_NUM_LEVELS), dtype=np.uint16)
    for row_idx, sids in enumerate(batch_wire_sids):
        out[row_idx] = np.asarray(wire_to_model_sids(sids), dtype=np.uint16)
    return out


def batch_model_to_wire_sids(batch_model_sids: np.ndarray) -> List[List[int]]:
    """将模型输出/中间层 uint16[0, 1..256] 张量转回 Wire int32[-1, 0..255] 列表。"""
    arr = np.asarray(batch_model_sids)
    if arr.ndim != 2 or arr.shape[1] != SID_NUM_LEVELS:
        raise ValueError(f"expected shape (N, {SID_NUM_LEVELS}), got {arr.shape}")
    return [model_to_wire_sids(row.tolist()) for row in arr]


def batch_pack_wire_sids_u64(batch_wire_sids: Sequence[Optional[Sequence[int]]]) -> List[Optional[int]]:
    """批量将 Wire 6x256 SID 压缩为供 Rust SidPrefixIndex 检索的低 48 bit u64 整型。"""
    return [pack_sids_u64(sids) for sids in batch_wire_sids]
