"""V3 Anti-Flat 双容器隔离、6x256 SID 契约、SHA-256 签名门禁与真实 ONNX Runtime 服务回归测试。"""

from __future__ import annotations

import builtins
import json
from pathlib import Path
import sys

import faiss
from fastapi.testclient import TestClient
import numpy as np
import onnx
from onnx import TensorProto, helper
import pytest

from src.contracts.actions import cread_probs_to_expected_sec, dwell_ms_to_cread_bucket
from src.contracts.ann import build_v3_post_embedding_contract, build_v3_user_embedding_contract, is_trusted_semantic_embedding_contract
from src.contracts.artifacts import build_serving_manifest_v3, verify_manifest_checksums
from src.contracts.sid import model_to_wire_sids, pack_sids_u64, unpack_sids_u64, wire_to_model_sids
from src.offline_export.validate_fp32_int8_parity import validate_fp32_int8_parity
from src.serving.config import ServingConfig
from src.serving.main import create_serving_app


def _build_toy_text_encoder_onnx(dst: Path, emb_dim: int = 16) -> None:
    """用 onnx.helper 构造真实无 PyTorch 依赖的小型文本->256d/16d 归一化前向计算图。"""
    inp_ids = helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["B", "S"])
    attn = helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["B", "S"])
    out = helper.make_tensor_value_info("embedding", TensorProto.FLOAT, ["B", emb_dim])

    w = np.linspace(0.01, 0.16, emb_dim, dtype=np.float32).reshape(1, emb_dim)
    w_init = helper.make_tensor("proj_w", TensorProto.FLOAT, [1, emb_dim], w.flatten().tolist())
    const_scale = helper.make_tensor("scale", TensorProto.FLOAT, [1], [1e-3])

    nodes = [
        helper.make_node("Cast", ["input_ids"], ["ids_f"], to=TensorProto.FLOAT),
        helper.make_node("Cast", ["attention_mask"], ["mask_f"], to=TensorProto.FLOAT),
        helper.make_node("Mul", ["ids_f", "mask_f"], ["masked"]),
        helper.make_node("ReduceMean", ["masked"], ["pooled"], axes=[1], keepdims=True),
        helper.make_node("Mul", ["pooled", "scale"], ["scaled"]),
        helper.make_node("MatMul", ["scaled", "proj_w"], ["embedding"]),
    ]
    graph = helper.make_graph(nodes, "toy_text_enc", [inp_ids, attn], [out], initializer=[w_init, const_scale])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], ir_version=8)
    onnx.checker.check_model(model)
    onnx.save(model, str(dst))


def _build_toy_two_tower_onnx(dst: Path, emb_dim: int = 16) -> None:
    """构造无用户 ID 的序列用户塔真实 ONNX 计算图（输出 (B, D) 向量）。"""
    hp = helper.make_tensor_value_info("history_post_hashes", TensorProto.INT64, ["B", "L"])
    ha = helper.make_tensor_value_info("history_action_types", TensorProto.INT64, ["B", "L"])
    am = helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["B", "L"])
    out = helper.make_tensor_value_info("user_embedding", TensorProto.FLOAT, ["B", emb_dim])

    w = np.ones((1, emb_dim), dtype=np.float32) * 0.25
    w_init = helper.make_tensor("tt_w", TensorProto.FLOAT, [1, emb_dim], w.flatten().tolist())
    scale = helper.make_tensor("tt_s", TensorProto.FLOAT, [1], [1e-6])

    nodes = [
        helper.make_node("Add", ["history_post_hashes", "history_action_types"], ["h_sum"]),
        helper.make_node("Mul", ["h_sum", "attention_mask"], ["h_masked"]),
        helper.make_node("Cast", ["h_masked"], ["h_f"], to=TensorProto.FLOAT),
        helper.make_node("ReduceMean", ["h_f"], ["pooled"], axes=[1], keepdims=True),
        helper.make_node("Mul", ["pooled", "tt_s"], ["scaled"]),
        helper.make_node("MatMul", ["scaled", "tt_w"], ["user_embedding"]),
    ]
    graph = helper.make_graph(nodes, "toy_two_tower", [hp, ha, am], [out], initializer=[w_init, scale])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], ir_version=8)
    onnx.checker.check_model(model)
    onnx.save(model, str(dst))


