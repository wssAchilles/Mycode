"""V3 纯 ONNX Runtime FastAPI 在线服务包。"""

from src.serving.batching import DeadlineBudget, MicroBatcher
from src.serving.config import ServingConfig
from src.serving.main import app, create_serving_app
from src.serving.postprocess import dedup_scored_by_related_ids, related_post_ids_from_doc
from src.serving.state import ServingState

__all__ = [
    "DeadlineBudget",
    "MicroBatcher",
    "ServingConfig",
    "ServingState",
    "app",
    "create_serving_app",
    "dedup_scored_by_related_ids",
    "related_post_ids_from_doc",
]
