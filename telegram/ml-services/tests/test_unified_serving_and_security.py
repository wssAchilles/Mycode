"""统一 V3/V2 双入口契约、Gemini 密钥脱敏、写接口鉴权、同步线程池路由与归档增量清理回归测试。"""

from __future__ import annotations

from datetime import datetime, timezone
import importlib
import inspect
from pathlib import Path
import sys
from typing import Any, Dict, List

from fastapi.testclient import TestClient
import pytest
import requests

from agent_plane.providers.gemini import GeminiProvider
from src.serving.config import ServingConfig
from src.serving.main import create_serving_app
from src.serving.routes.encode_sid import encode_sid
from src.serving.routes.rank import PhoenixPredictionV3, phoenix_predict
from src.serving.routes.retrieve import ann_retrieve
from src.serving.routes.vf import vf_check_v2

_LIGHT_JOBS_ROOT = Path(__file__).resolve().parents[2] / "telegram-light-jobs"
if str(_LIGHT_JOBS_ROOT) not in sys.path:
    sys.path.append(str(_LIGHT_JOBS_ROOT))


def test_v3_serving_exposes_all_unified_routes_and_sync_handlers() -> None:
    """确认 V3 src.serving.main:app 同时挂载 health/ready/sid/vf/agent 全套端点且推理路由均为同步函数。"""
    serving_app = create_serving_app(ServingConfig(preload_on_startup=False))
    route_paths = set(serving_app.openapi()["paths"].keys())

    expected_paths = {
        "/health",
        "/ready",
        "/sid/encode",
        "/v3/sid/encode",
        "/ann/retrieve",
        "/phoenix/predict",
        "/vf/check",
        "/vf/check/v2",
        "/vf/blacklist/add",
        "/vf/blacklist/remove",
        "/vf/rules/add",
        "/agent/respond",
    }
    assert expected_paths.issubset(route_paths)

    # 验证 CPU/网络密集路由均声明为普通同步函数，由 FastAPI 线程池执行而不阻塞事件循环
    for endpoint_fn in (ann_retrieve, phoenix_predict, encode_sid, vf_check_v2):
        assert not inspect.iscoroutinefunction(endpoint_fn)

    # 验证 PhoenixPredictionV3 完整补齐 Node PhoenixScorer 所需的 5 个兼容字段
    pred = PhoenixPredictionV3(postId="p1", click=0.2, like=0.3, reply=0.1, repost=0.05)
    dumped = pred.model_dump()
    for compat_field in ("profileClick", "quotedClick", "photoExpand", "shareViaDm", "shareViaCopyLink"):
        assert compat_field in dumped
        assert dumped[compat_field] == 0.0