def _build_toy_phoenix_v3_onnx(dst: Path) -> None:
    """构造真实 Phoenix V3 Student ONNX 图，输出 action_logits (1, C, 14) 与 cread_logits (1, C, 30)。"""
    cand_hashes = helper.make_tensor_value_info("cand_post_hashes", TensorProto.INT64, [1, "C"])
    cand_net = helper.make_tensor_value_info("cand_in_network", TensorProto.INT64, [1, "C"])
    act_out = helper.make_tensor_value_info("action_logits", TensorProto.FLOAT, [1, "C", 14])
    cread_out = helper.make_tensor_value_info("cread_logits", TensorProto.FLOAT, [1, "C", 30])

    # weight shapes: (1, 14) 和 (1, 30) 方便通过 Unsqueeze (1, C, 1) @ (1, 14) 得到 (1, C, 14)
    w_act = np.linspace(-0.4, 0.8, 14, dtype=np.float32).reshape(1, 14)
    w_cread = np.linspace(-1.0, 1.0, 30, dtype=np.float32).reshape(1, 30)
    b_scale = helper.make_tensor("c_scale", TensorProto.FLOAT, [1], [1e-9])
    inits = [
        helper.make_tensor("w_act", TensorProto.FLOAT, [1, 14], w_act.flatten().tolist()),
        helper.make_tensor("w_cread", TensorProto.FLOAT, [1, 30], w_cread.flatten().tolist()),
        b_scale,
    ]
    axes_init = helper.make_tensor("unsq_axis", TensorProto.INT64, [1], [2])
    inits.append(axes_init)

    nodes = [
        helper.make_node("Add", ["cand_post_hashes", "cand_in_network"], ["c_sum"]),
        helper.make_node("Cast", ["c_sum"], ["c_f"], to=TensorProto.FLOAT),
        helper.make_node("Mul", ["c_f", "c_scale"], ["c_scaled"]),
        helper.make_node("Unsqueeze", ["c_scaled", "unsq_axis"], ["c_feat"]),  # (1, C, 1)
        helper.make_node("MatMul", ["c_feat", "w_act"], ["action_logits"]),    # (1, C, 14)
        helper.make_node("MatMul", ["c_feat", "w_cread"], ["cread_logits"]),   # (1, C, 30)
    ]
    graph = helper.make_graph(nodes, "toy_phoenix_v3", [cand_hashes, cand_net], [act_out, cread_out], initializer=inits)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], ir_version=8)
    onnx.checker.check_model(model)
    onnx.save(model, str(dst))


def _parse_req_pkg_names(raw_text: str) -> set[str]:
    """剥离注释行与版本约束，提取 requirements.txt 中的真实依赖包名称集合。"""
    import re

    pkgs: set[str] = set()
    for line in raw_text.splitlines():
        clean = line.split("#", 1)[0].strip()
        if not clean or clean.startswith("-"):
            continue
        pkg = re.split(r"[<>=!~\[\s;@]", clean, maxsplit=1)[0].strip().lower()
        if pkg:
            pkgs.add(pkg)
    return pkgs


def test_serving_container_and_requirements_physically_exclude_heavy_ml_deps() -> None:
    """确认 serving.txt 与 Dockerfile.serving 严格剥离 torch/transformers/crawler 重型依赖。"""
    ml_root = Path(__file__).resolve().parent.parent
    serving_req = (ml_root / "requirements" / "serving.txt").read_text(encoding="utf-8")
    worker_req = (ml_root / "requirements" / "worker.txt").read_text(encoding="utf-8")
    dockerfile_srv = (ml_root / "docker" / "Dockerfile.serving").read_text(encoding="utf-8")

    serving_pkgs = _parse_req_pkg_names(serving_req)
    worker_pkgs = _parse_req_pkg_names(worker_req)

    forbidden = ("torch", "transformers", "sentence-transformers", "newspaper3k", "feedparser", "apscheduler", "pymongo")
    for pkg in forbidden:
        assert pkg not in serving_pkgs, f"serving.txt must not depend on {pkg}"
        assert pkg in worker_pkgs, f"worker.txt expected to include {pkg}"

    assert "onnxruntime" in serving_pkgs
    assert "uvicorn src.serving.main:app" in dockerfile_srv
    assert "COPY src/serving" in dockerfile_srv
    assert "crawler" not in dockerfile_srv


