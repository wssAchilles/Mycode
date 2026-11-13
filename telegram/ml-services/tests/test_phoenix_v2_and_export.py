"""Phoenix V2 候选隔离、PIT 导出、侧车合约校验及端到端服务适配高杠杆测试。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import gzip
import importlib
import json
from pathlib import Path
import pickle
import re
import sys

from bson import ObjectId
from fastapi.testclient import TestClient
import pytest
import torch

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.contracts.actions import ACTION_TYPE_MAP, PREDICTED_ACTIONS
from recsys.contracts.artifacts import build_serving_manifest
from recsys.data.pit_export import (
    build_post_metadata_map,
    build_training_samples,
    is_synthetic_record,
    load_actions_from_jsonl_files,
    merge_and_group_user_actions,
)
from recsys.models.phoenix_v2 import create_mini_phoenix, stable_id_hash
from recsys.serving.phoenix_adapter import apply_platt_calibration
from recsys.training.calibration_and_sidecars import (
    REALGRAPH_FEATURES,
    SOCIAL_PHOENIX_TASKS,
    extract_realgraph_records_from_samples,
    fit_weighted_calibrator,
    run_sidecar_training,
    train_realgraph_gbt,
    train_social_phoenix_linear,
    validate_social_phoenix_linear_artifact,
)
from recsys.training.phoenix_v2_trainer import PhoenixV2TrainConfig, train_phoenix_v2


def test_compat_script_entrypoints_reexport_canonical_symbols() -> None:
    """确认 scripts/ 兼容层可无缝转发至 recsys 子包，保障旧工作流不破坏。"""
    phoenix_v2_mod = importlib.import_module("scripts.phoenix_v2_model")
    export_mod = importlib.import_module("scripts.export_training_data")
    train_mod = importlib.import_module("scripts.train_phoenix_v2")
    sidecars_mod = importlib.import_module("scripts.train_sidecars")

    assert hasattr(phoenix_v2_mod, "PhoenixV2Ranker")
    assert hasattr(phoenix_v2_mod, "create_mini_phoenix")
    assert hasattr(export_mod, "build_training_samples")
    assert hasattr(export_mod, "build_post_metadata_map")
    assert hasattr(train_mod, "train_phoenix_v2")
    assert hasattr(train_mod, "PhoenixV2TrainConfig")
    assert hasattr(sidecars_mod, "run_sidecar_training")


def test_phoenix_v2_candidate_isolation_forward_and_gradient_invariance() -> None:
    """严格验证 Candidate Isolation：修改候选 B 对候选 A 的前向输出与反向梯度零干扰。"""
    torch.manual_seed(7)
    model = create_mini_phoenix(max_history_len=16, max_candidates=8)
    model.eval()

    user_ids = torch.tensor([stable_id_hash("u_iso")], dtype=torch.long)
    hist_posts = torch.tensor([[stable_id_hash("h1"), stable_id_hash("h2"), 0, 0]], dtype=torch.long)
    hist_authors = torch.tensor([[stable_id_hash("a1"), stable_id_hash("a2"), 0, 0]], dtype=torch.long)
    hist_acts = torch.tensor([[ACTION_TYPE_MAP["like"], ACTION_TYPE_MAP["click"], 0, 0]], dtype=torch.long)
    hist_buckets = torch.tensor([[1, 4, 0, 0]], dtype=torch.long)
    hist_mask = torch.tensor([[1, 1, 0, 0]], dtype=torch.long)

    # 第一组候选：[CandA, CandB1]
    cand_posts_1 = torch.tensor([[stable_id_hash("cand_A"), stable_id_hash("cand_B_alpha")]], dtype=torch.long)
    cand_authors_1 = torch.tensor([[stable_id_hash("auth_A"), stable_id_hash("auth_B1")]], dtype=torch.long)
    cand_in_net_1 = torch.tensor([[1, 0]], dtype=torch.long)
    cand_has_vid_1 = torch.tensor([[0, 1]], dtype=torch.long)
    cand_mask = torch.tensor([[1, 1]], dtype=torch.long)

    # 第二组仅剧烈扰动候选 B 为 CandB2 与不同作者/网内/视频属性
    cand_posts_2 = torch.tensor([[stable_id_hash("cand_A"), stable_id_hash("cand_B_omega")]], dtype=torch.long)
    cand_authors_2 = torch.tensor([[stable_id_hash("auth_A"), stable_id_hash("auth_B2")]], dtype=torch.long)
    cand_in_net_2 = torch.tensor([[1, 1]], dtype=torch.long)
    cand_has_vid_2 = torch.tensor([[0, 0]], dtype=torch.long)

    out1 = model(
        user_ids,
        hist_posts,
        hist_authors,
        hist_acts,
        hist_mask,
        cand_posts_1,
        cand_authors_1,
        cand_mask,
        history_time_buckets=hist_buckets,
        candidate_in_network=cand_in_net_1,
        candidate_has_video=cand_has_vid_1,
    )
    out2 = model(
        user_ids,
        hist_posts,
        hist_authors,
        hist_acts,
        hist_mask,
        cand_posts_2,
        cand_authors_2,
        cand_mask,
        history_time_buckets=hist_buckets,
        candidate_in_network=cand_in_net_2,
        candidate_has_video=cand_has_vid_2,
    )

    for head in list(PREDICTED_ACTIONS) + ["dwell_time"]:
        diff = torch.abs(out1[head][0, 0] - out2[head][0, 0]).item()
        assert diff < 1e-5, f"候选 B 扰动污染了候选 A 的 {head} 输出: diff={diff}"

    # 反向梯度隔离检查：仅对候选 A 求导，梯度不得受候选 B 替换影响
    model.zero_grad(set_to_none=True)
    out1["like"][0, 0].backward()
    grad_user_1 = model.user_emb.tables[0].weight.grad.clone()

    model.zero_grad(set_to_none=True)
    out2["like"][0, 0].backward()
    grad_user_2 = model.user_emb.tables[0].weight.grad.clone()

    assert torch.max(torch.abs(grad_user_1 - grad_user_2)).item() < 1e-5


def test_pit_export_leakage_synthetic_filtering_and_metadata_query(tmp_path: Path) -> None:
    """验证 PIT 因果截断、合成用户剔除、GCS jsonl.gz 去重以及 ObjectId/externalId 联合查询。"""
    base_ts = datetime(2026, 11, 10, 12, 0, 0, tzinfo=timezone.utc)

    # 验证合成样本过滤规则
    assert is_synthetic_record({"userId": "demo_user_1", "action": "click"})
    assert is_synthetic_record({"userId": "u_real", "metadata": {"isSynthetic": True}})
    assert is_synthetic_record({"userId": "u_real", "experimentKeys": ["prepare_interview_demo"]})
    assert not is_synthetic_record({"userId": "u_real_99", "action": "like", "targetPostId": "p1"})

    # 写入两份包含重复键和合成用户的 .jsonl.gz 归档
    gz_path = tmp_path / "actions_part1.jsonl.gz"
    lines = [
        {"userId": "seed_bot_1", "action": "like", "targetPostId": "p1", "timestamp": base_ts.isoformat()},
        {
            "userId": "u_1",
            "action": "click",
            "targetPostId": "p1",
            "targetAuthorId": "a1",
            "dwellTimeMs": 1200,
            "timestamp": base_ts.isoformat(),
        },
        # 同主键更长 dwellTimeMs，应覆盖前者而非产生重复样本
        {
            "userId": "u_1",
            "action": "click",
            "targetPostId": "p1",
            "targetAuthorId": "a1",
            "dwellTimeMs": 4800,
            "timestamp": base_ts.isoformat(),
        },
        {"userId": "u_1", "action": "like", "targetPostId": "p2", "targetAuthorId": "a2", "timestamp": (base_ts + timedelta(minutes=10)).isoformat()},
        {"userId": "u_1", "action": "reply", "targetPostId": "p3", "targetAuthorId": "a3", "timestamp": (base_ts + timedelta(minutes=20)).isoformat()},
        {"userId": "u_1", "action": "repost", "targetPostId": "p4", "targetAuthorId": "a4", "timestamp": (base_ts + timedelta(minutes=30)).isoformat()},
        # 5 天后同一帖子的后续行为不得穿越回早期评估窗口
        {"userId": "u_1", "action": "quote", "targetPostId": "p4", "targetAuthorId": "a4", "timestamp": (base_ts + timedelta(days=5)).isoformat()},
    ]
    with gzip.open(gz_path, "wt", encoding="utf-8") as f:
        for row in lines:
            f.write(json.dumps(row) + "\n")

    records = load_actions_from_jsonl_files([gz_path], exclude_synthetic=True)
    grouped = merge_and_group_user_actions(records, min_actions_per_user=3)
    assert "seed_bot_1" not in grouped
    assert "u_1" in grouped
    assert grouped["u_1"][0]["dwell_ms"] == 4800

    # 验证 build_post_metadata_map 正确拆分 ObjectId 与 externalId 联合查表
    oid = ObjectId()
    captured_queries = []

    class _FakePostsCollection:
        def find(self, query, projection):  # noqa: ARG002
            captured_queries.append(query)
            return [
                {"_id": oid, "authorId": "auth_oid", "media": [{"type": "video"}], "newsMetadata": {}},
                {"_id": ObjectId(), "authorId": "auth_ext", "media": [], "newsMetadata": {"externalId": "news_ext_1"}},
            ]

    class _FakeDb:
        def __getitem__(self, name: str):
            assert name == "posts"
            return _FakePostsCollection()

    post_map = build_post_metadata_map(_FakeDb(), [str(oid), "news_ext_1"])
    assert len(captured_queries) == 1
    or_clauses = captured_queries[0]["$or"]
    assert any(isinstance(c.get("_id", {}).get("$in", [None])[0], ObjectId) for c in or_clauses if "_id" in c)
    assert any("newsMetadata.externalId" in c for c in or_clauses)
    assert post_map[str(oid)]["has_video"] is True
    assert post_map["news_ext_1"]["author_id"] == "auth_ext"

    samples = build_training_samples(grouped, post_map, max_history_len=16, min_history_len=3, num_negatives=2, seed=42)
    positives = [s for s in samples if s["is_positive"]]
    assert len(positives) >= 1
    # p4 在 min_history=3 时触发；历史长度恰好等于 3（p1, p2, p3），且不含未来 p4 与 5 天后 quote
    p4_sample = next(s for s in positives if s["candidate_post_id"] == "p4")
    hist_pids = [h[0] for h in p4_sample["history"]]
    assert hist_pids == ["p1", "p2", "p3"]
    assert all(len(h) == 4 and 0 <= h[3] <= 15 for h in p4_sample["history"])
    assert p4_sample["labels"]["repost"] == 1.0
    assert p4_sample["labels"]["quote"] == 0.0


def _build_synthetic_training_samples(num_samples: int = 24) -> list[dict]:
    samples: list[dict] = []
    base_ts = datetime(2026, 11, 1, 8, 0, 0, tzinfo=timezone.utc)
    for idx in range(num_samples):
        engaged = idx % 2 == 0
        samples.append(
            {
                "user_id": f"u_{idx % 4}",
                "history": [
                    (f"hp_{j}", f"ha_{j % 2}", ACTION_TYPE_MAP["like" if j % 2 == 0 else "click"], j % 6)
                    for j in range(4)
                ],
                "candidate_post_id": f"cp_{idx}",
                "candidate_author_id": "ha_0" if engaged else "ha_other",
                "labels": {
                    "click": 1.0 if engaged else 0.0,
                    "like": 1.0 if engaged and idx % 4 == 0 else 0.0,
                    "reply": 1.0 if engaged and idx % 6 == 0 else 0.0,
                    "repost": 1.0 if engaged and idx % 8 == 0 else 0.0,
                    "quote": 0.0,
                    "share": 1.0 if engaged and idx % 6 == 0 else 0.0,
                    "dwell": 1.0 if engaged else 0.0,
                    "video_view": 0.0,
                    "follow_author": 1.0 if idx % 8 == 0 else 0.0,
                    "not_interested": 0.0 if engaged else (1.0 if idx % 3 == 0 else 0.0),
                    "block_author": 0.0,
                    "mute_author": 0.0,
                    "report": 0.0,
                },
                "dwell_ms": 18_000 if engaged else 200,
                "in_network": engaged,
                "has_video": idx % 3 == 0,
                "action_time": (base_ts + timedelta(minutes=idx * 15)).isoformat(),
                "is_positive": engaged,
            }
        )
    return samples


def test_phoenix_v2_cpu_train_export_manifest_and_app_serving(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """验证 Phoenix V2 CPU 迷你训练、配置/权重导出、防篡改校验与 FastAPI /phoenix/predict 端到端链路。"""
    data_dir = tmp_path / "data"
    models_dir = tmp_path / "models"
    data_dir.mkdir(parents=True, exist_ok=True)
    samples = _build_synthetic_training_samples(24)

    report = train_phoenix_v2(
        PhoenixV2TrainConfig(
            data_dir=data_dir,
            models_dir=models_dir,
            scale="mini",
            epochs=2,
            batch_size=8,
            max_history=16,
            max_candidates=8,
            val_ratio=0.2,
            num_workers=0,
            seed=123,
        ),
        samples=samples,
    )
    assert report["model"] == "phoenix_v2"
    assert len(report["epochs"]) == 2
    assert report["cpuBenchmark"]["cpuFp32P50Ms"] > 0.0
    assert (models_dir / "phoenix_v2_inference.pt").exists()
    assert (models_dir / "phoenix_v2_config.json").exists()

    # 训练一套侧车 Platt 校准器一并随 manifest 发布
    fit_weighted_calibrator(samples, models_dir=models_dir)

    manifest = build_serving_manifest(
        version="2026-11-13_v2_test",
        profile="phoenix-v2",
        faiss_index_type="ivf_pq",
        models_dir=models_dir,
        data_dir=data_dir,
        embedding_dim=128,
        include_checksums=True,
    )
    (data_dir / "serving_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    import app as app_module

    monkeypatch.setattr(app_module, "DATA_DIR", data_dir)
    monkeypatch.setattr(app_module, "MODELS_DIR", models_dir)
    monkeypatch.setattr(app_module, "ARTIFACT_PROFILE", "phoenix-v2")
    monkeypatch.setattr(app_module, "VERIFY_ARTIFACT_CHECKSUMS", True)
    monkeypatch.setattr(app_module, "ALLOW_ARTIFACT_DOWNLOAD_ON_REQUEST", False)
    monkeypatch.setattr(app_module, "phoenix_model", None)
    monkeypatch.setattr(app_module, "news_vocab", None)
    monkeypatch.setattr(app_module, "user_vocab", None)
    monkeypatch.setattr(app_module, "serving_manifest", None)
    monkeypatch.setattr(app_module, "manifest_verified", None)

    client = TestClient(app_module.app)
    resp = client.post(
        "/phoenix/predict",
        json={
            "userId": "u_0",
            "userActionSequence": [
                {"targetPostId": "hp_0", "targetAuthorId": "ha_0", "action": "like", "timestamp": "2026-11-13T10:00:00Z"},
                {"targetPostId": "brand_new_post", "targetAuthorId": "ha_1", "action": "click"},
            ],
            "candidates": [
                {"postId": "cp_0", "authorId": "ha_0", "inNetwork": True, "hasVideo": True, "videoDurationSec": 18.0},
                {"postId": "unseen_cold_post", "authorId": "new_auth", "inNetwork": False, "hasVideo": False},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    preds = resp.json()["predictions"]
    assert len(preds) == 2
    for pred in preds:
        for key in ("click", "like", "reply", "repost", "quote", "share", "dwell", "dwellTime", "notInterested", "dismiss", "block"):
            assert 0.0 <= pred[key] <= 1.0

    health = client.get("/health").json()
    assert health["phoenix_loaded"] is True
    assert health["phoenix_variant"] == "v2"
    assert health["manifest_verified"] is True

    # 校验 fail-closed SHA-256 篡改防护：破坏模型权重后必须拒绝加载
    monkeypatch.setattr(app_module, "phoenix_model", None)
    with open(models_dir / "phoenix_v2_inference.pt", "ab") as f:
        f.write(b"corrupted_tail")
    with pytest.raises(RuntimeError, match="SHA-256"):
        app_module.load_phoenix_sync(allow_download=False)


def test_sidecars_social_phoenix_realgraph_gbt_and_platt_contracts(tmp_path: Path) -> None:
    """验证三大轻量化侧车产出严格对齐后端 JS ISO 契约、RealGraph 特征规范与 Platt 校准逻辑。"""
    samples = _build_synthetic_training_samples(20)
    samples_path = tmp_path / "samples.pkl"
    models_dir = tmp_path / "models"
    with open(samples_path, "wb") as f:
        pickle.dump(samples, f)

    report = run_sidecar_training(samples_path=samples_path, models_dir=models_dir)
    assert report["socialPhoenixFeatures"] > 0

    social = json.loads((models_dir / "social_phoenix_linear.json").read_text(encoding="utf-8"))
    ok, errors = validate_social_phoenix_linear_artifact(social)
    assert ok, f"SocialPhoenix 契约校验失败: {errors}"
    assert set(social["tasks"].keys()) == set(SOCIAL_PHOENIX_TASKS)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", social["trainedAt"])

    # 验证仅单个正样本/全零标签的极端退化情形亦不会崩溃且仍通过契约校验
    single_class_samples = [{**samples[0], "labels": {a: 0.0 for a in PREDICTED_ACTIONS}}]
    degenerate_social = train_social_phoenix_linear(single_class_samples)
    ok_deg, errs_deg = validate_social_phoenix_linear_artifact(degenerate_social)
    assert ok_deg, f"退化数据产物未通过契约校验: {errs_deg}"

    realgraph = json.loads((models_dir / "realgraph_gbt.json").read_text(encoding="utf-8"))
    assert tuple(realgraph["features"]) == REALGRAPH_FEATURES
    assert isinstance(realgraph["trees"], list) and len(realgraph["trees"]) >= 4

    records_rg = extract_realgraph_records_from_samples(samples)
    assert all(set(REALGRAPH_FEATURES).issubset(r.keys()) for r in records_rg)
    rg_again = train_realgraph_gbt(records_rg, n_estimators=8)
    assert len(rg_again["trees"]) == 8

    calibrator = json.loads((models_dir / "weighted_calibrator.json").read_text(encoding="utf-8"))
    assert calibrator["method"] == "platt"
    calibrated = apply_platt_calibration("click", 0.5, calibrator)
    assert 0.0 <= calibrated <= 1.0
