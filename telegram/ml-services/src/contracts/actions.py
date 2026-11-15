"""V3 统一动作契约、跨数据集真采掩码矩阵与 CREAD-30 序数停留时长边界定义。"""

from __future__ import annotations

import math
from typing import Dict, List, Mapping, Sequence, Tuple

# 与后端 UserAction / UserSignal 与跨语言黄金契约严格对齐的完整动作 ID 表
ACTION_TYPE_MAP: Dict[str, int] = {
    "impression": 0,
    "click": 1,
    "like": 2,
    "reply": 3,
    "repost": 4,
    "quote": 5,
    "share": 6,
    "dwell": 7,
    "video_view": 8,
    "video_quality_view": 9,
    "follow_author": 10,
    "profile_click": 11,
    "not_interested": 12,
    "block_author": 13,
    "mute_author": 14,
    "report": 15,
}

# 旧版/异构埋点向标准动作名的归一化映射
ACTION_ALIASES: Dict[str, str] = {
    "favorite": "like",
    "retweet": "repost",
    "tweet_click": "click",
    "open_link": "click",
    "video_complete": "video_quality_view",
    "follow": "follow_author",
    "dismiss": "not_interested",
    "dismiss_post": "not_interested",
    "hide": "not_interested",
    "hide_post": "not_interested",
    "block": "block_author",
    "mute": "mute_author",
}

# 严格对齐 cross_language_golden_test.rs (action_mask.len() == 13) 的 13 路核心二分类预测头
POSITIVE_ACTIONS: List[str] = [
    "click",
    "like",
    "reply",
    "repost",
    "quote",
    "share",
    "dwell",
    "video_view",
    "follow_author",
]

NEGATIVE_ACTIONS: List[str] = [
    "not_interested",
    "block_author",
    "mute_author",
    "report",
]

PREDICTED_ACTIONS: List[str] = POSITIVE_ACTIONS + NEGATIVE_ACTIONS
ACTION_INDEX_BY_NAME: Dict[str, int] = {name: idx for idx, name in enumerate(PREDICTED_ACTIONS)}

# V3 扩展第 14 个独立二分类头（随同 CREAD-30 连续停留共同输出，避免伪造 videoQualityView）
EXTENDED_BINARY_ACTIONS: Tuple[str, ...] = ("video_quality_view",)
V3_PREDICTION_HEADS: Tuple[str, ...] = tuple(PREDICTED_ACTIONS) + EXTENDED_BINARY_ACTIONS
CONTINUOUS_ACTIONS: List[str] = ["dwell_time"]

NUM_ACTION_TYPES: int = len(ACTION_TYPE_MAP)
NUM_PREDICTED_ACTIONS: int = len(PREDICTED_ACTIONS)

ACTION_LOSS_WEIGHTS: Dict[str, float] = {
    "click": 1.0,
    "like": 1.5,
    "reply": 2.5,
    "repost": 2.0,
    "quote": 2.0,
    "share": 1.8,
    "dwell": 1.0,
    "video_view": 1.2,
    "follow_author": 2.0,
    "not_interested": 2.0,
    "block_author": 3.0,
    "mute_author": 2.0,
    "report": 3.0,
    "video_quality_view": 1.5,
}

WEIGHTED_SCORER_PARAMS: Dict[str, float] = {
    "like": 2.0,
    "reply": 5.0,
    "repost": 4.0,
    "quote": 4.5,
    "photo_expand": 1.0,
    "click": 0.5,
    "quoted_click": 0.8,
    "profile_click": 1.0,
    "video_quality_view": 3.0,
    "share": 2.5,
    "share_via_dm": 2.0,
    "share_via_copy_link": 1.5,
    "dwell": 0.3,
    "dwell_time": 0.05,
    "follow_author": 2.4,
    "not_interested": -5.0,
    "block_author": -10.0,
    "mute_author": -4.0,
    "report": -8.0,
}

