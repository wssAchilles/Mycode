"""健康检查与就绪探针路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    state = request.app.state.serving_state
    return state.health_snapshot()


@router.get("/ready")
async def ready(request: Request) -> dict:
    state = request.app.state.serving_state
    snap = state.health_snapshot()
    if state.config.verify_artifact_checksums and snap.get("manifest_verified") is False:
        raise HTTPException(status_code=503, detail="manifest_verification_failed")
    if not snap.get("models_loaded"):
        raise HTTPException(status_code=503, detail="onnx_models_not_loaded")
    return {"ready": True, **snap}
