import hashlib
import hmac
import os

from fastapi import HTTPException, Request


def _constant_time_equals(provided: str, expected: str) -> bool:
    """使用 SHA-256 定长摘要执行恒定时间比对。"""
    lhs = hashlib.sha256(provided.encode("utf-8")).digest()
    rhs = hashlib.sha256(expected.encode("utf-8")).digest()
    return hmac.compare_digest(lhs, rhs)


def require_cron_auth(request: Request) -> None:
    """校验定时作业内部密钥，兼容 Authorization Bearer 与 x-cron-secret 请求头。"""
    expected = os.getenv("CRON_SECRET", "").strip()
    if not expected:
        raise HTTPException(status_code=500, detail="CRON_SECRET is not configured")

    alt_secret = (request.headers.get("x-cron-secret") or "").strip()
    if alt_secret:
        if not _constant_time_equals(alt_secret, expected):
            raise HTTPException(status_code=403, detail="invalid cron secret")
        return

    header = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = header.removeprefix("Bearer ").strip()
    if not _constant_time_equals(token, expected):
        raise HTTPException(status_code=403, detail="invalid bearer token")