# 各来源数据集在 13 路动作上的真实采集掩码：未采集的头必须置 0 并在 BCE 中屏蔽梯度
_RAW_DATASET_MASK_SETS: Mapping[str, Tuple[str, ...]] = {
    # 线上 Mongo 全栈埋点覆盖 13 路正负动作
    "prod_pit_v3": tuple(PREDICTED_ACTIONS),
    # KuaiRand 真采集 9 路（缺失 quote, block_author, mute_author, report）
    "kuairand": (
        "click",
        "like",
        "reply",
        "repost",
        "share",
        "dwell",
        "video_view",
        "follow_author",
        "not_interested",
    ),
    # KuaiRec 2.0 覆盖观看时长分位转化的点击/完播类信号与显式极低观看负向信号
    "kuairec": (
        "click",
        "like",
        "dwell",
        "video_view",
        "not_interested",
    ),
    # MIND-Large 为新闻曝光点击日志：仅真实采集 click
    "mind": ("click",),
    # MicroLens-100k 为纯隐式评论交互流：仅开放 click 与 reply 观测，无负曝光负样本
    "microlens": (
        "click",
        "reply",
    ),
}

DATASET_ACTION_MASKS: Dict[str, List[int]] = {
    source: [1 if action in observed else 0 for action in PREDICTED_ACTIONS]
    for source, observed in _RAW_DATASET_MASK_SETS.items()
}

# CREAD-30 分桶数量与对数网格区间（0ms ~ 300_000ms，对齐 x-algorithm 序数离散化范式）
CREAD_NUM_BINS: int = 30
CREAD_MAX_DWELL_MS: float = 300_000.0


def canonicalize_action_name(action: str) -> str:
    """将异构或旧版事件名称映射为 V3 标准动作标识。"""
    normalized = str(action or "").strip().lower()
    return ACTION_ALIASES.get(normalized, normalized)


def get_dataset_action_mask(source_dataset: str) -> List[int]:
    """返回指定数据源在 13 路二分类头上的标准真采掩码拷贝。"""
    key = str(source_dataset or "").strip().lower()
    if key in DATASET_ACTION_MASKS:
        return list(DATASET_ACTION_MASKS[key])
    # 按别名匹配前缀
    for prefix, mask in DATASET_ACTION_MASKS.items():
        if key.startswith(prefix):
            return list(mask)
    raise ValueError(f"unsupported source_dataset for action_mask: {source_dataset!r}")


def build_cread_bin_edges_ms(
    num_bins: int = CREAD_NUM_BINS,
    max_dwell_ms: float = CREAD_MAX_DWELL_MS,
) -> List[float]:
    """构建从 0ms 到 max_dwell_ms 的对数递增 CREAD-30 边界列表（长度 num_bins + 1）。"""
    edges: List[float] = [0.0]
    if num_bins <= 0:
        return edges
    log_max = math.log1p(max_dwell_ms)
    for idx in range(1, num_bins + 1):
        val = math.expm1(log_max * float(idx) / float(num_bins))
        edges.append(round(val, 3))
    edges[-1] = float(max_dwell_ms)
    return edges


def dwell_ms_to_cread_bucket(dwell_ms: float, edges: Sequence[float] | None = None) -> int:
    """将连续毫秒停留映射为 [0, num_bins - 1] 整数序数桶索引。"""
    active_edges = edges if edges is not None else build_cread_bin_edges_ms()
    num_bins = max(1, len(active_edges) - 1)
    clamped = max(0.0, float(dwell_ms))
    for idx in range(num_bins):
        if clamped <= active_edges[idx + 1]:
            return idx
    return num_bins - 1


def cread_probs_to_expected_sec(
    probs: Sequence[float],
    edges_ms: Sequence[float] | None = None,
) -> float:
    """将 CREAD-30 离散分桶概率分布还原为期望停留秒数。"""
    active_edges = edges_ms if edges_ms is not None else build_cread_bin_edges_ms()
    num_bins = len(active_edges) - 1
    if len(probs) != num_bins:
        raise ValueError(f"expected {num_bins} CREAD probabilities, got {len(probs)}")

    total_p = sum(max(0.0, float(p)) for p in probs)
    if total_p <= 0.0:
        return 0.0

    expected_ms = 0.0
    for idx, raw_p in enumerate(probs):
        p = max(0.0, float(raw_p)) / total_p
        mid_ms = 0.5 * (active_edges[idx] + active_edges[idx + 1])
        expected_ms += p * mid_ms
    return expected_ms / 1000.0
