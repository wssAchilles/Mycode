"""Phoenix V3 Student ONNX 多头排序路由（13 真头 + videoQualityView + CREAD-30 期望时长）。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["ranking"])


class PhoenixCandidateV3(BaseModel):
    postId: str
    authorId: Optional[str] = None
    inNetwork: bool = False
    hasVideo: bool = False
    videoDurationSec: Optional[float] = None
    semanticIds: Optional[List[int]] = None


class PhoenixRequestV3(BaseModel):
    userId: str
    userActionSequence: Optional[List[Dict[str, Any]]] = None
    columnarScoringSequence: Optional[List[Dict[str, Any]]] = None
    candidates: List[PhoenixCandidateV3] = Field(default_factory=list, max_length=500)


class PhoenixPredictionV3(BaseModel):
    postId: str
    click: float
    like: float
    reply: float
    repost: float
    quote: float = 0.0
    quotedClick: float = 0.0
    photoExpand: float = 0.0
    profileClick: float = 0.0
    share: float = 0.0
    shareViaDm: float = 0.0
    shareViaCopyLink: float = 0.0
    dwell: float = 0.0
    videoView: float = 0.0
    followAuthor: float = 0.0
    notInterested: float = 0.0
    blockAuthor: float = 0.0
    muteAuthor: float = 0.0
    report: float = 0.0
    videoQualityView: float = 0.0
    dwellTime: float = 0.0
    expectedDwellSec: float = 0.0
    dwellProbs: Optional[List[float]] = None
    dismiss: float = 0.0
    block: float = 0.0


class PhoenixResponseV3(BaseModel):
    predictions: List[PhoenixPredictionV3]


def _handle_predict(payload: PhoenixRequestV3, request: Request) -> PhoenixResponseV3:
    state = request.app.state.serving_state
    if not state.phoenix.is_ready:
        raise HTTPException(status_code=503, detail="Phoenix V3 ONNX session not loaded")

    cand_dicts = [c.model_dump() for c in payload.candidates]
    preds = state.phoenix.predict(
        candidates=cand_dicts,
        columnar_sequence=payload.columnarScoringSequence,
        legacy_actions=payload.userActionSequence,
    )
    return PhoenixResponseV3(predictions=[PhoenixPredictionV3(**p) for p in preds])


@router.post("/phoenix/predict", response_model=PhoenixResponseV3)
def phoenix_predict(payload: PhoenixRequestV3, request: Request) -> PhoenixResponseV3:
    return _handle_predict(payload, request)


@router.post("/v3/phoenix/predict", response_model=PhoenixResponseV3)
def v3_phoenix_predict(payload: PhoenixRequestV3, request: Request) -> PhoenixResponseV3:
    return _handle_predict(payload, request)
