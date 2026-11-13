"""模型训练子包：Two-Tower、Phoenix V2 多任务排序及轻量校准侧车。"""

from recsys.training.calibration_and_sidecars import (
    REALGRAPH_FEATURES,
    SOCIAL_PHOENIX_TASKS,
    extract_realgraph_records_from_samples,
    extract_social_phoenix_features,
    fit_weighted_calibrator,
    format_js_iso_timestamp,
    train_realgraph_gbt,
    train_social_phoenix_linear,
    validate_social_phoenix_linear_artifact,
)
from recsys.training.phoenix_v2_trainer import (
    PhoenixV2Dataset,
    PhoenixV2TrainConfig,
    collate_phoenix_v2_batch,
    train_phoenix_v2,
)
from recsys.training.two_tower_trainer import (
    TwoTowerDataset,
    TwoTowerTrainConfig,
    train_two_tower,
)

__all__ = [
    "PhoenixV2Dataset",
    "PhoenixV2TrainConfig",
    "REALGRAPH_FEATURES",
    "SOCIAL_PHOENIX_TASKS",
    "TwoTowerDataset",
    "TwoTowerTrainConfig",
    "collate_phoenix_v2_batch",
    "extract_realgraph_records_from_samples",
    "extract_social_phoenix_features",
    "fit_weighted_calibrator",
    "format_js_iso_timestamp",
    "train_phoenix_v2",
    "train_realgraph_gbt",
    "train_social_phoenix_linear",
    "train_two_tower",
    "validate_social_phoenix_linear_artifact",
]