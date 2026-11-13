"""阶段 1 契约与导出高价值回归测试：MLP 导出一致性、Manifest SHA-256 防篡改与 ANN 响应证据校验。"""

from __future__ import annotations

import json
import pickle
import re
from pathlib import Path

import torch
import faiss
import numpy as np
import pytest
from fastapi.testclient import TestClient

from recsys.contracts.ann import build_ann_response_evidence, build_user_embedding_contract, infer_id_namespace
from recsys.contracts.artifacts import (
    build_serving_manifest,
    verify_manifest_checksums,
)
from recsys.models.two_tower import TwoTowerModel, compute_infonce_loss
from recsys.training.two_tower_trainer import TwoTowerDataset, TwoTowerTrainConfig, train_two_tower


def _write_mini_corpus(data_dir: Path, ids_are_object_ids: bool = False) -> tuple[dict, dict, Path]:
    news_vocab = {"<PAD>": 0, "<UNK>": 1}
    if ids_are_object_ids:
        item_ids = [f"{i:024x}" for i in range(1, 21)]
    else:
        item_ids = [f"kuai_{i}" for i in range(1, 21)]
    for item_id in item_ids:
        news_vocab[item_id] = len(news_vocab)

    user_vocab = {"<PAD>": 0, "<UNK>": 1}
    for u in range(1, 7):
        user_vocab[f"u_{u}"] = len(user_vocab)

    samples = []
    for u in range(1, 7):
        hist = [item_ids[(u + k) % len(item_ids)] for k in range(3)]
        cand = item_ids[(u + 5) % len(item_ids)]
        samples.append(
            {
                "user_id": f"u_{u}",
                "history": hist,
                "candidate_id": cand,
                "label": 1,
            }
        )

    data_dir.mkdir(parents=True, exist_ok=True)
    with open(data_dir / "news_vocab.pkl", "wb") as f:
        pickle.dump(news_vocab, f)
    with open(data_dir / "user_vocab.pkl", "wb") as f:
        pickle.dump(user_vocab, f)
    samples_path = data_dir / "train_samples.pkl"
    with open(samples_path, "wb") as f:
        pickle.dump(samples, f)
    return news_vocab, user_vocab, samples_path


def test_two_tower_export_matches_news_encoder_forward_and_differs_from_raw_weights(tmp_path: Path) -> None:
    torch.manual_seed(7)
    model = TwoTowerModel(num_users=12, num_news=24, embedding_dim=32)
    model.eval()

    exported = model.encode_all_items(batch_size=7, dtype=np.float32)
    assert exported.shape == (24, 32)

    test_ids = torch.arange(24, dtype=torch.long)
    with torch.no_grad():
        forward_vecs = model.news_encoder(test_ids).cpu().numpy()
        raw_weights = model.news_encoder.news_embedding.weight.detach().cpu().numpy()

    np.testing.assert_allclose(exported, forward_vecs, atol=1e-5, rtol=1e-5)
    # 导出向量必须经过 L2 归一化
    norms = np.linalg.norm(exported[1:], axis=1)
    np.testing.assert_allclose(norms, np.ones_like(norms), atol=1e-5)

    # 归一化后的 MLP 输出不应与原始未经 FC 的 embedding 表退化一致
    raw_norms = np.linalg.norm(raw_weights[1:], axis=1, keepdims=True) + 1e-10
    raw_unit = raw_weights[1:] / raw_norms
    cos = np.sum(exported[1:] * raw_unit, axis=1)
    assert np.mean(cos) < 0.98

    # 校验与线上已有权重完全一致的状态字典键名
    keys = set(model.state_dict().keys())
    assert {
        "news_encoder.news_embedding.weight",
        "news_encoder.fc.0.weight",
        "news_encoder.fc.2.weight",
        "user_encoder.user_embedding.weight",
        "user_encoder.fc.0.weight",
        "user_encoder.fc.2.weight",
    }.issubset(keys)


