#!/usr/bin/env python3
"""Two-Tower 训练脚本兼容入口，核心实现位于 recsys.training.two_tower_trainer。"""

from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from recsys.training.two_tower_trainer import (  # noqa: E402,F401
    TwoTowerDataset,
    TwoTowerTrainConfig,
    main,
    parse_args,
    train_two_tower,
)

if __name__ == "__main__":
    main()
