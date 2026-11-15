"""Phase 28B 回归与契约测试：6x256 RQ-VAE 码本、死码复活、SidEntityEmbedder、MoL 双塔、HNSW-SQ8 与 ONNX INT8 Parity Gate。"""

from __future__ import annotations

from pathlib import Path

import faiss
import numpy as np
import pytest
import torch

from src.contracts.sid import wire_to_model_sids
from src.models.rq_vae_sid import (
    SidEntityEmbedder,
    evaluate_rqvae_codebook,
    load_rqvae_artifact,
    save_rqvae_npz,
    save_rqvae_safetensors,
    train_distilled_text_encoder,
    train_rq_kmeans,
    train_rqvae_codebook,
)
from src.models.two_tower_v3 import TwoTowerV3Config, TwoTowerV3Model, UserTowerV3
from src.offline_export.export_onnx_int8 import (
    export_text_encoder_v3_onnx_int8,
    export_two_tower_user_v3_onnx_int8,
)
from src.onnx_runtime.text_encoder_ort import SidCodebookQuantizer
from src.training.checkpoint_manager import CheckpointManager, OomSafeBatchController
from src.training.two_tower_v3_trainer import (
    build_faiss_hnsw_sq8_index,
    compute_two_tower_v3_loss,
    prepare_two_tower_split,
    run_ablation_two_tower_mol,
    train_two_tower_v3,
)


