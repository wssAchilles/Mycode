"""Phase 28C Ablations ①/③/④/⑤ 评测矩阵与全栈 V3 Serving 产物端到端联合打包流水线。

串联 Stage 1 (TextEncoder + 6x256 RQ-VAE) -> Stage 2 (无 ID MoL TwoTower + HNSW-SQ8) ->
Stage 3 (Phoenix Teacher 10L->Student 6L 蒸馏 + Muon + PL + CREAD + DE-RRD) ->
Stage 4 (Hierarchical EB Calibration + Box L-BFGS-B + UDB1 + 16D RealGraph V3) ->
Stage 5 (INT8 ONNX 量化 Parity Gate + ServingManifestV3 SHA-256 签名，零 .pt 残留)。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import torch

from src.contracts.actions import build_cread_bin_edges_ms
from src.contracts.artifacts import build_serving_manifest_v3
from src.contracts.sid import SID_NUM_LEVELS
from src.models.phoenix_v3 import PhoenixV3Config
from src.models.rq_vae_sid import (
    evaluate_rqvae_codebook,
    save_rqvae_safetensors,
    train_distilled_text_encoder,
    train_rqvae_codebook,
)
from src.models.two_tower_v3 import TwoTowerV3Config
from src.offline_export.export_onnx_int8 import (
    export_phoenix_v3_student_onnx_int8,
    export_text_encoder_v3_onnx_int8,
    export_two_tower_user_v3_onnx_int8,
)
from src.onnx_runtime.text_encoder_ort import SidCodebookQuantizer
from src.training.calibration_eb import (
    expected_calibration_error,
    fit_empirical_bayes_calibrator,
    fit_pit_user_debias_udb1,
    optimize_value_model_weights_lbfgsb,
)
from src.training.pl_derd_distill import (
    PhoenixPreparedSlates,
    distill_phoenix_v3_student,
    evaluate_phoenix_v3_slates,
    prepare_phoenix_v3_slates,
    train_phoenix_v3_teacher,
)
from src.training.realgraph_v3 import extract_realgraph_v3_matrix, train_realgraph_v3_gbt
from src.training.two_tower_v3_trainer import (
    build_faiss_hnsw_sq8_index,
    encode_corpus_candidates,
    prepare_two_tower_split,
    train_two_tower_v3,
)


def deterministic_semantic_projection(
    texts: Sequence[str],
    *,
    dim: int = 256,
    seed: int = 42,
) -> np.ndarray:
    """无外网/离线快速路径下构造稳定的字符 n-gram 随机投影归一化语义教师向量。"""
    n = len(texts)
    if n == 0:
        return np.zeros((0, dim), dtype=np.float32)
    mat = np.zeros((n, dim), dtype=np.float32)
    for row_idx, raw in enumerate(texts):
        s = str(raw or "").lower().strip()
        if not s:
            mat[row_idx, 0] = 1.0
            continue
        # 融合 unigram / bigram / trigram 确定性布隆投影，使同主题短文本具备高度一致的余弦结构
        tokens = s.split()
        grams: List[str] = list(tokens)
        for ch_i in range(len(s)):
            grams.append(s[ch_i : ch_i + 3])
        if not grams:
            grams = [s]
        for g in grams[:128]:
            h = int.from_bytes(hashlib.blake2b(g.encode("utf-8"), digest_size=8).digest(), "little")
            col = h % dim
            sign = 1.0 if ((h >> 8) & 1) == 0 else -1.0
            mat[row_idx, col] += sign
    norms = np.linalg.norm(mat, axis=1, keepdims=True) + 1e-12
    return (mat / norms).astype(np.float32)


def _split_train_val_rows(rows: Sequence[Mapping[str, Any]]) -> Tuple[List[Mapping[str, Any]], List[Mapping[str, Any]]]:
    train_rows = [r for r in rows if str(r.get("split") or "train").lower() == "train"]
    val_rows = [r for r in rows if str(r.get("split") or "").lower() in ("val", "test", "eval", "eval_random")]
    if not train_rows:
        cut = max(1, int(len(rows) * 0.8))
        train_rows = list(rows[:cut])
        val_rows = list(rows[cut:])
    if not val_rows:
        cut = max(1, int(len(train_rows) * 0.8))
        val_rows = list(train_rows[cut:]) or list(train_rows)
        train_rows = list(train_rows[:cut]) or list(train_rows)
    return train_rows, val_rows


def _move_int8_clean_from_tmp(
    export_res: Any,
    target_models_dir: Path,
    int8_filename: str,
) -> Path:
    """将临时目录下已通过 Parity Gate 的 INT8 模型拷至 models_dir，彻底杜绝未签名 fp32 残留。"""
    dst = Path(target_models_dir) / int8_filename
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(export_res.int8_path, dst)
    return dst


def run_ablation_1_sid_text(
    train_slates: PhoenixPreparedSlates,
    val_slates: PhoenixPreparedSlates,
    *,
    sid_artifact: Any = None,
    dim: int = 64,
    num_layers: int = 2,
    epochs: int = 3,
    batch_size: int = 16,
    device: Optional[str] = None,
) -> Dict[str, Any]:
    """Ablation ①：Hash-Only 禁用 SID vs 6x256 RQ-VAE Semantic ID 注入。"""
    cfg_no_sid = PhoenixV3Config(
        dim=dim,
        num_layers=num_layers,
        num_cand_only_layers=1,
        num_heads=4,
        num_kv_heads=2,
        enable_sid_embedder=False,
    )
    cfg_with_sid = PhoenixV3Config(
        dim=dim,
        num_layers=num_layers,
        num_cand_only_layers=1,
        num_heads=4,
        num_kv_heads=2,
        enable_sid_embedder=True,
    )
    _, base_res = train_phoenix_v3_teacher(
        train_slates, val_slates=val_slates, config=cfg_no_sid, epochs=epochs, batch_size=batch_size, device=device
    )
    _, sid_res = train_phoenix_v3_teacher(
        train_slates,
        val_slates=val_slates,
        config=cfg_with_sid,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        device=device,
    )
    b_m = base_res.get("val_metrics", {})
    s_m = sid_res.get("val_metrics", {})
    return {
        "ablation": "1_sid_text_vs_hash_only",
        "baseline_hash_only": b_m,
        "v3_with_6x256_sid": s_m,
        "delta_early_stop_score": float(s_m.get("early_stop_score", 0.0) - b_m.get("early_stop_score", 0.0)),
    }


def run_ablation_3_phoenix_loss_and_distill(
    train_slates: PhoenixPreparedSlates,
    val_slates: PhoenixPreparedSlates,
    *,
    sid_artifact: Any = None,
    teacher_dim: int = 64,
    student_dim: int = 32,
    epochs: int = 3,
    batch_size: int = 16,
    device: Optional[str] = None,
) -> Dict[str, Any]:
    """Ablation ③：纯 Masked BCE 无蒸馏 Student vs Teacher->Student (PL + CREAD + DE-RRD) 完整精排。"""
    s_cfg = PhoenixV3Config(
        dim=student_dim, num_layers=2, num_cand_only_layers=1, num_heads=4, num_kv_heads=2
    )
    t_cfg = PhoenixV3Config(
        dim=teacher_dim, num_layers=3, num_cand_only_layers=1, num_heads=4, num_kv_heads=2
    )
    # 基线：仅 BCE，不带 PL 与 Teacher 蒸馏
    _, naive_res = distill_phoenix_v3_student(
        train_slates,
        teacher_model=None,
        val_slates=val_slates,
        student_config=s_cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        distill_weight=0.0,
        pl_weight=0.0,
        cread_weight=0.0,
        device=device,
    )
    # 完整方案：Teacher + Plackett-Luce + CREAD-30 + DE-RRD
    teacher, teacher_res = train_phoenix_v3_teacher(
        train_slates,
        val_slates=val_slates,
        config=t_cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        device=device,
    )
    _, full_res = distill_phoenix_v3_student(
        train_slates,
        teacher_model=teacher,
        val_slates=val_slates,
        student_config=s_cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        distill_weight=0.6,
        pl_weight=0.25,
        cread_weight=0.35,
        device=device,
    )
    n_m = naive_res.get("val_metrics", {})
    f_m = full_res.get("val_metrics", {})
    return {
        "ablation": "3_pl_cread_derd_distill",
        "baseline_bce_only_student": n_m,
        "teacher": teacher_res.get("val_metrics", {}),
        "v3_distilled_student": f_m,
        "delta_early_stop_score": float(f_m.get("early_stop_score", 0.0) - n_m.get("early_stop_score", 0.0)),
    }


def run_ablation_4_muon_vs_adamw(
    train_slates: PhoenixPreparedSlates,
    val_slates: PhoenixPreparedSlates,
    *,
    sid_artifact: Any = None,
    dim: int = 64,
    epochs: int = 4,
    batch_size: int = 16,
    device: Optional[str] = None,
) -> Dict[str, Any]:
    """Ablation ④：相同网络/步数下对比纯 AdamW vs Muon+AdamW (5 步 Newton-Schulz) 收敛与性能。"""
    cfg = PhoenixV3Config(dim=dim, num_layers=2, num_cand_only_layers=1, num_heads=4, num_kv_heads=2)
    _, adam_res = train_phoenix_v3_teacher(
        train_slates,
        val_slates=val_slates,
        config=cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        use_muon=False,
        device=device,
    )
    _, muon_res = train_phoenix_v3_teacher(
        train_slates,
        val_slates=val_slates,
        config=cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        use_muon=True,
        device=device,
    )
    a_m = adam_res.get("val_metrics", {})
    m_m = muon_res.get("val_metrics", {})
    return {
        "ablation": "4_muon_vs_adamw",
        "baseline_adamw": {"final_loss": adam_res["final_loss"], **a_m},
        "v3_muon_adamw": {"final_loss": muon_res["final_loss"], **m_m},
        "delta_loss": float(muon_res["final_loss"] - adam_res["final_loss"]),
        "delta_early_stop_score": float(m_m.get("early_stop_score", 0.0) - a_m.get("early_stop_score", 0.0)),
    }


def run_ablation_5_calibration_and_sidecars(
    val_probs_14: np.ndarray,
    val_labels_14: np.ndarray,
    val_masks_14: np.ndarray,
    samples_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    """Ablation ⑤：未校准原始概率 vs 经验贝叶斯多层校准 (ECE) 及 RealGraph V3 16 维审计。"""
    raw_ece = float(expected_calibration_error(val_labels_14[val_masks_14 > 0.5], val_probs_14[val_masks_14 > 0.5]))
    calibrator = fit_empirical_bayes_calibrator(val_probs_14, val_labels_14, val_masks_14)
    rg_art = train_realgraph_v3_gbt(samples_rows, min_samples_guard=4, min_auc_guard=0.0)
    return {
        "ablation": "5_empirical_bayes_calibrator_and_realgraph_v3",
        "raw_overall_ece": raw_ece,
        "calibrator_mean_ece_before": calibrator["meanEceBefore"],
        "calibrator_mean_ece_after": calibrator["meanEceAfter"],
        "realgraph_feature_count": len(rg_art["features"]),
        "realgraph_auc": rg_art["metrics"].get("auc"),
    }


def load_v3_parquet_corpus_and_samples(
    dataset_dir: Path,
    *,
    max_samples: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """从 V3 PIT Parquet 目录（兼容 prod_pit_v3 与多源合并 v3_posts_corpus/v3_samples_*.parquet）加载数据。"""
    root = Path(dataset_dir)
    posts_path = root / "prod_posts_corpus_v3.parquet"
    if not posts_path.exists():
        posts_path = root / "v3_posts_corpus.parquet"
    if not posts_path.exists():
        raise FileNotFoundError(f"未在 {root} 找到 prod_posts_corpus_v3.parquet 或 v3_posts_corpus.parquet")
    posts_table = pq.read_table(posts_path)

    samples_path = root / "prod_pit_samples_v3.parquet"
    if samples_path.exists():
        samples_table = pq.read_table(samples_path)
    else:
        split_paths = sorted(root.glob("v3_samples_*.parquet"))
        if not split_paths:
            raise FileNotFoundError(f"未在 {root} 找到 prod_pit_samples_v3.parquet 或 v3_samples_*.parquet")
        samples_table = pa.concat_tables([pq.read_table(p) for p in split_paths], promote_options="default")

    if max_samples is not None and samples_table.num_rows > int(max_samples):
        samples_table = samples_table.slice(0, int(max_samples))
    return posts_table.to_pylist(), samples_table.to_pylist()


def build_complete_v3_serving_bundle(
    *,
    posts_rows: Sequence[Mapping[str, Any]],
    samples_rows: Sequence[Mapping[str, Any]],
    models_dir: Path,
    data_dir: Path,
    artifact_version: str,
    post_teacher_embeddings: Optional[np.ndarray] = None,
    embedding_dim: int = 256,
    text_epochs: int = 8,
    rqvae_epochs: int = 12,
    tt_epochs: int = 4,
    teacher_epochs: int = 3,
    student_epochs: int = 4,
    batch_size: int = 64,
    teacher_config: Optional[PhoenixV3Config] = None,
    student_config: Optional[PhoenixV3Config] = None,
    two_tower_config: Optional[TwoTowerV3Config] = None,
    max_history_len: int = 32,
    max_candidates: int = 16,
    device: Optional[str] = None,
) -> Dict[str, Any]:
    """全栈端到端 V3 产物联产流水线：产出全套 ONNX INT8、Safetensors、HNSW-SQ8、侧车及签名清单。"""
    m_dir = Path(models_dir)
    d_dir = Path(data_dir)
    m_dir.mkdir(parents=True, exist_ok=True)
    d_dir.mkdir(parents=True, exist_ok=True)

    # 1. Stage 1: 多语言文本蒸馏与 6x256 RQ-VAE 码本生成
    post_ids: List[str] = []
    texts: List[str] = []
    for i, post in enumerate(posts_rows):
        post_ids.append(str(post.get("post_id") or post.get("postId") or f"p_{i}"))
        title = str(post.get("title") or "")
        body = str(post.get("content") or "")
        texts.append((f"{title}\n{body}").strip() or post_ids[-1])

    teacher_embs = (
        np.asarray(post_teacher_embeddings, dtype=np.float32)
        if post_teacher_embeddings is not None
        else deterministic_semantic_projection(texts, dim=embedding_dim)
    )
    text_enc, text_metrics = train_distilled_text_encoder(
        texts,
        teacher_embs,
        hidden_dim=min(256, max(64, embedding_dim)),
        embedding_dim=embedding_dim,
        max_length=128,
        num_layers=2,
        epochs=text_epochs,
        batch_size=min(batch_size, max(8, len(texts))),
        device=device,
    )
    rqvae_art, rqvae_metrics = train_rqvae_codebook(
        teacher_embs,
        hidden_dim=min(256, max(64, embedding_dim)),
        latent_dim=64,
        epochs=rqvae_epochs,
        batch_size=min(256, max(16, len(texts))),
        device=device,
    )
    sid_st_path = save_rqvae_safetensors(rqvae_art, m_dir / "sid_codebook.safetensors")
    quantizer = SidCodebookQuantizer.from_npz_or_json(sid_st_path)
    wire_sids_list, _ = quantizer.batch_encode(teacher_embs)

    post_sid_wire_map: Dict[str, List[int]] = {pid: sid for pid, sid in zip(post_ids, wire_sids_list)}
    post_text_emb_map: Dict[str, np.ndarray] = {pid: teacher_embs[idx] for idx, pid in enumerate(post_ids)}

    # 2. Stage 2: 无 User ID MoL 双塔训练 + FAISS IndexHNSWSQ(QT_8bit) 建库
    train_rows, val_rows = _split_train_val_rows(samples_rows)
    tt_train = prepare_two_tower_split(
        train_rows,
        max_seq_len=max_history_len,
        text_dim=embedding_dim,
        post_sid_wire_map=post_sid_wire_map,
        post_text_emb_map=post_text_emb_map,
        include_unlabeled_as_weak_positive=True,
    )
    tt_val = prepare_two_tower_split(
        val_rows,
        max_seq_len=max_history_len,
        text_dim=embedding_dim,
        post_sid_wire_map=post_sid_wire_map,
        post_text_emb_map=post_text_emb_map,
        include_unlabeled_as_weak_positive=True,
    )
    tt_cfg = two_tower_config or TwoTowerV3Config(
        hidden_dim=128,
        embedding_dim=embedding_dim,
        num_layers=2,
        num_heads=4,
        num_kv_heads=2,
        mol_num_heads=4,
        max_history_len=max_history_len,
        post_hash_buckets=8192,
        author_hash_buckets=2048,
    )
    tt_model, tt_metrics = train_two_tower_v3(
        tt_train,
        val_split=tt_val,
        corpus_posts=posts_rows,
        post_sid_wire_map=post_sid_wire_map,
        post_text_emb_map=post_text_emb_map,
        config=tt_cfg,
        sid_artifact=rqvae_art,
        epochs=tt_epochs,
        batch_size=min(batch_size, max(8, len(tt_train))),
        device=device,
    )
    corpus_vecs, corpus_pids = encode_corpus_candidates(
        tt_model,
        posts_rows,
        text_dim=embedding_dim,
        post_sid_wire_map=post_sid_wire_map,
        post_text_emb_map=post_text_emb_map,
        device=torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu")),
    )
    faiss_idx_path, faiss_map_path = build_faiss_hnsw_sq8_index(corpus_vecs, corpus_pids, m_dir)

    # 3. Stage 3: Phoenix V3 Teacher -> Student 联合蒸馏 (Muon + PL + CREAD-30 + DE-RRD)
    phx_train = prepare_phoenix_v3_slates(
        train_rows,
        max_history_len=max_history_len,
        max_candidates=max_candidates,
        post_sid_wire_map=post_sid_wire_map,
    )
    phx_val = prepare_phoenix_v3_slates(
        val_rows,
        max_history_len=max_history_len,
        max_candidates=max_candidates,
        post_sid_wire_map=post_sid_wire_map,
    )
    t_cfg = teacher_config or PhoenixV3Config(
        dim=128,
        num_layers=4,
        num_cand_only_layers=1,
        num_heads=4,
        num_kv_heads=2,
        max_history_len=max_history_len,
        max_candidates=max_candidates,
        post_hash_buckets=8192,
        author_hash_buckets=2048,
    )
    s_cfg = student_config or PhoenixV3Config(
        dim=64,
        num_layers=3,
        num_cand_only_layers=1,
        num_heads=4,
        num_kv_heads=2,
        max_history_len=max_history_len,
        max_candidates=max_candidates,
        post_hash_buckets=8192,
        author_hash_buckets=2048,
    )
    teacher, teacher_res = train_phoenix_v3_teacher(
        phx_train,
        val_slates=phx_val,
        config=t_cfg,
        sid_artifact=rqvae_art,
        epochs=teacher_epochs,
        batch_size=min(batch_size, max(4, len(phx_train))),
        device=device,
    )
    student, student_res = distill_phoenix_v3_student(
        phx_train,
        teacher_model=teacher,
        val_slates=phx_val,
        student_config=s_cfg,
        sid_artifact=rqvae_art,
        epochs=student_epochs,
        batch_size=min(batch_size, max(4, len(phx_train))),
        device=device,
    )

    # 4. Stage 4: 校准 + Value Model + UDB1 + 16D RealGraph V3 侧车联产
    eval_out = evaluate_phoenix_v3_slates(
        student,
        phx_val,
        device=torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu")),
    )
    calibrator = fit_empirical_bayes_calibrator(
        eval_out["flat_probs"],
        eval_out["flat_labels"],
        eval_out["flat_masks"],
        models_dir=m_dir,
    )
    cm_valid = phx_val.cand_mask > 0
    cread_probs = np.exp(eval_out["flat_cread_logits"] - np.max(eval_out["flat_cread_logits"], axis=-1, keepdims=True))
    cread_probs /= np.sum(cread_probs, axis=-1, keepdims=True) + 1e-12
    edges_ms = build_cread_bin_edges_ms()
    mids_sec = np.array([0.5 * (edges_ms[i] + edges_ms[i + 1]) / 1000.0 for i in range(len(edges_ms) - 1)])
    expected_sec = cread_probs @ mids_sec
    value_art = optimize_value_model_weights_lbfgsb(
        eval_out["flat_probs"],
        expected_sec,
        phx_val.relevance_scores[cm_valid],
        models_dir=m_dir,
    )
    udb1_art = fit_pit_user_debias_udb1(train_rows, models_dir=m_dir)
    realgraph_art = train_realgraph_v3_gbt(
        train_rows,
        models_dir=m_dir,
        post_sid_wire_map=post_sid_wire_map,
        min_samples_guard=4,
        min_auc_guard=0.0,
    )

    cread_path = d_dir / "cread_edges_ms.json"
    cread_path.write_text(json.dumps(edges_ms, indent=2), encoding="utf-8")

    # 5. Stage 5: ONNX FP32->INT8 量化与 Parity Gate 验证，仅留存干净 INT8 图到 models_dir
    with tempfile.TemporaryDirectory() as tmp_onnx:
        tmp_path = Path(tmp_onnx)
        txt_exp = export_text_encoder_v3_onnx_int8(text_enc, tmp_path / "txt", seq_len=128, min_cosine=0.98, max_mae=0.03)
        tt_exp = export_two_tower_user_v3_onnx_int8(
            tt_model.user_tower, tmp_path / "tt", max_seq_len=max_history_len, min_cosine=0.98, max_mae=0.03
        )
        phx_exp = export_phoenix_v3_student_onnx_int8(
            student,
            tmp_path / "phx",
            hist_len=max_history_len,
            cand_len=min(8, max_candidates),
            min_cosine=0.985,
            max_mae=0.08,
        )
        _move_int8_clean_from_tmp(txt_exp, m_dir, "text_encoder_int8.onnx")
        _move_int8_clean_from_tmp(tt_exp, m_dir, "two_tower_user_int8.onnx")
        _move_int8_clean_from_tmp(phx_exp, m_dir, "phoenix_v3_student_int8.onnx")

    # 为 models_dir 全部额外 JSON 侧车写入 SHA-256 摘要，保证 ServingState strict 模式零报错
    manifest = build_serving_manifest_v3(
        version=artifact_version,
        profile="phoenix-v3",
        models_dir=m_dir,
        data_dir=d_dir,
        embedding_dim=embedding_dim,
        faiss_index_type="hnsw_sq8",
        extra_artifacts={
            "value_model_weights_v3.json": m_dir / "value_model_weights_v3.json",
            "user_debias_v3.json": m_dir / "user_debias_v3.json",
            "realgraph_v3.json": m_dir / "realgraph_v3.json",
        },
    )
    manifest_path = d_dir / "serving_manifest_v3.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "artifactVersion": artifact_version,
        "manifestPath": str(manifest_path),
        "textMetrics": text_metrics,
        "rqvaeMetrics": rqvae_metrics,
        "twoTowerMetrics": tt_metrics,
        "teacherMetrics": teacher_res.get("val_metrics", {}),
        "studentMetrics": student_res.get("val_metrics", {}),
        "calibratorSummary": {"meanEceBefore": calibrator["meanEceBefore"], "meanEceAfter": calibrator["meanEceAfter"]},
        "valueModelOptimizer": value_art["optimizer"],
        "udb1Users": udb1_art["userCount"],
        "realgraphAuc": realgraph_art["metrics"].get("auc"),
        "onnxParity": {
            "textCosine": txt_exp.parity_reports[0].mean_cosine_similarity,
            "textMae": txt_exp.parity_reports[0].mae,
            "twoTowerCosine": tt_exp.parity_reports[0].mean_cosine_similarity,
            "twoTowerMae": tt_exp.parity_reports[0].mae,
            "phoenixActionCosine": phx_exp.parity_reports[0].mean_cosine_similarity,
            "phoenixActionMae": phx_exp.parity_reports[0].mae,
            "phoenixCreadCosine": phx_exp.parity_reports[1].mean_cosine_similarity,
            "phoenixCreadMae": phx_exp.parity_reports[1].mae,
        },
        "faissIndexPath": str(faiss_idx_path),
        "faissMappingPath": str(faiss_map_path),
    }
