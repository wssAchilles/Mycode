from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from agent_plane.contracts.models import AgentRespondRequest, AgentRespondResponse
from agent_plane.orchestrator import AgentOrchestrator

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent-plane"])
orchestrator = AgentOrchestrator()


@router.get("/health")
def health() -> dict[str, object]:
    """AI 编排平面轻量存活探针。"""
    return {
        "status": "ok",
        "service": "agent-plane",
    }


@router.post("/respond", response_model=AgentRespondResponse)
def respond(payload: AgentRespondRequest) -> AgentRespondResponse:
    """使用同步路由由 FastAPI 线程池并发执行上游模型调用，异常仅回传安全错误码。"""
    try:
        return orchestrator.respond(payload)
    except Exception as exc:
        logger.warning("agent_plane execution failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=500, detail="agent_plane_failed") from None
