"""V3 纯在线 ONNX Runtime INT8 推荐推理服务 (<150 行轻量 FastAPI 入口，零 PyTorch/爬虫依赖)。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent_plane.http import router as agent_plane_router
from src.serving.config import ServingConfig
from src.serving.routes import (
    encode_sid_router,
    health_router,
    rank_router,
    retrieve_router,
    vf_router,
)
from src.serving.state import ServingState


def create_serving_app(config: Optional[ServingConfig] = None) -> FastAPI:
    """构建纯在线推荐推理 FastAPI 实例，可通过 ServingConfig 注入隔离测试目录。"""
    cfg = config or ServingConfig()
    state = ServingState(config=cfg)

    @asynccontextmanager
    async def lifespan(fastapi_app: FastAPI):
        if cfg.preload_on_startup:
            try:
                fastapi_app.state.serving_state.load_v3_artifacts()
            except FileNotFoundError:
                # 允许空目录冷启动以等待挂载卷/健康检查报告未就绪状态
                pass
        yield

    fastapi_app = FastAPI(
        title="Phoenix V3 Recommendation Serving (ONNX Runtime INT8)",
        version="3.0.0",
        lifespan=lifespan,
    )
    fastapi_app.state.serving_state = state

    allow_origins = list(cfg.cors_allow_origins or ("*",))
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=(cfg.cors_allow_credentials and "*" not in allow_origins),
        allow_methods=list(cfg.cors_allow_methods or ("GET", "POST", "OPTIONS")),
        allow_headers=list(cfg.cors_allow_headers or ("*",)),
    )

    fastapi_app.include_router(health_router)
    fastapi_app.include_router(retrieve_router)
    fastapi_app.include_router(rank_router)
    fastapi_app.include_router(encode_sid_router)
    fastapi_app.include_router(vf_router)
    fastapi_app.include_router(agent_plane_router, prefix="/agent")
    return fastapi_app


app = create_serving_app()