def test_two_tower_trainer_uses_unk_index_one_and_exports_mlp_space(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    models_dir = tmp_path / "models"
    news_vocab, user_vocab, _ = _write_mini_corpus(data_dir)

    # 确认未知用户与未知物品在 Dataset 中映射为 <UNK>=1，而非 <PAD>=0
    bad_samples_path = data_dir / "bad_samples.pkl"
    with open(bad_samples_path, "wb") as f:
        pickle.dump(
            [
                {
                    "user_id": "never_seen_user",
                    "history": ["never_seen_item_1", "kuai_1"],
                    "candidate_id": "never_seen_cand",
                    "label": 1,
                }
            ],
            f,
        )
    ds = TwoTowerDataset(bad_samples_path, news_vocab, user_vocab, max_history=4)
    row = ds[0]
    assert int(row["user_id"].item()) == 1
    assert int(row["target_id"].item()) == 1
    assert row["history"].tolist() == [1, news_vocab["kuai_1"], 0, 0]

    report = train_two_tower(
        TwoTowerTrainConfig(
            data_dir=data_dir,
            models_dir=models_dir,
            batch_size=4,
            embedding_dim=32,
            epochs=2,
            lr=1e-2,
            max_history=4,
            loss_type="infonce",
            log_q_correction=True,
        )
    )
    assert report["maxUnitNormError"] < 1e-4

    # 加载训练后的权重并比对导出的 item_embeddings.npy
    loaded = TwoTowerModel(num_users=len(user_vocab), num_news=len(news_vocab), embedding_dim=32)
    loaded.load_state_dict(torch.load(models_dir / "two_tower_epoch_latest.pt", map_location="cpu", weights_only=True))
    loaded.eval()

    saved_embs = np.load(data_dir / "item_embeddings.npy")
    with torch.no_grad():
        expected = loaded.news_encoder(torch.arange(len(news_vocab), dtype=torch.long)).numpy()
    np.testing.assert_allclose(saved_embs, expected, atol=1e-5, rtol=1e-5)

    # 校验 compute_infonce_loss 支持标量输出且有限
    u = torch.nn.functional.normalize(torch.randn(4, 16), p=2, dim=1)
    v = torch.nn.functional.normalize(torch.randn(4, 16), p=2, dim=1)
    loss = compute_infonce_loss(u, v, item_log_probs=torch.zeros(4))
    assert torch.isfinite(loss) and loss.item() > 0


def test_serving_manifest_sha256_detects_tampering(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    models_dir = tmp_path / "models"
    data_dir.mkdir()
    models_dir.mkdir()

    tt_path = models_dir / "two_tower_epoch_latest.pt"
    tt_path.write_bytes(b"two-tower-binary-v1")
    nv_path = data_dir / "news_vocab.pkl"
    uv_path = data_dir / "user_vocab.pkl"
    nv_path.write_bytes(b"news-vocab")
    uv_path.write_bytes(b"user-vocab")

    manifest = build_serving_manifest(
        version="2026-11-13_test01",
        profile="serving-lite",
        faiss_index_type="flat",
        models_dir=models_dir,
        data_dir=data_dir,
        embedding_dim=256,
        id_namespace="news_external_id",
        embedding_space="semantic_news_v1",
    )
    assert manifest["schemaVersion"] == 2
    assert len(manifest["checksums"]["twoTowerModel"]) == 64

    paths = {"twoTowerModel": tt_path, "newsVocab": nv_path, "userVocab": uv_path}
    ok, errors = verify_manifest_checksums(manifest, paths, strict=True)
    assert ok and errors == []

    # 篡改单个字节必须触发 fail-closed
    tt_path.write_bytes(b"two-tower-binary-v2")
    ok_bad, errors_bad = verify_manifest_checksums(manifest, paths, strict=True)
    assert not ok_bad
    assert any(err.startswith("checksum_mismatch:twoTowerModel:") for err in errors_bad)


def test_ann_response_evidence_and_namespace_contract(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 验证不同语料 ID 命名空间推断正确
    assert infer_id_namespace({0: "<PAD>", 1: "<UNK>", 2: "kuai_10"}) == "news_external_id"
    assert infer_id_namespace({0: "<PAD>", 1: "<UNK>", 2: "507f1f77bcf86cd799439011"}) == "mongo_object_id"
    contract = build_user_embedding_contract(
        embedding_dim=256,
        model_version="m_v1",
        artifact_version="a_v1",
    )
    assert contract["dimensions"] == 256
    assert contract["retrievalEmbeddingDim"] == 256
    assert contract["semantic"] is True

    # 构造真实的模型与 FAISS 索引验证 /ann/retrieve 契约返回
    data_dir = tmp_path / "data"
    models_dir = tmp_path / "models"
    news_vocab, user_vocab, _ = _write_mini_corpus(data_dir, ids_are_object_ids=True)
    train_two_tower(
        TwoTowerTrainConfig(
            data_dir=data_dir,
            models_dir=models_dir,
            batch_size=4,
            embedding_dim=64,
            epochs=1,
            max_history=4,
        )
    )
    embs = np.load(data_dir / "item_embeddings.npy").astype(np.float32)
    index = faiss.IndexFlatIP(64)
    index.add(embs)
    faiss.write_index(index, str(models_dir / "faiss_flat.index"))
    with open(models_dir / "faiss_id_mapping.pkl", "wb") as f:
        pickle.dump({"news_vocab": news_vocab, "idx_to_news_id": {v: k for k, v in news_vocab.items()}}, f)

    manifest = build_serving_manifest(
        version="2026-11-13_contract01",
        profile="serving-lite",
        faiss_index_type="flat",
        models_dir=models_dir,
        data_dir=data_dir,
        embedding_dim=64,
        id_namespace="mongo_object_id",
        embedding_space="recommendation_two_tower_v1",
        model_version="two_tower_contract_v1",
    )
    (data_dir / "serving_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    import app as ml_app

    monkeypatch.setattr(ml_app, "MODELS_DIR", models_dir)
    monkeypatch.setattr(ml_app, "DATA_DIR", data_dir)
    monkeypatch.setattr(ml_app, "FAISS_INDEX_TYPE", "flat")
    monkeypatch.setattr(ml_app, "ARTIFACT_VERSION", "2026-11-13_contract01")
    monkeypatch.setattr(ml_app, "ARTIFACT_PROFILE", "serving-lite")
    monkeypatch.setattr(ml_app, "EMBEDDING_DIM", 64)
    monkeypatch.setattr(ml_app, "two_tower_model", None)
    monkeypatch.setattr(ml_app, "faiss_index", None)
    monkeypatch.setattr(ml_app, "news_vocab", None)
    monkeypatch.setattr(ml_app, "user_vocab", None)
    monkeypatch.setattr(ml_app, "models_loaded", False)
    monkeypatch.setattr(ml_app, "serving_manifest", None)
    monkeypatch.setattr(ml_app, "manifest_verified", None)

    ml_app.load_retrieval_sync(allow_download=False)
    client = TestClient(ml_app.app)

    resp = client.post(
        "/ann/retrieve",
        json={
            "userId": "u_1",
            "historyPostIds": [f"{1:024x}", f"{2:024x}"],
            "topK": 5,
            "expectedEvidence": {
                "embeddingSpace": "recommendation_two_tower_v1",
                "retrievalEmbeddingDim": 64,
                "idNamespace": "mongo_object_id",
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    evidence = body["evidence"]
    assert evidence["embeddingSpace"] == "recommendation_two_tower_v1"
    assert evidence["retrievalEmbeddingDim"] == 64
    assert evidence["modelVersion"] == "two_tower_contract_v1"
    assert evidence["artifactVersion"] == "2026-11-13_contract01"
    assert evidence["idNamespace"] == "mongo_object_id"
    assert evidence["indexVersion"] == "flat:2026-11-13_contract01"
    assert len(body["candidates"]) > 0
    assert all(re.match(r"^[0-9a-fA-F]{24}$", c["postId"]) for c in body["candidates"])

    # 验证 /health 也包含对齐元信息与校验状态
    health = client.get("/health").json()
    assert health["manifest_verified"] is True
    assert health["id_namespace"] == "mongo_object_id"
    assert health["embedding_space"] == "recommendation_two_tower_v1"

    # 测试 fail-closed：篡改模型文件后应拒绝加载
    (models_dir / "two_tower_epoch_latest.pt").write_bytes(b"corrupted")
    monkeypatch.setattr(ml_app, "two_tower_model", None)
    with pytest.raises(RuntimeError, match="SHA-256"):
        ml_app.load_two_tower_sync(allow_download=False)


def test_feature_refresh_external_id_resolution_and_embedding_contract() -> None:
    from bson import ObjectId
    from recsys.serving.feature_refresh import _resolve_external_id_map

    oid = ObjectId()
    pid_str = str(oid)
    news_vocab = {"<PAD>": 0, "<UNK>": 1, "N12345": 2}

    class _FakePosts:
        def find(self, query, projection):  # noqa: ARG002
            assert oid in query["_id"]["$in"]
            return [{"_id": oid, "newsMetadata": {"externalId": "N12345"}}]

    mapping = _resolve_external_id_map(_FakePosts(), [pid_str, "N12345"], news_vocab)
    assert mapping == {pid_str: "N12345"}

    contract = build_user_embedding_contract(
        embedding_dim=256,
        model_version="2026-11-13_v2",
        artifact_version="2026-11-13_v2",
        embedding_space="semantic_news_v1",
    )
    assert set(contract.keys()) == {
        "embeddingSpace",
        "dimensions",
        "retrievalEmbeddingDim",
        "rankingEmbeddingDim",
        "modelVersion",
        "artifactVersion",
        "producer",
        "semantic",
    }
    assert contract["semantic"] is True