def test_src_serving_imports_with_torch_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    """屏蔽 import torch 后仍可无错导入 src.serving 与 src.onnx_runtime 并创建 FastAPI App。"""
    real_import = builtins.__import__

    def _no_torch_import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: ANN001, ANN202
        if name == "torch" or name.startswith("torch."):
            raise ImportError("torch is strictly forbidden in pure ONNX serving container")
        return real_import(name, globals, locals, fromlist, level)

    for mod_name in list(sys.modules):
        if mod_name == "src.serving" or mod_name.startswith("src.serving.") or mod_name.startswith("src.onnx_runtime."):
            sys.modules.pop(mod_name, None)

    monkeypatch.setattr(builtins, "__import__", _no_torch_import)
    from src.serving.main import create_serving_app

    app = create_serving_app(ServingConfig(preload_on_startup=False))
    assert app.title.startswith("Phoenix V3 Recommendation Serving")


def test_sid_6x256_roundtrip_and_embedding_contract_alignment() -> None:
    """验证 6x256 SID Wire<->Model 1-indexed 映射、48-bit u64 打包与 Node 白名单一致。"""
    wire = [12, 87, 203, 5, 199, 64]
    model_ids = wire_to_model_sids(wire)
    assert model_ids == [13, 88, 204, 6, 200, 65]
    assert model_to_wire_sids(model_ids) == wire
    assert wire_to_model_sids([-1] * 6) == [0] * 6
    assert model_to_wire_sids([0] * 6) == [-1] * 6

    packed = pack_sids_u64(wire)
    assert packed is not None and 0 < packed < (1 << 48)
    assert unpack_sids_u64(packed) == wire
    assert pack_sids_u64([-1] * 6) is None

    with pytest.raises(ValueError, match="invalid wire SID"):
        wire_to_model_sids([0, 256, 0, 0, 0, 0])

    # CREAD-30 分桶确定性与均值重建检验
    assert dwell_ms_to_cread_bucket(0.0) == 0
    assert dwell_ms_to_cread_bucket(400_000.0) == 29
    uniform_probs = [1.0 / 30.0] * 30
    assert cread_probs_to_expected_sec(uniform_probs) > 10.0

    # Embedding Contract 必须严格 8 键对齐 Node semanticEmbeddingContracts.ts
    u_contract = build_v3_user_embedding_contract()
    p_contract = build_v3_post_embedding_contract()
    assert is_trusted_semantic_embedding_contract(u_contract)
    assert is_trusted_semantic_embedding_contract(p_contract)
    assert not is_trusted_semantic_embedding_contract({**u_contract, "producer": "unverified-external-producer"})


