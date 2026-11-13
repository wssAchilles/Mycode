"""统一推荐行为词表、别名归一化与 WeightedScorer 多任务权重契约。"""

from __future__ import annotations

from typing import Dict, List

# 与 UserAction.ts、UserSignal.ts 和 x-algorithm 对齐的完整交互类型 ID
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

# 旧版/异构事件名向标准动作名的归一化映射
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

# Phoenix V2 统一二分类预测头（严格对齐 WeightedScorer 核心信号）
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
CONTINUOUS_ACTIONS: List[str] = ["dwell_time"]

NUM_ACTION_TYPES: int = len(ACTION_TYPE_MAP)
NUM_PREDICTED_ACTIONS: int = len(PREDICTED_ACTIONS)

# 多任务 BCE 损失权重：正反馈与强负反馈加权均衡
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
}

# 与 backend WeightedScorer.ts 精确一致的在线打分权重表
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


def canonicalize_action_name(action: str) -> str:
    """将数据库/埋点里的动作名转换为标准动作名。"""
    normalized = str(action or "").strip().lower()
    return ACTION_ALIASES.get(normalized, normalized)
