"""V3 Serving 路由层。"""

from src.serving.routes.encode_sid import router as encode_sid_router
from src.serving.routes.health import router as health_router
from src.serving.routes.rank import router as rank_router
from src.serving.routes.retrieve import router as retrieve_router
from src.serving.routes.vf import router as vf_router

__all__ = [
    "encode_sid_router",
    "health_router",
    "rank_router",
    "retrieve_router",
    "vf_router",
]
