"""异步 SID 与安全标签 Worker（订阅 recsys:events:v1 或接收回调批处理并调 Cloud Run /sid/encode 写回）。"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence
import time

import httpx

from src.contracts.sid import validate_wire_sids


@dataclass(frozen=True)
class SidSafetyWorkerConfig:
    """异步 SID 与内容安全标注 Worker 运行配置。"""

    serving_base_url: str = os.getenv("ML_SERVING_URL", "http://127.0.0.1:8080")
    redis_stream_key: str = os.getenv("RECSYS_STREAM_KEY", "recsys:events:v1")
    consumer_group: str = os.getenv("SID_WORKER_GROUP", "cg:ml-sid-worker")
    codebook_version: str = os.getenv("SID_CODEBOOK_VERSION", "sid_6x256_v3")
    http_timeout_sec: float = 15.0


def build_post_sid_assigned_event(
    *,
    post_id: str,
    author_id: str,
    created_at_ms: int,
    codes: Sequence[int],
    safety_labels: Optional[Mapping[str, Any]] = None,
    codebook_version: str = "sid_6x256_v3",
) -> Dict[str, Any]:
    """生成对齐 `recsys:events:v1` `post.sid_assigned` 契约的规范消息载荷。"""
    validated_codes = validate_wire_sids(codes)
    return {
        "topic": "post.sid_assigned",
        "postId": str(post_id),
        "authorId": str(author_id),
        "createdAtMs": int(created_at_ms),
        "codes": validated_codes,
        "safetyLabels": dict(safety_labels or {"safe": True, "level": "safe", "labels": []}),
        "codebookVersion": str(codebook_version),
        "assignedAtMs": int(time.time() * 1000),
    }


def encode_posts_via_serving_http(
    posts: Sequence[Mapping[str, Any]],
    *,
    config: Optional[SidSafetyWorkerConfig] = None,
    transport: Optional[httpx.BaseTransport] = None,
) -> List[Dict[str, Any]]:
    """通过 HTTP 批量调用在线服务 `/v3/sid/encode` 为无 SID 新帖分配 6x256 码词并返回事件载荷。"""
    cfg = config or SidSafetyWorkerConfig()
    if not posts:
        return []

    req_items = [
        {
            "postId": str(p.get("postId") or p.get("_id") or ""),
            "content": str(p.get("content") or ""),
            "title": p.get("title"),
            "keywords": list(p.get("keywords") or []),
        }
        for p in posts
        if str(p.get("postId") or p.get("_id") or "").strip()
    ]
    if not req_items:
        return []

    endpoint = f"{cfg.serving_base_url.rstrip('/')}/v3/sid/encode"
    client_kwargs: Dict[str, Any] = {"timeout": cfg.http_timeout_sec}
    if transport is not None:
        client_kwargs["transport"] = transport

    with httpx.Client(**client_kwargs) as client:
        resp = client.post(endpoint, json={"items": req_items})
        resp.raise_for_status()
        payload = resp.json()

    post_meta = {str(p.get("postId") or p.get("_id")): p for p in posts}
    events: List[Dict[str, Any]] = []
    for item in payload.get("results", []):
        pid = str(item.get("postId") or "")
        src = post_meta.get(pid, {})
        events.append(
            build_post_sid_assigned_event(
                post_id=pid,
                author_id=str(src.get("authorId") or ""),
                created_at_ms=int(src.get("createdAtMs") or int(time.time() * 1000)),
                codes=item.get("semanticIds") or [-1] * 6,
                safety_labels={"safe": True, "level": "safe", "labels": []},
                codebook_version=cfg.codebook_version,
            )
        )
    return events


def consume_post_created_events(
    redis_client: Any,
    *,
    consumer_name: str,
    config: Optional[SidSafetyWorkerConfig] = None,
    count: int = 32,
    block_ms: int = 1000,
) -> List[Dict[str, Any]]:
    """从 VPS 内网 Redis Stream 消费一批待编码新帖消息（Phase 28D 独立 Worker 进程运行）。"""
    cfg = config or SidSafetyWorkerConfig()
    try:
        redis_client.xgroup_create(cfg.redis_stream_key, cfg.consumer_group, id="0", mkstream=True)
    except Exception:
        pass

    batches = redis_client.xreadgroup(
        cfg.consumer_group,
        consumer_name,
        {cfg.redis_stream_key: ">"},
        count=count,
        block=block_ms,
    )
    extracted: List[Dict[str, Any]] = []
    for _stream_name, messages in batches or []:
        for msg_id, fields in messages:
            raw_payload = fields.get(b"payload") or fields.get("payload") or b"{}"
            if isinstance(raw_payload, bytes):
                raw_payload = raw_payload.decode("utf-8", errors="ignore")
            try:
                parsed = json.loads(raw_payload)
            except Exception:
                parsed = {}
            topic = str(parsed.get("topic") or fields.get("topic") or "")
            if topic == "post.created":
                extracted.append({"stream_id": msg_id, **parsed})
    return extracted