def test_v3_onnx_serving_end_to_end_and_manifest_fail_closed(tmp_path: Path) -> None:
    """用真实 .onnx 图 + FAISS 索引 + ManifestV3 跑通 /health, /ready, /v3/sid/encode, /v3/ann/retrieve, /v3/phoenix/predict。"""
    models_dir = tmp_path / "models"
    data_dir = tmp_path / "data"
    models_dir.mkdir()
    data_dir.mkdir()

    emb_dim = 16
    text_onnx = models_dir / "text_encoder_int8.onnx"
    tt_onnx = models_dir / "two_tower_user_int8.onnx"
    phx_onnx = models_dir / "phoenix_v3_student_int8.onnx"
    _build_toy_text_encoder_onnx(text_onnx, emb_dim=emb_dim)
    _build_toy_two_tower_onnx(tt_onnx, emb_dim=emb_dim)
    _build_toy_phoenix_v3_onnx(phx_onnx)

    # 验证 FP32 vs INT8 数值 parity 检测器可真跑通
    parity_ok = validate_fp32_int8_parity(
        text_onnx,
        text_onnx,
        {
            "input_ids": np.array([[101, 210, 220, 102]], dtype=np.int64),
            "attention_mask": np.array([[1, 1, 1, 1]], dtype=np.int64),
        },
    )
    assert parity_ok.passed is True
    assert parity_ok.mean_cosine_similarity == pytest.approx(1.0, rel=1e-5)

    # 写入 6x256 SID 随机码本 (.npz 轻量格式) 与 FAISS 索引
    rng = np.random.default_rng(123)
    codebooks = rng.normal(0.0, 0.2, size=(6, 256, emb_dim)).astype(np.float32)
    np.savez(models_dir / "sid_codebook.npz", codebooks=codebooks)

    item_vecs = rng.normal(0.0, 1.0, size=(5, emb_dim)).astype(np.float32)
    item_vecs /= np.linalg.norm(item_vecs, axis=1, keepdims=True)
    index = faiss.IndexFlatIP(emb_dim)
    index.add(item_vecs)
    faiss.write_index(index, str(models_dir / "faiss_flat.index"))
    id_map = {str(i): f"{i + 1:024x}" for i in range(5)}
    (models_dir / "faiss_id_mapping.json").write_text(json.dumps({"idx_to_post_id": id_map}), encoding="utf-8")

    manifest = build_serving_manifest_v3(
        version="2026-11-15_v3test",
        models_dir=models_dir,
        data_dir=data_dir,
        embedding_dim=emb_dim,
        faiss_index_type="flat",
        extra_artifacts={"sid_codebook.npz": models_dir / "sid_codebook.npz"},
    )
    (data_dir / "serving_manifest_v3.json").write_text(json.dumps(manifest), encoding="utf-8")

    cfg = ServingConfig(
        data_dir=data_dir,
        models_dir=models_dir,
        artifact_version="2026-11-15_v3test",
        faiss_index_type="flat",
        embedding_dim=emb_dim,
        preload_on_startup=True,
        verify_artifact_checksums=True,
        require_onnx_artifacts=True,
    )
    app = create_serving_app(cfg)

    with TestClient(app) as client:
        h = client.get("/health")
        assert h.status_code == 200
        hb = h.json()
        assert hb["runtime_engine"] == "onnxruntime_int8"
        assert hb["manifest_verified"] is True
        assert set(hb["loaded_sessions"]) == {"phoenix_v3_student", "text_encoder", "two_tower_user"}
        assert client.get("/ready").status_code == 200

        sid_resp = client.post(
            "/v3/sid/encode",
            json={"items": [{"postId": "p_100", "content": "Hello Rust and Python V3 recommender"}]},
        )
        assert sid_resp.status_code == 200
        sid_item = sid_resp.json()["results"][0]
        assert len(sid_item["semanticIds"]) == 6
        assert all(0 <= code < 256 for code in sid_item["semanticIds"])
        assert sid_item["semanticIdsU64"] == pack_sids_u64(sid_item["semanticIds"])
        assert len(sid_item["embedding256d"]) == emb_dim
        assert is_trusted_semantic_embedding_contract(sid_item["embeddingContract"])

        ann_resp = client.post(
            "/v3/ann/retrieve",
            json={
                "userId": "u_9",
                "columnarRetrievalSequence": [
                    {
                        "postIdHash": 1001,
                        "authorHash": 2001,
                        "actionType": 2,
                        "semanticIds": sid_item["semanticIds"],
                        "actionMask": [1] * 13,
                        "timeDeltaSec": 15.0,
                    }
                ],
                "topK": 3,
            },
        )
        assert ann_resp.status_code == 200
        ann_body = ann_resp.json()
        assert len(ann_body["candidates"]) == 3
        assert ann_body["evidence"]["idNamespace"] == "mongo_object_id"

        phx_resp = client.post(
            "/v3/phoenix/predict",
            json={
                "userId": "u_9",
                "candidates": [
                    {"postId": f"{1:024x}", "inNetwork": True, "semanticIds": sid_item["semanticIds"]},
                    {"postId": f"{2:024x}", "inNetwork": False, "semanticIds": [-1] * 6},
                ],
            },
        )
        assert phx_resp.status_code == 200
        preds = phx_resp.json()["predictions"]
        assert len(preds) == 2
        assert len(preds[0]["dwellProbs"]) == 30
        assert preds[0]["expectedDwellSec"] > 0.0

    # Fail-closed check: 篡改 .onnx 文件或混入违禁 .pt 后必须阻断加载
    phx_onnx.write_bytes(b"corrupted-onnx-bytes")
    with pytest.raises(RuntimeError, match="SHA-256 verification failed"):
        create_serving_app(cfg).state.serving_state.load_v3_artifacts()

    ok, errs = verify_manifest_checksums(manifest, {"legacy.pt": models_dir / "text_encoder_int8.onnx"}, strict=True, require_onnx_models=True)
    assert ok is False and any("forbidden_pytorch_weights" in e for e in errs)
