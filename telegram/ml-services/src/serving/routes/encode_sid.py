"""实时文本 Semantic ID (6x256) 与 256d 语义向量编码路由（供 Node 新帖/回刷异步直推）。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.contracts.ann import build_v3_post_embedding_contract
from src.contracts.sid import pack_sids_u64

router = APIRouter(tags=["semantic-id"])


class EncodeSidItem(BaseModel):
    postId: str
    content: str
    title: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)


class EncodeSidRequest(BaseModel):
    items: List[EncodeSidItem]


class EncodeSidResult(BaseModel):
    postId: str
    semanticIds: List[int]
    semanticIdsU64: Optional[int] = None
    embedding256d: List[float]
    embeddingContract: Dict[str, Any]


class EncodeSidResponse(BaseModel):
    results: List[EncodeSidResult]


async def _handle_encode(payload: EncodeSidRequest, request: Request) -> EncodeSidResponse:
    state = request.app.state.serving_state
    if not state.text_encoder.is_ready:
        raise HTTPException(status_code=503, detail="TextEncoder ONNX session not loaded")

    if not payload.items:
        return EncodeSidResponse(results=[])

    texts = [
        " ".join(
            part
            for part in [
                str(item.title or "").strip(),
                str(item.content or "").strip(),
                " ".join(item.keywords or []),
            ]
            if part
        )
        for item in payload.items
    ]
    embs, sids_list = state.text_encoder.encode_texts(texts)
    artifact_ver = (
        state.config.artifact_version
        or (state.serving_manifest or {}).get("version")
        or "post_semantic_v3_artifact_v1"
    )
    contract = build_v3_post_embedding_contract(
        artifact_version=str(artifact_ver),
        producer="ml-services",
    )

    out: List[EncodeSidResult] = []
    for idx, item in enumerate(payload.items):
        wire_sids = sids_list[idx]
        out.append(
            EncodeSidResult(
                postId=item.postId,
                semanticIds=wire_sids,
                semanticIdsU64=pack_sids_u64(wire_sids),
                embedding256d=[round(float(x), 6) for x in embs[idx].tolist()],
                embeddingContract=contract,
            )
        )
    return EncodeSidResponse(results=out)


@router.post("/sid/encode", response_model=EncodeSidResponse)
async def encode_sid(payload: EncodeSidRequest, request: Request) -> EncodeSidResponse:
    return await _handle_encode(payload, request)


@router.post("/v3/sid/encode", response_model=EncodeSidResponse)
async def v3_encode_sid(payload: EncodeSidRequest, request: Request) -> EncodeSidResponse:
    return await _handle_encode(payload, request)
