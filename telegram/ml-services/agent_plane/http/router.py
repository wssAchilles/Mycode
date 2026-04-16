from __future__ import annotations

from fastapi import APIRouter, HTTPException

from agent_plane.contracts.models import AgentRespondRequest, AgentRespondResponse
from agent_plane.orchestrator import AgentOrchestrator

router = APIRouter(tags=["agent-plane"])
orchestrator = AgentOrchestrator()


@router.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "agent-plane",
    }


@router.post("/respond", response_model=AgentRespondResponse)
async def respond(payload: AgentRespondRequest) -> AgentRespondResponse:
    try:
        return orchestrator.respond(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"agent_plane_failed: {exc}") from exc
