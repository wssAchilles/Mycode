"""Visibility Filtering (VF) 轻量规则安全审查与受保护黑名单管理路由。"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.safety import DeterministicSafetyService, ViolationType
from src.serving.security import require_ml_mutation_auth

router = APIRouter(tags=["visibility-filtering"])

_FALLBACK_SAFETY_SERVICE = DeterministicSafetyService()


def _resolve_safety_service(request: Request) -> DeterministicSafetyService:
    """优先从 FastAPI ServingState 获取隔离实例，缺省回退进程级单例。"""
    state = getattr(request.app.state, "serving_state", None)
    svc = getattr(state, "safety_service", None)
    return svc if isinstance(svc, DeterministicSafetyService) else _FALLBACK_SAFETY_SERVICE


class VFItem(BaseModel):
    postId: str
    userId: str
    content: Optional[str] = None


class VFRequest(BaseModel):
    items: List[VFItem] = Field(default_factory=list, max_length=500)


class VFResult(BaseModel):
    postId: str
    safe: bool
    reason: Optional[str] = None


class VFResponse(BaseModel):
    results: List[VFResult]


class VFItemExtended(BaseModel):
    postId: str
    userId: str
    content: Optional[str] = None


class VFRequestExtended(BaseModel):
    items: List[VFItemExtended] = Field(default_factory=list, max_length=500)
    skipML: bool = False


class VFResultExtended(BaseModel):
    postId: str
    safe: bool
    reason: Optional[str] = None
    level: str = "safe"
    score: float = 0.0
    violations: List[str] = Field(default_factory=list)
    requiresReview: bool = False


class VFResponseExtended(BaseModel):
    results: List[VFResultExtended]


class VFBlacklistPayload(BaseModel):
    user_id: Optional[str] = None
    userId: Optional[str] = None


class VFRulePayload(BaseModel):
    keyword: Optional[str] = None
    violation_type: Optional[str] = None
    violationType: Optional[str] = None
    high_risk: Optional[bool] = None
    highRisk: Optional[bool] = None


@router.post("/vf/check", response_model=VFResponse)
def vf_check(payload: VFRequest, request: Request) -> VFResponse:
    """执行轻量级内容安全过滤（兼容 V1 响应契约）。"""
    safety_service = _resolve_safety_service(request)
    results: List[VFResult] = []
    for item in payload.items:
        content = item.content or item.postId
        res = safety_service.check(content=content, user_id=item.userId)
        results.append(
            VFResult(
                postId=item.postId,
                safe=res.safe,
                reason=res.reason,
            )
        )
    return VFResponse(results=results)


@router.post("/vf/check/v2", response_model=VFResponseExtended)
def vf_check_v2(payload: VFRequestExtended, request: Request) -> VFResponseExtended:
    """执行增强版内容安全过滤（返回风险等级、分数与命中违规类别）。"""
    safety_service = _resolve_safety_service(request)
    results: List[VFResultExtended] = []
    for item in payload.items:
        content = item.content or item.postId
        res = safety_service.check(
            content=content,
            user_id=item.userId,
            skip_ml=payload.skipML,
        )
        results.append(
            VFResultExtended(
                postId=item.postId,
                safe=res.safe,
                reason=res.reason,
                level=res.level.value,
                score=res.score,
                violations=[v.value for v in res.violations],
                requiresReview=res.requires_review,
            )
        )
    return VFResponseExtended(results=results)


@router.post("/vf/blacklist/add")
def vf_add_blacklist(
    request: Request,
    user_id: Optional[str] = Query(default=None),
    body: Optional[VFBlacklistPayload] = Body(default=None),
) -> dict:
    """受内部密钥保护的黑名单新增端点（兼容 Query 与 JSON Body）。"""
    require_ml_mutation_auth(request)
    resolved_user_id = (user_id or (body.user_id if body else None) or (body.userId if body else None) or "").strip()
    if not resolved_user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    safety_service = _resolve_safety_service(request)
    safety_service.rule_engine.add_user_to_blacklist(resolved_user_id)
    return {"status": "ok", "user_id": resolved_user_id}


@router.post("/vf/blacklist/remove")
def vf_remove_blacklist(
    request: Request,
    user_id: Optional[str] = Query(default=None),
    body: Optional[VFBlacklistPayload] = Body(default=None),
) -> dict:
    """受内部密钥保护的黑名单移除端点（兼容 Query 与 JSON Body）。"""
    require_ml_mutation_auth(request)
    resolved_user_id = (user_id or (body.user_id if body else None) or (body.userId if body else None) or "").strip()
    if not resolved_user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    safety_service = _resolve_safety_service(request)
    safety_service.rule_engine.remove_user_from_blacklist(resolved_user_id)
    return {"status": "ok", "user_id": resolved_user_id}


@router.post("/vf/rules/add")
def vf_add_rule(
    request: Request,
    keyword: Optional[str] = Query(default=None),
    violation_type: Optional[str] = Query(default=None),
    high_risk: bool = Query(default=True),
    body: Optional[VFRulePayload] = Body(default=None),
) -> dict:
    """受内部密钥保护的关键词规则新增端点。"""
    require_ml_mutation_auth(request)
    resolved_keyword = (keyword or (body.keyword if body else None) or "").strip()
    resolved_type = (
        violation_type
        or (body.violation_type if body else None)
        or (body.violationType if body else None)
        or ""
    ).strip()
    resolved_high_risk = (
        body.high_risk
        if (body is not None and body.high_risk is not None)
        else (body.highRisk if (body is not None and body.highRisk is not None) else high_risk)
    )
    if not resolved_keyword or not resolved_type:
        raise HTTPException(status_code=400, detail="keyword and violation_type are required")

    safety_service = _resolve_safety_service(request)
    try:
        vtype = ViolationType(resolved_type)
    except ValueError:
        return {"status": "error", "message": f"Invalid violation type: {resolved_type}"}

    safety_service.rule_engine.add_keyword(resolved_keyword, vtype, bool(resolved_high_risk))
    return {"status": "ok", "keyword": resolved_keyword, "type": resolved_type}