def _make_clustered_embeddings(n: int = 120, dim: int = 64, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    centers = rng.normal(0.0, 1.0, size=(8, dim)).astype(np.float32)
    assign = rng.integers(0, 8, size=n)
    vecs = centers[assign] + rng.normal(0.0, 0.12, size=(n, dim)).astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12
    return vecs


def test_rqvae_dead_code_revival_safetensors_and_sid_quantizer_roundtrip(tmp_path: Path) -> None:
    """验证 N < 256 小样本不崩溃、死码复活、safetensors/npz 落盘与 SidEntityEmbedder 掩码行为。"""
    embeddings = _make_clustered_embeddings(n=96, dim=64, seed=42)
    stages, codes = train_rq_kmeans(embeddings, iters=6, seed=42)
    assert stages.shape == (6, 256, 64)
    assert codes.shape == (96, 6)
    assert np.all((codes >= 0) & (codes < 256))

    artifact, metrics = train_rqvae_codebook(
        embeddings,
        hidden_dim=64,
        latent_dim=32,
        epochs=12,
        batch_size=32,
        seed=42,
        device="cpu",
    )
    assert artifact.stages.shape == (6, 256, 32)
    assert metrics["recon_cosine"] > 0.70
    assert len(metrics["per_level_utilization"]) == 6
    assert metrics["mean_utilization"] > 0.02

    # 显式验证死码复活机制：将 Level-0 前 3 个码本置零、计数置零后执行一步前向，应被高残差样本复活
    from src.models.rq_vae_sid import _RqVaePyTorchNet

    revive_net = _RqVaePyTorchNet(input_dim=32, hidden_dim=32, latent_dim=32)
    revive_net.train()
    revive_net.cluster_size[0, :3] = 0.0
    revive_net.stages[0, :3] = 0.0
    revive_net.forward_quantize(torch.randn(16, 32), update_ema=True, dead_code_threshold=0.5)
    assert torch.norm(revive_net.stages[0, :3]).item() > 0.0
    assert torch.all(revive_net.cluster_size[0, :3] >= 0.5)

    st_path = tmp_path / "sid_codebook.safetensors"
    npz_path = tmp_path / "sid_codebook.npz"
    save_rqvae_safetensors(artifact, st_path)
    save_rqvae_npz(artifact, npz_path)

    loaded_st = load_rqvae_artifact(st_path)
    assert loaded_st.enc_params is not None and loaded_st.dec_params is not None

    q_st = SidCodebookQuantizer.from_npz_or_json(st_path)
    q_npz = SidCodebookQuantizer.from_npz_or_json(npz_path)
    wire_a, recon_a = q_st.encode_vector(embeddings[0])
    wire_b, recon_b = q_npz.encode_vector(embeddings[0])
    assert wire_a == wire_b
    assert np.allclose(recon_a, recon_b, atol=1e-5)

    # 通过 1-indexed SID 重建时，全 0 PAD 行必须严格归零，非零行非零
    embedder = SidEntityEmbedder(out_dim=48, artifact=artifact)
    valid_model_sid = wire_to_model_sids(wire_a)
    sid_batch = torch.tensor([valid_model_sid, [0, 0, 0, 0, 0, 0]], dtype=torch.long)
    out_emb = embedder(sid_batch)
    assert out_emb.shape == (2, 48)
    assert torch.allclose(out_emb[1], torch.zeros(48), atol=1e-6)
    assert torch.norm(out_emb[0]).item() > 0.1

    eval_again = evaluate_rqvae_codebook(loaded_st, embeddings)
    assert eval_again["recon_cosine"] == pytest.approx(metrics["recon_cosine"], rel=1e-4)


def test_distilled_text_encoder_v3_and_onnx_int8_parity(tmp_path: Path) -> None:
    """验证学生文本编码器拟合教师语义表征并通过 FP32 -> INT8 ONNX Parity Gate。"""
    rng = np.random.default_rng(13)
    texts = [f"topic_{i % 6} rust distributed vector search post {i}" for i in range(48)]
    topic_anchors = rng.normal(0.0, 1.0, size=(6, 64)).astype(np.float32)
    teacher_embs = np.stack(
        [topic_anchors[i % 6] + rng.normal(0.0, 0.05, size=64).astype(np.float32) for i in range(48)],
        axis=0,
    )

    model, metrics = train_distilled_text_encoder(
        texts,
        teacher_embs,
        hidden_dim=64,
        embedding_dim=64,
        max_length=32,
        num_layers=1,
        epochs=18,
        batch_size=16,
        lr=4e-3,
        device="cpu",
    )
    assert metrics["distill_cosine"] > 0.75

    export_res = export_text_encoder_v3_onnx_int8(model, tmp_path, seq_len=32, min_cosine=0.98, max_mae=0.03)
    assert export_res.passed is True
    assert export_res.fp32_path.exists() and export_res.int8_path.exists()
    assert export_res.int8_size_bytes <= export_res.fp32_size_bytes


def test_two_tower_v3_forbids_user_id_and_exports_mol_hnsw_sq8_ablation(tmp_path: Path) -> None:
    """覆盖无 User ID 强制断言、假负例屏蔽 + Log-Q + MoL ONNX INT8、HNSW-SQ8 建库与 Ablation ②。"""
    with pytest.raises(ValueError, match="use_user_embedding"):
        TwoTowerV3Config(use_user_embedding=True)

    cfg = TwoTowerV3Config(
        hidden_dim=32,
        embedding_dim=32,
        num_layers=2,
        num_heads=4,
        num_kv_heads=2,
        mol_num_heads=4,
        max_history_len=16,
        post_hash_buckets=512,
        author_hash_buckets=256,
    )
    user_tower = UserTowerV3(cfg)
    assert not any("user_id" in name.lower() for name, _ in user_tower.named_parameters())

    # 校验 False-Negative 屏蔽确实降低假负交叉熵损失，且 Log-Q 流行度纠偏数值稳定
    u_vecs = torch.nn.functional.normalize(torch.randn(4, 4, 32), dim=-1)
    logits = torch.eye(4) * 2.0 + 0.5
    loss_plain = compute_two_tower_v3_loss(
        logits,
        pos_post_hashes=torch.tensor([10, 10, 20, 30]),
        cand_log_q=torch.tensor([-0.5, -0.5, -2.0, -3.0]),
        sample_weights=torch.tensor([2.0, 1.0, 1.0, 1.0]),
        user_vecs=u_vecs,
        mask_in_batch_false_negatives=False,
        apply_log_q_correction=False,
    )
    loss_masked = compute_two_tower_v3_loss(
        logits,
        pos_post_hashes=torch.tensor([10, 10, 20, 30]),
        cand_log_q=torch.tensor([-0.5, -0.5, -2.0, -3.0]),
        sample_weights=torch.tensor([2.0, 1.0, 1.0, 1.0]),
        user_vecs=u_vecs,
        mask_in_batch_false_negatives=True,
        apply_log_q_correction=False,
    )
    loss_corrected = compute_two_tower_v3_loss(
        logits,
        pos_post_hashes=torch.tensor([10, 10, 20, 30]),
        cand_log_q=torch.tensor([-0.5, -0.5, -2.0, -3.0]),
        sample_weights=torch.tensor([2.0, 1.0, 1.0, 1.0]),
        user_vecs=u_vecs,
        mask_in_batch_false_negatives=True,
        apply_log_q_correction=True,
    )
    assert torch.isfinite(loss_corrected)
    assert float(loss_masked.item()) < float(loss_plain.item())
    assert float(loss_corrected.item()) != float(loss_masked.item())

    # 构造带真实主题聚类的序列双塔数据验证训练、ONNX INT8、HNSW-SQ8 与 Ablation ②
    rng = np.random.default_rng(99)
    corpus_posts = []
    post_text_map = {}
    post_sid_map = {}
    for p_idx in range(24):
        pid = f"{p_idx + 1:024x}"
        cluster = p_idx % 4
        emb = np.zeros(32, dtype=np.float32)
        emb[cluster * 6 : (cluster + 1) * 6] = 1.0
        emb += rng.normal(0.0, 0.05, size=32).astype(np.float32)
        emb /= np.linalg.norm(emb) + 1e-12
        corpus_posts.append(
            {
                "post_id": pid,
                "author_hash": f"a_{cluster}",
                "has_video": p_idx % 2,
                "semantic_ids": [cluster, (p_idx * 7) % 256, 1, 2, 3, 4],
            }
        )
        post_text_map[pid] = emb
        post_sid_map[pid] = [cluster, (p_idx * 7) % 256, 1, 2, 3, 4]

    samples = []
    for s_idx in range(60):
        cluster = s_idx % 4
        target_pid = f"{(cluster + 4 * (s_idx % 5)) + 1:024x}"
        hist_pid = f"{(cluster + 4 * ((s_idx + 1) % 5)) + 1:024x}"
        samples.append(
            {
                "history_post_ids": [hist_pid],
                "history_author_hashes": [f"a_{cluster}"],
                "history_action_types": [2],
                "history_time_buckets": [1],
                "history_sids": [post_sid_map[hist_pid]],
                "candidate_post_id": target_pid,
                "candidate_author_hash": f"a_{cluster}",
                "candidate_in_network": 1,
                "candidate_has_video": 0,
                "candidate_sids": post_sid_map[target_pid],
                "action_labels": [1, 1] + [0] * 11,
                "action_mask": [1] * 13,
                "dwell_ms": 12_000.0,
                "dwell_mask": 1,
            }
        )

    train_split = prepare_two_tower_split(
        samples[:44], max_seq_len=16, text_dim=32, post_sid_wire_map=post_sid_map, post_text_emb_map=post_text_map
    )
    val_split = prepare_two_tower_split(
        samples[44:], max_seq_len=16, text_dim=32, post_sid_wire_map=post_sid_map, post_text_emb_map=post_text_map
    )

    ckpt_dir = tmp_path / "ckpts"
    ckpt_mgr = CheckpointManager(ckpt_dir, max_keep=2, prefix="tt_v3")
    trained_model, train_res = train_two_tower_v3(
        train_split,
        val_split=val_split,
        corpus_posts=corpus_posts,
        post_sid_wire_map=post_sid_map,
        post_text_emb_map=post_text_map,
        config=cfg,
        epochs=6,
        batch_size=16,
        checkpoint_manager=ckpt_mgr,
        device="cpu",
    )
    assert len(train_res["loss_history"]) == 6
    assert (ckpt_dir / "tt_v3_latest.pt").exists()

    # 校验断点续训恢复不会报错
    model_reloaded = TwoTowerV3Model(cfg, text_input_dim=32)
    resumed = ckpt_mgr.resume_latest(model_reloaded)
    assert resumed is not None and resumed["epoch"] == 6

    # 导出 two_tower_user_int8.onnx 并过 Parity Gate
    onnx_dir = tmp_path / "models"
    tt_export = export_two_tower_user_v3_onnx_int8(
        trained_model.user_tower,
        onnx_dir,
        max_seq_len=16,
        min_cosine=0.98,
        max_mae=0.03,
    )
    assert tt_export.passed is True

    # 构建并检索 FAISS IndexHNSWSQ(QT_8bit)
    from src.training.two_tower_v3_trainer import encode_corpus_candidates

    c_vecs, c_pids = encode_corpus_candidates(
        trained_model,
        corpus_posts,
        text_dim=32,
        post_sid_wire_map=post_sid_map,
        post_text_emb_map=post_text_map,
        device=torch.device("cpu"),
    )
    idx_path, map_path = build_faiss_hnsw_sq8_index(c_vecs, c_pids, onnx_dir, hnsw_m=8)
    assert idx_path.exists() and map_path.exists()
    loaded_idx = faiss.read_index(str(idx_path))
    assert loaded_idx.ntotal == len(corpus_posts)

    # 运行 Ablation ② 对比报告
    ablation = run_ablation_two_tower_mol(
        train_split,
        val_split,
        corpus_posts,
        post_sid_wire_map=post_sid_map,
        post_text_emb_map=post_text_map,
        base_config=cfg,
        epochs=4,
        batch_size=16,
        device="cpu",
    )
    assert "baseline_single_head" in ablation and "v3_mol_k4" in ablation


def test_oom_safe_batch_controller_scales_batch_and_grad_accum() -> None:
    """验证模拟 CUDA OOM 时批大小减半且梯度累积翻倍维持等效批大小。"""
    ctrl = OomSafeBatchController(initial_batch_size=64, min_batch_size=8, initial_grad_accum=1)
    attempts = []

    def _flaky_step(micro_bs: int, accum: int) -> str:
        attempts.append((micro_bs, accum))
        if micro_bs > 16:
            raise RuntimeError("CUDA out of memory. Tried to allocate 256.00 MiB")
        return "ok"

    out = ctrl.run_step_with_backoff(_flaky_step)
    assert out == "ok"
    assert attempts == [(64, 1), (32, 2), (16, 4)]
    assert ctrl.oom_events == 2
    assert ctrl.effective_batch_size == 64
