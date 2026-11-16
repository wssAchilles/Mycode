"""训练运行时基础设施：双缓冲异步 H2D 预取、Warmup-Cosine 学习率调度与最佳权重回滚。"""

from src.training.runtime.lr_schedule import BestStateTracker, WarmupCosineLR
from src.training.runtime.prefetch import AsyncMicroBatchPrefetcher, slice_mapping_to_device

__all__ = [
    "AsyncMicroBatchPrefetcher",
    "BestStateTracker",
    "WarmupCosineLR",
    "slice_mapping_to_device",
]
