"""模型训练子包：Two-Tower 对比学习训练器。"""

from recsys.training.two_tower_trainer import (
    TwoTowerDataset,
    TwoTowerTrainConfig,
    train_two_tower,
)

__all__ = [
    "TwoTowerDataset",
    "TwoTowerTrainConfig",
    "train_two_tower",
]
