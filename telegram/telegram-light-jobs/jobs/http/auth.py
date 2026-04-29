import os

from fastapi import HTTPException, Request


def require_cron_auth(request: Request) -> None:
    expected = os.getenv("CRON_SECRET", "").strip()
    if not expected:
        raise HTTPException(status_code=500, detail="CRON_SECRET is not configured")

    header = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = header.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="invalid bearer token")
