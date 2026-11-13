"""Two-Tower 模型兼容导出模块（转发至 recsys.models.two_tower）。"""

from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from recsys.models.two_tower import (  # noqa: E402,F401
    NewsEncoder,
    TwoTowerModel,
    UserEncoder,
    compute_infonce_loss,
)

__all__ = [
    "NewsEncoder",
    "TwoTowerModel",
    "UserEncoder",
    "compute_infonce_loss",
]