def test_v3_vf_check_and_protected_mutation_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证 V3 /vf/check/v2 确定性过滤及黑名单/规则写接口内部密钥保护与 Candidates 长度上限。"""
    monkeypatch.setenv("ML_INTERNAL_TOKEN", "ml-internal-secret-token")
    serving_app = create_serving_app(ServingConfig(preload_on_startup=False))
    client = TestClient(serving_app)

    # 1. /vf/check/v2 正常识别安全文本与高危文本
    check_resp = client.post(
        "/vf/check/v2",
        json={
            "items": [
                {"postId": "p_safe", "userId": "u1", "content": "今天天气真不错"},
                {"postId": "p_spam", "userId": "u2", "content": "click here now make money fast"},
            ],
            "skipML": True,
        },
    )
    assert check_resp.status_code == 200
    results = {item["postId"]: item for item in check_resp.json()["results"]}
    assert results["p_safe"]["safe"] is True
    assert results["p_safe"]["level"] == "safe"
    assert results["p_spam"]["safe"] is False
    assert "spam" in results["p_spam"]["violations"]

    # 2. 未携带内部密钥请求黑名单写接口必须返回 401，错误密钥返回 403
    no_auth = client.post("/vf/blacklist/add", params={"user_id": "bad_actor"})
    assert no_auth.status_code == 401
    wrong_auth = client.post(
        "/vf/blacklist/add",
        params={"user_id": "bad_actor"},
        headers={"x-ml-internal-token": "wrong"},
    )
    assert wrong_auth.status_code == 403

    # 3. 携带正确内部密钥可成功更新黑名单并立即在 /vf/check/v2 生效
    ok_auth = client.post(
        "/vf/blacklist/add",
        params={"user_id": "bad_actor"},
        headers={"x-ml-internal-token": "ml-internal-secret-token"},
    )
    assert ok_auth.status_code == 200
    blocked_check = client.post(
        "/vf/check/v2",
        json={"items": [{"postId": "p_blk", "userId": "bad_actor", "content": "hello"}], "skipML": True},
    )
    assert blocked_check.status_code == 200
    assert blocked_check.json()["results"][0]["safe"] is False
    assert blocked_check.json()["results"][0]["level"] == "blocked"

    # 4. 超长候选列表触发 422 防 OOM 保护
    oversized = [{"postId": f"p_{i}"} for i in range(501)]
    rank_resp = client.post("/phoenix/predict", json={"userId": "u1", "candidates": oversized})
    assert rank_resp.status_code == 422


def test_gemini_provider_uses_header_key_and_never_leaks_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证 GeminiProvider 严禁在 URL 拼接 key=，且 500 报错绝不回显明文 API Key。"""
    secret_key = "AIzaSySecretKeyNeverLeak999"
    monkeypatch.setenv("GEMINI_API_KEY", secret_key)

    # 静态源码检查确认 gemini.py 不含 ?key= 查询拼接
    gemini_src = (Path(__file__).resolve().parents[1] / "agent_plane" / "providers" / "gemini.py").read_text(
        encoding="utf-8"
    )
    assert "?key=" not in gemini_src

    captured_call: Dict[str, Any] = {}

    class DummyResponse:
        status_code = 429

        def raise_for_status(self) -> None:
            raise requests.HTTPError(
                f"429 Client Error for url: https://example.com?key={secret_key}",
                response=self,  # type: ignore[arg-type]
            )

    def fake_post(url: str, **kwargs: Any) -> DummyResponse:
        captured_call["url"] = url
        captured_call["headers"] = kwargs.get("headers", {})
        return DummyResponse()

    monkeypatch.setattr(requests, "post", fake_post)

    provider = GeminiProvider()
    with pytest.raises(RuntimeError) as exc_info:
        provider.generate(system_instruction="sys", prompt="hi", history=[])

    assert "key=" not in captured_call["url"]
    assert captured_call["headers"].get("x-goog-api-key") == secret_key
    assert secret_key not in str(exc_info.value)

    # 通过 FastAPI /agent/respond 端到端验证 500 响应体完全脱敏
    serving_app = create_serving_app(ServingConfig(preload_on_startup=False))
    agent_router_module = importlib.import_module("agent_plane.http.router")

    monkeypatch.setattr(agent_router_module.orchestrator, "provider", provider)
    client = TestClient(serving_app)
    resp = client.post(
        "/agent/respond",
        json={
            "userId": "u1",
            "message": "你好",
            "conversationHistory": [],
            "contextSnapshot": {
                "user": {"id": "u1", "username": "alice"},
                "requestedScopes": ["feed"],
                "generatedAt": "2026-11-18T00:00:00Z",
            },
        },
    )
    assert resp.status_code == 500
    assert secret_key not in resp.text
    assert resp.json()["detail"] == "agent_plane_failed"


def test_v2_app_exposes_ready_and_sid_encode_compat_routes() -> None:
    """确认 V2 app:app 同样补齐 /ready、/sid/encode、/v3/sid/encode 路由，实现双入口对等兼容。"""
    import app as v2_app_module

    v2_paths = set(v2_app_module.app.openapi()["paths"].keys())
    for required in ("/health", "/ready", "/sid/encode", "/v3/sid/encode", "/vf/check/v2", "/agent/respond"):
        assert required in v2_paths

    client = TestClient(v2_app_module.app)
    sid_resp = client.post("/sid/encode", json={"items": [{"postId": "p1", "content": "hello"}]})
    # 未加载 ONNX 模型时返回 503 服务未就绪而非 404 路由缺失
    assert sid_resp.status_code in (200, 503)


