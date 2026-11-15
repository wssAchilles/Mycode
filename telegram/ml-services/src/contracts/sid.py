"""6x256 Semantic ID 跨语言编码契约：Wire int32[-1, 0..255] <-> Model uint16[0, 1..256] <-> Rust u64 48-bit。"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

SID_NUM_LEVELS: int = 6
SID_CODEBOOK_SIZE: int = 256
WIRE_MISSING_SID: Tuple[int, ...] = (-1,) * SID_NUM_LEVELS
MODEL_PAD_SID: Tuple[int, ...] = (0,) * SID_NUM_LEVELS


def validate_wire_sids(sids: Sequence[int]) -> List[int]:
    """校验 Wire 协议层的 6 级 Semantic ID（-1 表示缺失，有效码词严格在 [0, 255]）。"""
    if len(sids) != SID_NUM_LEVELS:
        raise ValueError(f"semantic_ids must have length {SID_NUM_LEVELS}, got {len(sids)}")
    out = [int(v) for v in sids]
    if all(v == -1 for v in out):
        return out
    for level, code in enumerate(out):
        if code < 0 or code >= SID_CODEBOOK_SIZE:
            raise ValueError(
                f"invalid wire SID at level {level}: {code}; expected [0, {SID_CODEBOOK_SIZE - 1}] or all -1"
            )
    return out


def validate_model_sids(sids: Sequence[int]) -> List[int]:
    """校验模型张量层的 1-indexed 6 级 SID（0 保留作 PAD/OOV，有效码词在 [1, 256]）。"""
    if len(sids) != SID_NUM_LEVELS:
        raise ValueError(f"model semantic_ids must have length {SID_NUM_LEVELS}, got {len(sids)}")
    out = [int(v) for v in sids]
    if all(v == 0 for v in out):
        return out
    for level, code in enumerate(out):
        if code < 1 or code > SID_CODEBOOK_SIZE:
            raise ValueError(
                f"invalid model SID at level {level}: {code}; expected [1, {SID_CODEBOOK_SIZE}] or all 0"
            )
    return out


def wire_to_model_sids(sids: Optional[Sequence[int]]) -> List[int]:
    """将 Wire 层 int32[-1, 0..255] 无损映射为模型缓冲区 uint16[0, 1..256]。"""
    if sids is None:
        return list(MODEL_PAD_SID)
    validated = validate_wire_sids(sids)
    if validated[0] == -1:
        return list(MODEL_PAD_SID)
    return [code + 1 for code in validated]


def model_to_wire_sids(sids: Optional[Sequence[int]]) -> List[int]:
    """将模型缓冲区 1-indexed uint16[0, 1..256] 还原为 Wire 层 int32[-1, 0..255]。"""
    if sids is None:
        return list(WIRE_MISSING_SID)
    validated = validate_model_sids(sids)
    if validated[0] == 0:
        return list(WIRE_MISSING_SID)
    return [code - 1 for code in validated]


def pack_sids_u64(sids: Optional[Sequence[int]]) -> Optional[int]:
    """将有效 Wire 6x256 SID 无损压缩进单个 u64 低 48 bit（L0 占高字节，供 Rust 二分前缀查找）。"""
    if sids is None:
        return None
    validated = validate_wire_sids(sids)
    if validated[0] == -1:
        return None
    packed = 0
    for code in validated:
        packed = (packed << 8) | (code & 0xFF)
    return packed


def unpack_sids_u64(packed: Optional[int]) -> List[int]:
    """将 u64 低 48 bit 压缩编码反向解包为 6 级 Wire SID；输入为 None 返回 [-1]*6。"""
    if packed is None:
        return list(WIRE_MISSING_SID)
    val = int(packed)
    if val < 0 or val >= (1 << 48):
        raise ValueError(f"packed SID u64 out of 48-bit range: {packed}")
    out: List[int] = [0] * SID_NUM_LEVELS
    for level in range(SID_NUM_LEVELS - 1, -1, -1):
        out[level] = val & 0xFF
        val >>= 8
    return out
