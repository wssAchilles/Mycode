"""内部密钥恒定时间校验器，保护规则篡改写接口与定时调度作业。"""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import List

from fastapi import HTTPException, Request

_LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def constant_time_equals(provided: str, expected: str) -> bool:
    """使用 SHA-256 固定长度摘要执行恒定时间比对，消除时序与长度泄漏。"""
    lhs = hashlib.sha256(provided.encode("utf-8")).digest()
    rhs = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(lhs, rhs)


def _extract_candidate_token(request: Request) -> str:
    """依次从 x-ml-internal-token、x-cron-secret 或 Authorization Bearer 提取凭证。"""
    for header_name in ("x-ml-internal-token", "x-cron-secret"):
        raw = (request.headers.get(header_name) or "").strip()
        if raw:
            return raw

    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return ""


def _configured_internal_tokens() -> List[str]:
    """收集环境变量中配置的非空内部鉴权密钥。"""
    tokens: List[str] = []
    for env_name in ("ML_INTERNAL_TOKEN", "CRON_SECRET"):
        val = (os.getenv(env_name) or "").strip()
        if val and val not in tokens:
            tokens.append(val)
    return tokens


def _is_production_runtime() -> bool:
    """识别 Cloud Run 或显式声明的线上生产运行环境。"""
    if (os.getenv("K_SERVICE") or "").strip():
        return True
    for env_name in ("ENVIRONMENT", "NODE_ENV", "APP_ENV"):
        if (os.getenv(env_name) or "").strip().lower() == "production":
            return True
    return False


def _is_trusted_local_call(request: Request) -> bool:
    """判断未配密钥的非生产环境下是否属于本机/单测调用（外部转发一律拒绝）。"""
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        remote_ip = xff.split(",")[-1].strip()
        return remote_ip in _LOCAL_CLIENTS
    client_host = (request.client.host if request.client else "") or ""
    return client_host in _LOCAL_CLIENTS


def require_ml_mutation_auth(request: Request) -> None:
    """校验高危写接口（/vf/blacklist/*、/vf/rules/*）内部凭证。"""
    expected_tokens = _configured_internal_tokens()
    incoming = _extract_candidate_token(request)

    if expected_tokens:
        if not incoming:
            raise HTTPException(status_code=401, detail="missing_internal_token")
        if not any(constant_time_equals(incoming, exp) for exp in expected_tokens):
            raise HTTPException(status_code=403, detail="invalid_internal_token")
        return

    # 生产或 Cloud Run 环境未配置密钥时严格 Fail-Closed，禁止公网匿名篡改安全规则
    if _is_production_runtime() or not _is_trusted_local_call(request):
        raise HTTPException(status_code=403, detail="internal_token_not_configured")


def require_ml_cron_auth(request: Request) -> None:
    """校验后台批处理与调度接口（/jobs/*）内部密钥。"""
    expected_tokens = _configured_internal_tokens()
    if not expected_tokens:
        raise HTTPException(status_code=403, detail="CRON_SECRET not configured")

    incoming = _extract_candidate_token(request)
    if not incoming:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not any(constant_time_equals(incoming, exp) for exp in expected_tokens):
        raise HTTPException(status_code=403, detail="Forbidden")
