"""推荐模型定义包：Two-Tower 召回塔与 Phoenix 多任务排序塔。"""

from recsys.models.phoenix_v2 import (
    PhoenixV2Ranker,
    create_medium_phoenix,
    create_mini_phoenix,
    create_phoenix_for_scale,
    stable_id_hash,
)
from recsys.models.two_tower import (
    NewsEncoder,
    TwoTowerModel,
    UserEncoder,
    compute_infonce_loss,
)

__all__ = [
    "NewsEncoder",
    "PhoenixV2Ranker",
    "TwoTowerModel",
    "UserEncoder",
    "compute_infonce_loss",
    "create_medium_phoenix",
    "create_mini_phoenix",
    "create_phoenix_for_scale",
    "stable_id_hash",
]