def test_light_jobs_archive_incremental_watermark_and_temp_file_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """验证 user_actions 归档按天增量推进水位，并在上传失败时 100% 删除临时 .jsonl.gz 文件。"""
    from jobs.archive import user_actions as archive_mod

    monkeypatch.setattr(archive_mod.tempfile, "tempdir", str(tmp_path))

    watermarks: Dict[str, Dict[str, Any]] = {}
    recorded_queries: List[Dict[str, Any]] = []
    uploaded_objects: List[str] = []
    fail_upload = {"enabled": False}

    class FakeCollection:
        def __init__(self, docs: List[Dict[str, Any]]) -> None:
            self._docs = docs

        def find(self, query: Dict[str, Any], _proj: Dict[str, Any]):
            recorded_queries.append(query)
            ts_filter = query.get("timestamp", {})
            gte = ts_filter.get("$gte")
            lt = ts_filter.get("$lt")
            matched = [
                d
                for d in self._docs
                if (gte is None or d["timestamp"] >= gte) and (lt is None or d["timestamp"] < lt)
            ]

            class _Cursor(list):
                def sort(self, *_args: Any) -> "_Cursor":
                    return self

            return _Cursor(matched)

        def find_one(self, query: Dict[str, Any]) -> Dict[str, Any] | None:
            return watermarks.get(query.get("_id", ""))

        def update_one(self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False) -> None:
            _ = upsert
            doc_id = query["_id"]
            watermarks.setdefault(doc_id, {"_id": doc_id}).update(update.get("$set", {}))

    action_docs = [
        {
            "_id": "act1",
            "userId": "u1",
            "action": "like",
            "targetPostId": "p1",
            "timestamp": datetime(2026, 11, 17, 12, 30, 0),
        }
    ]
    fake_db = {
        "user_actions": FakeCollection(action_docs),
        "archive_watermarks": FakeCollection([]),
    }

    class FakeClient:
        def close(self) -> None:
            pass

    class FakeBlob:
        def __init__(self, name: str) -> None:
            self.name = name

        def upload_from_filename(self, filename: str, content_type: str = "") -> None:
            _ = content_type
            assert Path(filename).exists()
            if fail_upload["enabled"]:
                raise RuntimeError("simulated_gcs_upload_failure")
            uploaded_objects.append(self.name)

    class FakeBucket:
        def blob(self, name: str) -> FakeBlob:
            return FakeBlob(name)

    monkeypatch.setattr(archive_mod, "_mongo_db", lambda: (FakeClient(), fake_db))
    monkeypatch.setattr(archive_mod, "_gcs_bucket", lambda: FakeBucket())

    fixed_now = datetime(2026, 11, 18, 2, 0, 0, tzinfo=timezone.utc)

    # 1. 模拟上传异常，验证临时 .jsonl.gz 被 finally 块彻底清理
    fail_upload["enabled"] = True
    with pytest.raises(RuntimeError, match="simulated_gcs_upload_failure"):
        archive_mod.archive_user_actions_to_gcs(days=1, dry_run=False, now_utc=fixed_now)
    assert list(tmp_path.glob("user_actions_*.jsonl.gz")) == []
    assert "user_actions" not in watermarks

    # 2. 正常归档昨日数据，推进水位并清理临时文件
    fail_upload["enabled"] = False
    first_res = archive_mod.archive_user_actions_to_gcs(days=1, dry_run=False, now_utc=fixed_now)
    assert first_res["archived"] == 1
    assert len(uploaded_objects) == 1
    assert list(tmp_path.glob("user_actions_*.jsonl.gz")) == []

    # 3. 同一自然日再次触发归档，因增量水位已对齐，零重复扫描与上传
    second_res = archive_mod.archive_user_actions_to_gcs(days=7, dry_run=False, now_utc=fixed_now)
    assert second_res["archived"] == 0
    assert len(uploaded_objects) == 1
