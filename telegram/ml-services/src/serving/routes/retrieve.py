"""V3 Two-Tower ONNX + FAISS ANN 召回路由（同时兼容 /ann/retrieve 与 /v3/ann/retrieve）。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["retrieval"])


class ANNRequestV3(BaseModel):
    userId: str
    historyPostIds: List[str] = Field(default_factory=list)
    columnarRetrievalSequence: Optional[List[Dict[str, Any]]] = None
    topK: int = 50
    expectedEvidence: Optional[Dict[str, Any]] = None


class ANNCandidateV3(BaseModel):
    postId: str
    score: float


class ANNResponseEvidenceModel(BaseModel):
    embeddingSpace: str
    retrievalEmbeddingDim: int
    modelVersion: str
    artifactVersion: str
    idNamespace: str
    indexVersion: str


class ANNResponseV3(BaseModel):
    candidates: List[ANNCandidateV3]
    evidence: ANNResponseEvidenceModel


async def _handle_retrieve(payload: ANNRequestV3, request: Request) -> ANNResponseV3:
    state = request.app.state.serving_state
    if not state.two_tower.is_ready:
        raise HTTPException(status_code=503, detail="Two-Tower ONNX session not loaded")
    if state.faiss_index is None:
        raise HTTPException(status_code=503, detail="FAISS index not loaded")

    legacy_actions = [{"targetPostId": pid, "action": "click"} for pid in payload.historyPostIds]
    candidates = state.two_tower.retrieve(
        faiss_index=state.faiss_index,
        idx_to_post_id=state.idx_to_post_id,
        columnar_sequence=payload.columnarRetrievalSequence,
        legacy_actions=legacy_actions if not payload.columnarRetrievalSequence else None,
        top_k=payload.topK,
    )
    evidence = ANNResponseEvidenceModel(**state.current_ann_evidence())
    return ANNResponseV3(
        candidates=[ANNCandidateV3(**c) for c in candidates],
        evidence=evidence,
    )


@router.post("/ann/retrieve", response_model=ANNResponseV3)
async def ann_retrieve(payload: ANNRequestV3, request: Request) -> ANNResponseV3:
    return await _handle_retrieve(payload, request)


@router.post("/v3/ann/retrieve", response_model=ANNResponseV3)
async def v3_ann_retrieve(payload: ANNRequestV3, request: Request) -> ANNResponseV3:
    return await _handle_retrieve(payload, request)
