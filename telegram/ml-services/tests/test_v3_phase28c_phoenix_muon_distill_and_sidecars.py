"""Phase 28C 全栈验证：Phoenix V3 精排隔离与 PAL、Muon、PL/DE-RRD 蒸馏、EB 校准侧车与真实 Parquet 端到端 Serving。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from fastapi.testclient import TestClient
import numpy as np
import pytest
import torch

from src.contracts.actions import CREAD_NUM_BINS, V3_PREDICTION_HEADS
from src.contracts.sid import SID_NUM_LEVELS
from src.models.phoenix_v3 import PhoenixV3Config, PhoenixV3Model
from src.serving.config import ServingConfig
from src.serving.main import create_serving_app
from src.training.ablation_runner import (
    build_complete_v3_serving_bundle,
    build_stage3b_finetune_slates,
    load_v3_parquet_corpus_and_samples,
    run_ablation_1_sid_text,
    run_ablation_3_phoenix_loss_and_distill,
    run_ablation_4_muon_vs_adamw,
    run_ablation_5_calibration_and_sidecars,
)
from src.training.calibration_eb import (
    fit_empirical_bayes_calibrator,
    fit_pit_user_debias_udb1,
    optimize_value_model_weights_lbfgsb,
)
from src.training.e5_teacher_encoder import (
    align_and_blend_multimodal_embeddings,
    project_embeddings_orthogonal,
)
from src.training.muon_adamw import (
    ModelEMA,
    MuonAdamW,
    clip_grad_norm_partitioned,
    compute_v3_early_stop_metric,
    orthogonalize_muon_update,
    zeropower_via_newtonschulz5,
)
from src.training.pl_derd_distill import (
    compute_cread30_loss,
    compute_de_rrd_distill_loss,
    compute_masked_14head_bce,
    compute_plackett_luce_loss,
    compute_scalar_rank_utility,
    concat_phoenix_slates,
    prepare_phoenix_v3_slates,
)
from src.training.realgraph_v3 import (
    REALGRAPH_V3_FEATURES,
    SnapshotSafeguard,
    compute_local_pagerank_author_cred,
    train_realgraph_v3_gbt,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
PROD_V3_DATASET_DIR = REPO_ROOT / "data" / "prod_pit_v3"


def _make_dummy_phoenix_inputs(
    *,
    batch_size: int = 2,
    hist_len: int = 8,
    cand_len: int = 4,
    seed: int = 7,
) -> Dict[str, torch.Tensor]:
    rng = np.random.default_rng(seed)
    return {
        "history_post_hashes": torch.from_numpy(rng.integers(1, 500, size=(batch_size, hist_len), dtype=np.int64)),
        "history_author_hashes": torch.from_numpy(rng.integers(1, 200, size=(batch_size, hist_len), dtype=np.int64)),
        "history_action_types": torch.from_numpy(rng.integers(1, 13, size=(batch_size, hist_len), dtype=np.int64)),
        "history_time_buckets": torch.from_numpy(rng.integers(0, 16, size=(batch_size, hist_len), dtype=np.int64)),
        "history_sids": torch.from_numpy(rng.integers(0, 257, size=(batch_size, hist_len, SID_NUM_LEVELS), dtype=np.int64)),
        "history_action_masks": torch.ones((batch_size, hist_len, 13), dtype=torch.float32),
        "history_mask": torch.ones((batch_size, hist_len), dtype=torch.int64),
        "cand_post_hashes": torch.from_numpy(rng.integers(1, 500, size=(batch_size, cand_len), dtype=np.int64)),
        "cand_author_hashes": torch.from_numpy(rng.integers(1, 200, size=(batch_size, cand_len), dtype=np.int64)),
        "cand_sids": torch.from_numpy(rng.integers(0, 257, size=(batch_size, cand_len, SID_NUM_LEVELS), dtype=np.int64)),
        "cand_in_network": torch.from_numpy(rng.integers(0, 2, size=(batch_size, cand_len), dtype=np.int64)),
        "cand_has_video": torch.from_numpy(rng.integers(0, 2, size=(batch_size, cand_len), dtype=np.int64)),
        "cand_served_position": torch.zeros((batch_size, cand_len), dtype=torch.int64),
        "cand_mask": torch.ones((batch_size, cand_len), dtype=torch.int64),
    }


def _make_synthetic_slate_rows(*, num_slates: int = 12, cands_per_slate: int = 4, seed: int = 123) -> List[Dict[str, Any]]:
    rng = np.random.default_rng(seed)
    rows: List[Dict[str, Any]] = []
    for s_idx in range(num_slates):
        split = "train" if s_idx < int(num_slates * 0.75) else "val"
        uid = f"user_{s_idx % 4}"
        base_ts = 1_700_000_000_000 + s_idx * 1_000_000
        hist_pids = [f"post_{(s_idx * 3 + k) % 10}" for k in range(6)]
        hist_auths = ["author_0", "author_0", "author_1", f"author_{(s_idx + 1) % 3}", "author_2", "author_0"]
        # 让相同 SID 前缀与偶数为高价值相关帖，检验模型与消融是否能学到真实信号
        for c_idx in range(cands_per_slate):
            is_pos = c_idx == 0 or (c_idx == 1 and rng.random() > 0.4)
            is_neg = (not is_pos) and (c_idx == cands_per_slate - 1)
            cpid = f"post_{(s_idx * 5 + c_idx) % 24}"
            sid_prefix = 12 if is_pos else (88 if is_neg else 40)
            cand_sids = [sid_prefix, (sid_prefix + c_idx) % 256, 3, 7, 11, 15]
            labels = [0] * 13
            if is_pos:
                labels[0] = 1  # click
                labels[1] = 1  # like
                labels[6] = 1  # dwell
            elif is_neg:
                labels[9] = 1  # not_interested
            masks = [1] * 13
            # 显式随机掩码部分尾部头，测试 action_mask 严格忽略未观测头
            if c_idx % 2 == 1:
                masks[12] = 0
                labels[12] = 1
            rows.append(
                {
                    "sample_id": f"s_{s_idx}_{c_idx}",
                    "source_dataset": "synthetic_v3",
                    "split": split,
                    "user_hash_id": uid,
                    "action_ts_ms": base_ts + c_idx * 100,
                    "history_post_ids": hist_pids,
                    "history_author_hashes": hist_auths,
                    "history_action_types": [2, 1, 7, 2, 4, 1],
                    "history_time_buckets": [0, 1, 2, 3, 4, 5],
                    "history_sids": [[sid_prefix, 1, 2, 3, 4, 5]] * 6,
                    "candidate_post_id": cpid,
                    "candidate_author_hash": f"author_{0 if is_pos else c_idx + 1}",
                    "candidate_in_network": 1 if is_pos else 0,
                    "candidate_has_video": 1 if c_idx % 2 == 0 else 0,
                    "candidate_duration_ms": 18000 if c_idx % 2 == 0 else 0,
                    "candidate_sids": cand_sids,
                    "served_position": c_idx,
                    "action_labels": labels,
                    "action_mask": masks,
                    "video_quality_view_label": 1 if (is_pos and c_idx % 2 == 0) else 0,
                    "video_quality_view_mask": 1 if c_idx % 2 == 0 else 0,
                    "dwell_ms": 22000.0 if is_pos else (800.0 if is_neg else 4000.0),
                    "dwell_mask": 1,
                    "is_random_exposure": 1 if c_idx == 2 else 0,
                }
            )
    return rows


def test_phoenix_v3_candidate_isolation_and_pal_zeroing() -> None:
    torch.manual_seed(42)
    cfg = PhoenixV3Config(
        dim=32,
        num_layers=3,
        num_cand_only_layers=1,
        num_heads=4,
        num_kv_heads=2,
        max_history_len=8,
        max_candidates=4,
        dropout=0.0,
        post_hash_buckets=512,
        author_hash_buckets=256,
    )
    model = PhoenixV3Model(cfg)
    model.eval()

    inputs_a = _make_dummy_phoenix_inputs(batch_size=2, hist_len=8, cand_len=4, seed=11)
    inputs_b = {k: v.clone() for k, v in inputs_a.items()}
    # 仅大幅篡改第 1 号候选的所有特征
    inputs_b["cand_post_hashes"][:, 1] = 499
    inputs_b["cand_author_hashes"][:, 1] = 250
    inputs_b["cand_sids"][:, 1, :] = 199
    inputs_b["cand_in_network"][:, 1] = 1 - inputs_b["cand_in_network"][:, 1]
    inputs_b["cand_served_position"][:, 1] = 15

    act_a, cread_a = model(**inputs_a)
    act_b, cread_b = model(**inputs_b)
    assert act_a.shape == (2, 4, 14)
    assert cread_a.shape == (2, 4, CREAD_NUM_BINS)

    # 非第 1 号候选的 logits 与 cread 分布必须逐元素严格不变（彻底阻止候选间信息泄漏）
    for keep_idx in (0, 2, 3):
        assert torch.allclose(act_a[:, keep_idx, :], act_b[:, keep_idx, :], atol=1e-6)
        assert torch.allclose(cread_a[:, keep_idx, :], cread_b[:, keep_idx, :], atol=1e-6)

    # 校验反向传播梯度隔离：只对候选 0 算标量损失，篡改候选 1 后候选 0 对应的参数梯度应一致
    model.zero_grad()
    loss_a = act_a[:, 0, :].sum() + cread_a[:, 0, :].sum()
    loss_a.backward()
    grads_a = {n: p.grad.detach().clone() for n, p in model.named_parameters() if p.grad is not None}

    model.zero_grad()
    act_b2, cread_b2 = model(**inputs_b)
    loss_b = act_b2[:, 0, :].sum() + cread_b2[:, 0, :].sum()
    loss_b.backward()
    for n, g_a in grads_a.items():
        g_b = model.get_parameter(n).grad
        assert g_b is not None
        assert torch.allclose(g_a, g_b, atol=1e-5), f"candidate leakage detected in gradient of {n}"

    # 校验 PAL 推理置零约束：cand_served_position == 0 时与 apply_pal=False 严格一致；>0 时施加偏置
    with torch.no_grad():
        model.pal_bias.pos_action_bias.weight[1:].fill_(0.5)
        model.pal_bias.pos_cread_bias.weight[1:].fill_(0.25)
    out_zero_pal = model.forward_with_details(**inputs_a, apply_pal=True)
    out_no_pal = model.forward_with_details(**inputs_a, apply_pal=False)
    assert torch.allclose(out_zero_pal["action_logits"], out_no_pal["action_logits"], atol=1e-7)
    assert torch.allclose(out_zero_pal["cread_logits"], out_no_pal["cread_logits"], atol=1e-7)

    pos_inputs = {k: v.clone() for k, v in inputs_a.items()}
    pos_inputs["cand_served_position"][:, :] = 2
    out_pos_pal = model.forward_with_details(**pos_inputs, apply_pal=True)
    assert torch.allclose(out_pos_pal["action_logits"] - out_no_pal["action_logits"], torch.tensor(0.5), atol=1e-5)


def test_muon_newton_schulz_qkv_partition_ema_and_early_stop() -> None:
    torch.manual_seed(99)
    mat = torch.randn(16, 32)
    q_mat = zeropower_via_newtonschulz5(mat, steps=5)
    assert q_mat.shape == mat.shape
    assert torch.isfinite(q_mat).all()
    gram = q_mat @ q_mat.t()
    assert torch.allclose(gram, torch.eye(16), atol=0.35)

    # 检验 QKV 分块正交等价于按 dim=0 三等分独立正交化 + consistent RMS 缩放
    fused_qkv = torch.randn(3 * 24, 24)
    out_fused = orthogonalize_muon_update(fused_qkv, is_fused_qkv=True, ns_steps=5, rms_scale=0.2)
    chunks = torch.split(fused_qkv, 24, dim=0)
    expected = torch.cat([orthogonalize_muon_update(c, is_fused_qkv=False, ns_steps=5, rms_scale=0.2) for c in chunks], dim=0)
    assert torch.allclose(out_fused, expected, atol=1e-5)

    cfg = PhoenixV3Config(dim=32, num_layers=2, num_cand_only_layers=1, num_heads=4, num_kv_heads=2, max_history_len=8, max_candidates=4)
    model = PhoenixV3Model(cfg)
    opt = MuonAdamW.from_model(model, lr=1e-3, muon_lr_multiplier=10.0)
    muon_groups = [g for g in opt.param_groups if g.get("use_muon")]
    adam_groups = [g for g in opt.param_groups if not g.get("use_muon")]
    assert muon_groups and adam_groups

    ema = ModelEMA(model, decay=0.9)
    inputs = _make_dummy_phoenix_inputs(batch_size=2, hist_len=8, cand_len=4, seed=5)
    act0, cread0 = model(**inputs)
    loss = (act0**2).mean() + 0.1 * (cread0**2).mean()
    loss.backward()
    stats = clip_grad_norm_partitioned(opt, max_norm=1.0)
    assert "muon_grad_norm" in stats and "adamw_grad_norm" in stats
    opt.step()
    ema.update(model)

    live_param = model.joint_layers[0].o_proj.weight.detach().clone()
    with ema.use_ema(model):
        ema_param = model.joint_layers[0].o_proj.weight.detach().clone()
        assert not torch.allclose(live_param, ema_param, atol=1e-9)
    assert torch.allclose(model.joint_layers[0].o_proj.weight.detach(), live_param, atol=1e-9)

    # 早停指标公式精准验算：0.7 * unbiased_macro_roc_auc + 0.3 * negative_auc
    rng = np.random.default_rng(7)
    n_eval = 40
    y_true = np.zeros((n_eval, 14), dtype=np.float32)
    masks = np.ones((n_eval, 14), dtype=np.float32)
    probs = np.full((n_eval, 14), 0.5, dtype=np.float32)
    is_rand = np.zeros(n_eval, dtype=np.int64)
    is_rand[:20] = 1
    for j in range(14):
        y_true[:, j] = (np.arange(n_eval) % 2 == 0).astype(np.float32)
        probs[:, j] = np.where(y_true[:, j] > 0.5, 0.8 + 0.05 * rng.random(n_eval), 0.2 + 0.05 * rng.random(n_eval))
    es = compute_v3_early_stop_metric(probs, y_true, masks, is_random_exposure=is_rand)
    assert abs(es["early_stop_score"] - (0.7 * es["unbiased_macro_roc_auc"] + 0.3 * es["negative_auc"])) < 1e-8
    assert es["unbiased_macro_roc_auc"] > 0.95


def test_masked_14head_bce_cread30_plackett_luce_and_derd() -> None:
    torch.manual_seed(17)
    # 1. 屏蔽位 action_mask=0 对 14 头损失及对应 logit 梯度严格零影响
    logits = torch.randn(2, 3, 14, requires_grad=True)
    labels_a = torch.randint(0, 2, (2, 3, 14)).float()
    labels_b = labels_a.clone()
    labels_b[:, :, 12] = 1.0 - labels_b[:, :, 12]
    mask = torch.ones((2, 3, 14))
    mask[:, :, 12] = 0.0
    cand_mask = torch.ones((2, 3), dtype=torch.int64)

    loss_a = compute_masked_14head_bce(logits, labels_a, mask, cand_mask)
    loss_a.backward()
    grad_a = logits.grad.detach().clone()
    assert torch.allclose(grad_a[:, :, 12], torch.zeros_like(grad_a[:, :, 12]), atol=1e-8)

    logits.grad.zero_()
    loss_b = compute_masked_14head_bce(logits, labels_b, mask, cand_mask)
    assert torch.allclose(loss_a.detach(), loss_b.detach(), atol=1e-7)

    # 2. CREAD-30 序数分布损失有限且仅作用于 dwell_mask == 1
    cread_logits = torch.randn(2, 3, CREAD_NUM_BINS, requires_grad=True)
    dwell_buckets = torch.tensor([[2, 10, 25], [0, 5, 19]], dtype=torch.int64)
    dwell_mask = torch.tensor([[1.0, 1.0, 0.0], [1.0, 0.0, 1.0]])
    c_loss = compute_cread30_loss(cread_logits, dwell_buckets, dwell_mask, cand_mask)
    assert torch.isfinite(c_loss) and float(c_loss) > 0.0
    c_loss.backward()
    assert torch.allclose(cread_logits.grad[0, 2], torch.zeros(CREAD_NUM_BINS), atol=1e-8)

    # 3. Plackett-Luce：正确序分数比逆序分数的列表损失严格更低
    rel = torch.tensor([[4.0, 2.0, 0.5, 0.0]], dtype=torch.float32)
    cm = torch.ones((1, 4), dtype=torch.int64)
    good_scores = torch.tensor([[5.0, 3.0, 1.0, -2.0]], dtype=torch.float32)
    bad_scores = torch.tensor([[-2.0, 1.0, 3.0, 5.0]], dtype=torch.float32)
    pl_good = compute_plackett_luce_loss(good_scores, rel, cm)
    pl_bad = compute_plackett_luce_loss(bad_scores, rel, cm)
    assert float(pl_good) < float(pl_bad)

    # 4. DE-RRD 蒸馏：Student 对齐 Teacher 时蒸馏损失更低且可导
    t_act = torch.randn(2, 4, 14)
    t_cread = torch.randn(2, 4, CREAD_NUM_BINS)
    t_sc = compute_scalar_rank_utility(t_act, t_cread)

    s_act_close = (t_act + 0.01 * torch.randn_like(t_act)).requires_grad_(True)
    s_cread_close = (t_cread + 0.01 * torch.randn_like(t_cread)).requires_grad_(True)
    s_sc_close = compute_scalar_rank_utility(s_act_close, s_cread_close)
    d_close = compute_de_rrd_distill_loss(
        student_action_logits=s_act_close,
        student_cread_logits=s_cread_close,
        teacher_action_logits=t_act,
        teacher_cread_logits=t_cread,
        student_scores=s_sc_close,
        teacher_scores=t_sc,
        cand_mask=torch.ones((2, 4), dtype=torch.int64),
        mask_14=torch.ones((2, 4, 14)),
    )

    s_act_far = (-t_act).requires_grad_(True)
    s_cread_far = (-t_cread).requires_grad_(True)
    s_sc_far = compute_scalar_rank_utility(s_act_far, s_cread_far)
    d_far = compute_de_rrd_distill_loss(
        student_action_logits=s_act_far,
        student_cread_logits=s_cread_far,
        teacher_action_logits=t_act,
        teacher_cread_logits=t_cread,
        student_scores=s_sc_far,
        teacher_scores=t_sc,
        cand_mask=torch.ones((2, 4), dtype=torch.int64),
        mask_14=torch.ones((2, 4, 14)),
    )
    assert torch.isfinite(d_close) and float(d_close) < float(d_far)
    d_close.backward()
    assert s_act_close.grad is not None


def test_eb_calibrator_lbfgsb_pit_udb1_and_realgraph_v3_safeguard(tmp_path: Path) -> None:
    rng = np.random.default_rng(2026)
    n_samples = 160
    probs = rng.uniform(0.05, 0.95, size=(n_samples, 14))
    # 人工引入系统过置信偏差，检验 EB Platt 是否能改善校准误差
    true_p = 1.0 / (1.0 + np.exp(-(0.6 * np.log(probs / (1.0 - probs)) - 0.8)))
    labels = (rng.random(size=(n_samples, 14)) < true_p).astype(np.float64)
    masks = np.ones((n_samples, 14), dtype=np.float64)

    cal = fit_empirical_bayes_calibrator(probs, labels, masks, models_dir=tmp_path)
    assert cal["meanEceAfter"] <= cal["meanEceBefore"] + 1e-6
    assert (tmp_path / "weighted_calibrator_v3.json").exists()
    for head in V3_PREDICTION_HEADS:
        entry = cal["actions"][head]
        assert {"count", "scale", "bias"}.issubset(entry.keys())

    # L-BFGS-B 框约束检验：正向 >= 0，负向 <= -0.5，dwell_time >= 0
    expected_dwell = rng.uniform(0.5, 30.0, size=n_samples)
    rel_target = 2.0 * labels[:, 1] - 4.0 * labels[:, 9] + 0.1 * np.log1p(expected_dwell)
    val_art = optimize_value_model_weights_lbfgsb(probs, expected_dwell, rel_target, models_dir=tmp_path)
    w = val_art["weights"]
    assert w["like"] >= 0.0 and w["click"] >= 0.0 and w["dwell_time"] >= 0.0
    for neg_h in ("not_interested", "block_author", "mute_author", "report"):
        assert w[neg_h] <= -0.5

    # PIT UDB1 零未来泄漏检验：修改目标 action_labels 对 user_debias_v3.json 输出零影响
    samples_orig = _make_synthetic_slate_rows(num_slates=8, cands_per_slate=3, seed=55)
    samples_flipped = []
    for row in samples_orig:
        dup = dict(row)
        dup["action_labels"] = [1 - int(v) for v in row["action_labels"]]
        samples_flipped.append(dup)
    udb_a = fit_pit_user_debias_udb1(samples_orig, models_dir=tmp_path)
    udb_b = fit_pit_user_debias_udb1(samples_flipped)
    assert udb_a["logOddsOffsetByUser"] == udb_b["logOddsOffsetByUser"]

    # RealGraph V3：严格 16 维、禁止 dwellTimeMs、SnapshotSafeguard 阻断坏快照
    assert len(REALGRAPH_V3_FEATURES) == 16
    assert "dwellTimeMs" not in REALGRAPH_V3_FEATURES
    cred = compute_local_pagerank_author_cred(samples_orig)
    assert cred and all(0.0 <= v <= 1.0 for v in cred.values())
    assert max(cred.values()) == pytest.approx(1.0, abs=1e-6)
    assert cred["author_0"] >= cred["author_3"]

    rg = train_realgraph_v3_gbt(samples_orig, models_dir=tmp_path, min_samples_guard=4, min_auc_guard=0.45)
    assert len(rg["features"]) == 16
    assert (tmp_path / "realgraph_v3.json").exists()

    safeguard = SnapshotSafeguard(min_samples=10, min_auc=0.60)
    bad_leak = dict(rg, features=["dwellTimeMs"] + list(rg["features"])[:15])
    ok_leak, reasons_leak = safeguard.validate(bad_leak)
    assert not ok_leak and any("forbidden_leakage_features" in r for r in reasons_leak)

    bad_low = dict(rg, metrics={"samples": 3, "auc": 0.30})
    with pytest.raises(RuntimeError):
        safeguard.save_atomic(bad_low, tmp_path / "realgraph_v3.json")


def test_ablation_suite_1_3_4_5_smoke() -> None:
    rows = _make_synthetic_slate_rows(num_slates=16, cands_per_slate=4, seed=77)
    train_rows = [r for r in rows if r["split"] == "train"]
    val_rows = [r for r in rows if r["split"] == "val"]
    train_slates = prepare_phoenix_v3_slates(train_rows, max_history_len=8, max_candidates=4)
    val_slates = prepare_phoenix_v3_slates(val_rows, max_history_len=8, max_candidates=4)

    res1 = run_ablation_1_sid_text(train_slates, val_slates, dim=32, num_layers=2, epochs=2, batch_size=8, device="cpu")
    assert res1["ablation"] == "1_sid_text_vs_hash_only"
    assert np.isfinite(res1["delta_early_stop_score"])

    res3 = run_ablation_3_phoenix_loss_and_distill(
        train_slates, val_slates, teacher_dim=32, student_dim=16, epochs=2, batch_size=8, device="cpu"
    )
    assert res3["ablation"] == "3_pl_cread_derd_distill"
    assert np.isfinite(res3["delta_early_stop_score"])

    res4 = run_ablation_4_muon_vs_adamw(train_slates, val_slates, dim=32, epochs=2, batch_size=8, device="cpu")
    assert res4["ablation"] == "4_muon_vs_adamw"
    assert np.isfinite(res4["delta_loss"])

    n_val = 40
    rng = np.random.default_rng(19)
    probs = rng.uniform(0.1, 0.9, size=(n_val, 14))
    labels = (rng.random((n_val, 14)) < 0.3).astype(np.float64)
    masks = np.ones((n_val, 14), dtype=np.float64)
    res5 = run_ablation_5_calibration_and_sidecars(probs, labels, masks, rows)
    assert res5["realgraph_feature_count"] == 16
    assert np.isfinite(res5["calibrator_mean_ece_after"])


def test_real_prod_pit_v3_end_to_end_serving_pipeline(tmp_path: Path) -> None:
    if not PROD_V3_DATASET_DIR.exists():
        pytest.skip("prod_pit_v3 local dataset not present")

    posts_rows, samples_rows = load_v3_parquet_corpus_and_samples(PROD_V3_DATASET_DIR, max_samples=600)
    assert len(posts_rows) >= 100 and len(samples_rows) >= 200

    models_dir = tmp_path / "models"
    data_dir = tmp_path / "data"
    summary = build_complete_v3_serving_bundle(
        posts_rows=posts_rows,
        samples_rows=samples_rows,
        models_dir=models_dir,
        data_dir=data_dir,
        artifact_version="v3-e2e-regression-test",
        embedding_dim=128,
        text_epochs=2,
        rqvae_epochs=3,
        tt_epochs=2,
        teacher_epochs=1,
        student_epochs=2,
        batch_size=64,
        max_history_len=32,
        max_candidates=8,
        device="cpu",
    )

    # 严格校验在线目录零 .pt/.pth/.ckpt 残留，所有 V3 INT8 ONNX/Safetensors/FAISS/侧车齐全
    residual_pt = [p.name for p in models_dir.rglob("*") if p.suffix in (".pt", ".pth", ".ckpt")]
    assert not residual_pt, f"forbidden PyTorch checkpoint files in serving models_dir: {residual_pt}"
    for expected in (
        "sid_codebook.safetensors",
        "text_encoder_int8.onnx",
        "two_tower_user_int8.onnx",
        "phoenix_v3_student_int8.onnx",
        "weighted_calibrator_v3.json",
        "value_model_weights_v3.json",
        "user_debias_v3.json",
        "realgraph_v3.json",
    ):
        assert (models_dir / expected).exists(), f"missing serving artifact: {expected}"
    assert Path(summary["manifestPath"]).exists()

    cfg = ServingConfig(
        data_dir=data_dir,
        models_dir=models_dir,
        artifact_version="v3-e2e-regression-test",
        artifact_profile="phoenix-v3",
        faiss_index_type="hnsw_sq8",
        embedding_dim=128,
        max_history_len=32,
        max_candidates=8,
        verify_artifact_checksums=True,
        require_onnx_artifacts=True,
        preload_on_startup=True,
        allow_download_on_request=False,
    )
    app = create_serving_app(cfg)
    with TestClient(app) as client:
        r_health = client.get("/health")
        assert r_health.status_code == 200

        r_ready = client.get("/ready")
        assert r_ready.status_code == 200
        ready_json = r_ready.json()
        assert ready_json["ready"] is True
        assert ready_json["manifest_verified"] is True
        assert ready_json["models_loaded"] is True

        sample_post = posts_rows[0]
        r_sid = client.post(
            "/v3/sid/encode",
            json={
                "items": [
                    {
                        "postId": str(sample_post["post_id"]),
                        "title": str(sample_post.get("title") or ""),
                        "content": str(sample_post.get("content") or "telegram v3 smoke post"),
                        "keywords": list(sample_post.get("keywords") or []),
                    }
                ]
            },
        )
        assert r_sid.status_code == 200
        sid_res = r_sid.json()["results"][0]
        assert len(sid_res["semanticIds"]) == SID_NUM_LEVELS
        assert len(sid_res["embedding256d"]) == 128

        sample_row = samples_rows[0]
        hist_pids = [str(p) for p in (sample_row.get("history_post_ids") or [])[:8]]
        r_ann = client.post(
            "/v3/ann/retrieve",
            json={
                "userId": str(sample_row.get("user_hash_id") or "u_e2e"),
                "historyPostIds": hist_pids or [str(sample_post["post_id"])],
                "topK": 10,
            },
        )
        assert r_ann.status_code == 200
        ann_json = r_ann.json()
        assert len(ann_json["candidates"]) > 0
        assert ann_json["evidence"]["indexVersion"].startswith("hnsw_sq8")

        cand_items = [
            {
                "postId": str(posts_rows[i]["post_id"]),
                "authorId": str(posts_rows[i].get("author_hash") or f"auth_{i}"),
                "inNetwork": i == 0,
                "hasVideo": bool(posts_rows[i].get("has_video")),
                "semanticIds": sid_res["semanticIds"],
            }
            for i in range(4)
        ]
        r_rank = client.post(
            "/v3/phoenix/predict",
            json={
                "userId": str(sample_row.get("user_hash_id") or "u_e2e"),
                "userActionSequence": [{"targetPostId": pid, "action": "click"} for pid in (hist_pids or [str(sample_post["post_id"])])],
                "candidates": cand_items,
            },
        )
        assert r_rank.status_code == 200
        preds = r_rank.json()["predictions"]
        assert len(preds) == 4
        for p in preds:
            for field in ("click", "like", "reply", "repost", "notInterested", "videoQualityView"):
                assert 0.0 <= p[field] <= 1.0
            assert p["expectedDwellSec"] >= 0.0
            assert p["dwellProbs"] is not None and len(p["dwellProbs"]) == CREAD_NUM_BINS


def test_colab_v3_profiles_render_and_bundle_includes_src(tmp_path: Path) -> None:
    import ast
    import tarfile

    from recsys.colab.datasets import build_code_bundle
    from recsys.colab.profiles import COLAB_PROFILES
    from recsys.colab.worker_template import render_remote_worker_script

    for prof_name in (
        "v3-sid-twotower-a100",
        "v3-phoenix-teacher-a100",
        "v3-phoenix-distill-l4",
        "v3-full-pipeline-a100",
    ):
        assert prof_name in COLAB_PROFILES
        script_src = render_remote_worker_script(
            profile=COLAB_PROFILES[prof_name],
            artifact_version="v3-render-check",
            drive_data_dir="/content/drive/MyDrive/ml-services/data/prod_pit_v3",
            drive_output_dir="/content/drive/MyDrive/ml-services/out/v3-render-check",
        )
        ast.parse(script_src)
        assert "elif task.startswith(\"v3-\"):" in script_src

    bundle_path = tmp_path / "code_bundle.tar.gz"
    manifest = build_code_bundle(REPO_ROOT, bundle_path)
    assert manifest["includedFiles"] > 0
    with tarfile.open(bundle_path, "r:gz") as tf:
        names = tf.getnames()
    assert any(n.startswith("src/") for n in names)
    assert any(n.startswith("recsys/") for n in names)
    assert not any(".env" in n for n in names)


def test_e5_multimodal_and_stage3b_incremental_pipeline(tmp_path: Path) -> None:
    # 1. 验证高维正交投影 (SVD 主成分与 QR 回退) 及多模态球面融合契约
    rng = np.random.default_rng(77)
    raw_hi = rng.standard_normal((300, 768)).astype(np.float32)
    proj_svd = project_embeddings_orthogonal(raw_hi, dim=64, seed=11)
    assert proj_svd.shape == (300, 64)
    np.testing.assert_allclose(np.linalg.norm(proj_svd, axis=1), np.ones(300, dtype=np.float32), atol=1e-4)

    proj_qr = project_embeddings_orthogonal(raw_hi[:8], dim=64, seed=11)
    assert proj_qr.shape == (8, 64)
    np.testing.assert_allclose(np.linalg.norm(proj_qr, axis=1), np.ones(8, dtype=np.float32), atol=1e-4)

    post_ids = [f"post_{i}" for i in range(24)]
    mm_target = np.zeros(64, dtype=np.float32)
    mm_target[0] = 1.0
    blended, n_blended = align_and_blend_multimodal_embeddings(
        proj_svd[:24],
        post_ids,
        multimodal_post_vectors={"post_0": mm_target, "post_5": mm_target},
        text_weight=0.7,
    )
    assert n_blended == 2
    assert not np.allclose(blended[0], proj_svd[0])
    np.testing.assert_allclose(blended[1], proj_svd[1], atol=1e-6)

    # 2. 验证 Stage 3B Slate 级过采样拼接不破坏单榜单边界，并端到端走通 Stage 3A -> Stage 3B
    rows_other = _make_synthetic_slate_rows(num_slates=10, cands_per_slate=4, seed=101)
    rows_prod = _make_synthetic_slate_rows(num_slates=6, cands_per_slate=4, seed=202)
    for idx, r in enumerate(rows_prod):
        r["source_dataset"] = "prod_pit_v3"
        r["user_hash_id"] = f"prod_u_{idx // 4}"
    all_rows = rows_other + rows_prod

    train_rows = [r for r in all_rows if r["split"] == "train"]
    stage3b_slates, extra_prod, s3b_stats = build_stage3b_finetune_slates(
        train_rows,
        max_history_len=16,
        max_candidates=8,
        oversample=3,
        replay_ratio=0.25,
    )
    assert stage3b_slates is not None and extra_prod is not None
    assert s3b_stats["prod_oversampled_slates"] == 3 * s3b_stats["prod_slates"]
    assert len(stage3b_slates) == s3b_stats["prod_oversampled_slates"] + s3b_stats["replay_slates"]
    assert len(extra_prod) == 2 * s3b_stats["prod_slates"]

    concat_check = concat_phoenix_slates([stage3b_slates, extra_prod])
    assert len(concat_check) == len(stage3b_slates) + len(extra_prod)

    posts_rows = [
        {
            "post_id": f"post_{i}",
            "author_hash": f"author_{i % 3}",
            "title": f"multilingual post topic {i}",
            "content": f"detailed synthetic content body for post {i}",
            "has_video": 1 if i % 2 == 0 else 0,
        }
        for i in range(24)
    ]
    summary = build_complete_v3_serving_bundle(
        posts_rows=posts_rows,
        samples_rows=all_rows,
        models_dir=tmp_path / "models",
        data_dir=tmp_path / "data",
        artifact_version="v3-stage3b-unit-check",
        embedding_dim=64,
        text_epochs=2,
        rqvae_epochs=3,
        tt_epochs=2,
        teacher_epochs=1,
        student_epochs=1,
        stage3b_prod_epochs=1,
        stage3b_prod_oversample=2,
        stage3b_replay_ratio=0.5,
        stage3b_lr=1e-4,
        batch_size=16,
        max_history_len=16,
        max_candidates=8,
        multimodal_post_embeddings={"post_0": mm_target, "post_5": mm_target},
        faiss_hnsw_m=8,
        device="cpu",
    )
    assert summary["e5EncoderInfo"]["multimodalBlendedPosts"] == 2
    assert summary["stage3bMetrics"]["enabled"] is True
    assert summary["stage3bMetrics"]["executed"] is True
    assert "prodValTeacher" in summary["stage3bMetrics"]
    assert "prodValStudent" in summary["stage3bMetrics"]
    assert Path(summary["manifestPath"]).exists()
