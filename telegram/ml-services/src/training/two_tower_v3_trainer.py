"""TwoTower V3 双塔训练器、In-Batch 假负例屏蔽 + Log-Q 纠偏、FAISS HNSW-SQ8 建库与 Ablation ② 评测。"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import faiss
import numpy as np
import torch
import torch.nn.functional as F

from src.contracts.actions import NUM_PREDICTED_ACTIONS, PREDICTED_ACTIONS
from src.contracts.sid import SID_NUM_LEVELS, WIRE_MISSING_SID, wire_to_model_sids
from src.feature_adapters.history_packer import stable_id_hash_u64
from src.models.two_tower_v3 import TwoTowerV3Config, TwoTowerV3Model
from src.training.checkpoint_manager import CheckpointManager, OomSafeBatchController


@dataclass
class TwoTowerPreparedSplit:
    """张量化双塔样本切片，支持直接按索引切片喂入 GPU/CPU 训练或评估。"""

    history_post_hashes: np.ndarray   # (N, L) int64
    history_author_hashes: np.ndarray # (N, L) int64
    history_action_types: np.ndarray  # (N, L) int64
    history_time_buckets: np.ndarray  # (N, L) int64
    history_sids: np.ndarray          # (N, L, 6) int64 1-indexed
    history_action_masks: np.ndarray  # (N, L, 13) uint8
    attention_mask: np.ndarray        # (N, L) int64

    pos_post_ids: List[str]
    pos_post_hashes: np.ndarray       # (N,) int64
    pos_author_hashes: np.ndarray     # (N,) int64
    pos_sids: np.ndarray              # (N, 6) int64 1-indexed
    pos_in_network: np.ndarray        # (N,) int64
    pos_has_video: np.ndarray         # (N,) int64
    pos_text_emb: np.ndarray          # (N, D_txt) float32
    pos_log_q: np.ndarray             # (N,) float32
    sample_weights: np.ndarray        # (N,) float32 (ld 加权)

    def __len__(self) -> int:
        return len(self.pos_post_ids)


def _extract_positive_engagement_weight(row: Mapping[str, Any]) -> float:
    """结合多维正反馈强度与 ld 策略计算单条双塔正例权重（深度交互获更高梯度加权）。"""
    labels = row.get("action_labels") or []
    masks = row.get("action_mask") or []
    weights_by_idx = (1.0, 1.5, 2.5, 2.0, 2.0, 1.8, 0.8, 1.2, 2.0)  # 对应 PREDICTED_ACTIONS 前 9 个正向动作
    score = 0.0
    has_pos = False
    for idx in range(min(len(weights_by_idx), len(labels))):
        m = int(masks[idx]) if idx < len(masks) else 1
        y = int(labels[idx])
        if m > 0 and y > 0:
            score += weights_by_idx[idx]
            has_pos = True
    if not has_pos:
        return 0.0
    # 若显式带正 dwell_ms 叠加平滑对数深度信号 ld = 1 + log1p(dwell_sec)
    dwell_ms = float(row.get("dwell_ms") or 0.0)
    dwell_mask = int(row.get("dwell_mask") or 0)
    if dwell_mask > 0 and dwell_ms > 0.0:
        score += 0.35 * math.log1p(dwell_ms / 1000.0)
    return max(0.5, min(5.0, 0.5 + 0.35 * score))


def prepare_two_tower_split(
    rows: Sequence[Mapping[str, Any]],
    *,
    max_seq_len: int = 128,
    text_dim: int = 256,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
    post_text_emb_map: Optional[Mapping[str, np.ndarray]] = None,
    include_unlabeled_as_weak_positive: bool = False,
    cand_freq_map: Optional[Mapping[str, int]] = None,
) -> TwoTowerPreparedSplit:
    """将 V3 PIT Parquet 行转为对齐契约的 NumPy 双塔批次切片（支持注入最新 SID 与文本向量）。"""
    filtered: List[Tuple[Mapping[str, Any], float]] = []
    for row in rows:
        w = _extract_positive_engagement_weight(row)
        if w > 0.0:
            filtered.append((row, w))
        elif include_unlabeled_as_weak_positive:
            # 容错：若全量样本均为曝光日志（如部分合成切片全 0 标签），保留弱正权确保管线可调试跑通
            filtered.append((row, 0.5))

    if not filtered and rows:
        # 兜底：若该批次全部为负交互，仍至少按弱曝光流构造评估用样本避免空批崩溃
        filtered = [(r, 0.5) for r in rows]

    n = len(filtered)
    cap = max(1, int(max_seq_len))
    history_post_hashes = np.zeros((n, cap), dtype=np.int64)
    history_author_hashes = np.zeros((n, cap), dtype=np.int64)
    history_action_types = np.zeros((n, cap), dtype=np.int64)
    history_time_buckets = np.full((n, cap), 15, dtype=np.int64)
    history_sids = np.zeros((n, cap, SID_NUM_LEVELS), dtype=np.int64)
    history_action_masks = np.zeros((n, cap, NUM_PREDICTED_ACTIONS), dtype=np.uint8)
    attention_mask = np.zeros((n, cap), dtype=np.int64)

    pos_post_ids: List[str] = []
    pos_post_hashes = np.zeros(n, dtype=np.int64)
    pos_author_hashes = np.zeros(n, dtype=np.int64)
    pos_sids = np.zeros((n, SID_NUM_LEVELS), dtype=np.int64)
    pos_in_network = np.zeros(n, dtype=np.int64)
    pos_has_video = np.zeros(n, dtype=np.int64)
    pos_text_emb = np.zeros((n, text_dim), dtype=np.float32)
    sample_weights = np.zeros(n, dtype=np.float32)

    freq_counter = Counter(str(r.get("candidate_post_id") or "") for r, _ in filtered)
    if cand_freq_map:
        for k, v in cand_freq_map.items():
            freq_counter[str(k)] = max(freq_counter[str(k)], int(v))
    total_freq = float(max(1, sum(freq_counter.values())))

    pos_log_q = np.zeros(n, dtype=np.float32)

    for row_idx, (row, w) in enumerate(filtered):
        h_pids = list(row.get("history_post_ids") or [])[-cap:]
        h_auths = list(row.get("history_author_hashes") or [])[-cap:]
        h_acts = list(row.get("history_action_types") or [])[-cap:]
        h_tbs = list(row.get("history_time_buckets") or [])[-cap:]
        h_sids = list(row.get("history_sids") or [])[-cap:]
        row_mask = list(row.get("action_mask") or [1] * NUM_PREDICTED_ACTIONS)[:NUM_PREDICTED_ACTIONS]
        if len(row_mask) < NUM_PREDICTED_ACTIONS:
            row_mask = row_mask + [0] * (NUM_PREDICTED_ACTIONS - len(row_mask))
        row_mask_arr = np.asarray([1 if int(v) > 0 else 0 for v in row_mask], dtype=np.uint8)

        for seq_idx, raw_pid in enumerate(h_pids):
            pid_str = str(raw_pid or "")
            history_post_hashes[row_idx, seq_idx] = stable_id_hash_u64(pid_str)
            if seq_idx < len(h_auths):
                history_author_hashes[row_idx, seq_idx] = stable_id_hash_u64(h_auths[seq_idx])
            if seq_idx < len(h_acts):
                history_action_types[row_idx, seq_idx] = max(0, int(h_acts[seq_idx]))
            if seq_idx < len(h_tbs):
                history_time_buckets[row_idx, seq_idx] = max(0, min(15, int(h_tbs[seq_idx])))

            wire_s = None
            if post_sid_wire_map is not None and pid_str in post_sid_wire_map:
                wire_s = post_sid_wire_map[pid_str]
            elif seq_idx < len(h_sids):
                wire_s = h_sids[seq_idx]
            if wire_s is not None and len(wire_s) == SID_NUM_LEVELS:
                history_sids[row_idx, seq_idx] = np.asarray(wire_to_model_sids(wire_s), dtype=np.int64)

            history_action_masks[row_idx, seq_idx] = row_mask_arr
            attention_mask[row_idx, seq_idx] = 1

        # 空历史兜底至少点亮位置 0，避免全 zero attention_mask 在 Softmax 里出现非预期均值偏移
        if not h_pids:
            attention_mask[row_idx, 0] = 1

        cpid = str(row.get("candidate_post_id") or "")
        pos_post_ids.append(cpid)
        pos_post_hashes[row_idx] = stable_id_hash_u64(cpid)
        pos_author_hashes[row_idx] = stable_id_hash_u64(row.get("candidate_author_hash"))
        pos_in_network[row_idx] = 1 if int(row.get("candidate_in_network") or 0) > 0 else 0
        pos_has_video[row_idx] = 1 if int(row.get("candidate_has_video") or 0) > 0 else 0

        cand_wire = (
            post_sid_wire_map[cpid]
            if post_sid_wire_map is not None and cpid in post_sid_wire_map
            else row.get("candidate_sids", WIRE_MISSING_SID)
        )
        if cand_wire is not None and len(cand_wire) == SID_NUM_LEVELS:
            pos_sids[row_idx] = np.asarray(wire_to_model_sids(cand_wire), dtype=np.int64)

        if post_text_emb_map is not None and cpid in post_text_emb_map:
            vec = np.asarray(post_text_emb_map[cpid], dtype=np.float32).reshape(-1)
            copy_d = min(text_dim, vec.shape[0])
            pos_text_emb[row_idx, :copy_d] = vec[:copy_d]

        sample_weights[row_idx] = float(w)
        q_prob = max(1e-8, float(freq_counter[cpid]) / total_freq)
        pos_log_q[row_idx] = float(math.log(q_prob))

    return TwoTowerPreparedSplit(
        history_post_hashes=history_post_hashes,
        history_author_hashes=history_author_hashes,
        history_action_types=history_action_types,
        history_time_buckets=history_time_buckets,
        history_sids=history_sids,
        history_action_masks=history_action_masks,
        attention_mask=attention_mask,
        pos_post_ids=pos_post_ids,
        pos_post_hashes=pos_post_hashes,
        pos_author_hashes=pos_author_hashes,
        pos_sids=pos_sids,
        pos_in_network=pos_in_network,
        pos_has_video=pos_has_video,
        pos_text_emb=pos_text_emb,
        pos_log_q=pos_log_q,
        sample_weights=sample_weights,
    )


def _slice_batch_to_device(
    split: TwoTowerPreparedSplit,
    indices: np.ndarray,
    device: torch.device,
) -> Dict[str, torch.Tensor]:
    idx = np.asarray(indices, dtype=np.int64)
    return {
        "history_post_hashes": torch.from_numpy(split.history_post_hashes[idx]).to(device),
        "history_author_hashes": torch.from_numpy(split.history_author_hashes[idx]).to(device),
        "history_action_types": torch.from_numpy(split.history_action_types[idx]).to(device),
        "history_time_buckets": torch.from_numpy(split.history_time_buckets[idx]).to(device),
        "history_sids": torch.from_numpy(split.history_sids[idx]).to(device),
        "history_action_masks": torch.from_numpy(split.history_action_masks[idx]).to(device),
        "attention_mask": torch.from_numpy(split.attention_mask[idx]).to(device),
        "pos_post_hashes": torch.from_numpy(split.pos_post_hashes[idx]).to(device),
        "pos_author_hashes": torch.from_numpy(split.pos_author_hashes[idx]).to(device),
        "pos_sids": torch.from_numpy(split.pos_sids[idx]).to(device),
        "pos_in_network": torch.from_numpy(split.pos_in_network[idx]).to(device),
        "pos_has_video": torch.from_numpy(split.pos_has_video[idx]).to(device),
        "pos_text_emb": torch.from_numpy(split.pos_text_emb[idx]).to(device),
        "pos_log_q": torch.from_numpy(split.pos_log_q[idx]).to(device),
        "sample_weights": torch.from_numpy(split.sample_weights[idx]).to(device),
    }


def compute_two_tower_v3_loss(
    logits: torch.Tensor,          # (B, B) in-batch (+ 可选额外负例 M_extra -> (B, B + M_extra))
    *,
    pos_post_hashes: torch.Tensor, # (B,)
    cand_log_q: Optional[torch.Tensor] = None,  # (B,) 或 (B + M_extra,)
    sample_weights: Optional[torch.Tensor] = None,  # ld 加权 (B,)
    user_vecs: Optional[torch.Tensor] = None,       # (B, K, D) 用于头间正交多样性惩罚
    mask_in_batch_false_negatives: bool = True,
    apply_log_q_correction: bool = True,
    diversity_weight: float = 0.02,
) -> torch.Tensor:
    """计算带假负例掩码、Log-Q 流行度纠偏、ld 权重及 MoL 多样性正则的 InfoNCE 损失。"""
    bsz, total_cands = logits.shape
    device = logits.device
    targets = torch.arange(bsz, device=device, dtype=torch.long)

    adjusted_logits = logits
    eye_mask = torch.zeros((bsz, total_cands), dtype=torch.bool, device=device)
    eye_mask[torch.arange(bsz, device=device), targets] = True

    if apply_log_q_correction and cand_log_q is not None:
        # 严格对齐 Yi et al. 2019 Log-Q 采样纠偏：全列 logits 均减去 log(q_j)，抵消批内流行度采样偏差
        adjusted_logits = adjusted_logits - cand_log_q.unsqueeze(0)

    if mask_in_batch_false_negatives:
        # 屏蔽同批次其它样本中出现过的相同正例帖子（避免把共同喜欢推作负例）
        in_batch_same = pos_post_hashes.unsqueeze(1) == pos_post_hashes.unsqueeze(0)  # (B, B)
        if total_cands > bsz:
            pad_false = torch.zeros((bsz, total_cands - bsz), dtype=torch.bool, device=device)
            full_same = torch.cat([in_batch_same, pad_false], dim=1)
        else:
            full_same = in_batch_same
        false_neg_mask = full_same & (~eye_mask)
        adjusted_logits = adjusted_logits.masked_fill(false_neg_mask, -1e4)

    per_sample = F.cross_entropy(adjusted_logits, targets, reduction="none")
    if sample_weights is not None:
        w = sample_weights.clamp_min(1e-3)
        loss = (per_sample * w).sum() / w.sum().clamp_min(1e-6)
    else:
        loss = per_sample.mean()

    if diversity_weight > 0.0 and user_vecs is not None and user_vecs.ndim == 3 and user_vecs.shape[1] > 1:
        # 促使 MoL 多头分散捕捉不同兴趣，避免坍缩成相同向量
        k_heads = user_vecs.shape[1]
        gram = torch.matmul(user_vecs, user_vecs.transpose(1, 2))  # (B, K, K)
        eye_k = torch.eye(k_heads, device=device, dtype=gram.dtype).unsqueeze(0)
        off_diag = gram * (1.0 - eye_k)
        div_pen = torch.mean(off_diag * off_diag)
        loss = loss + diversity_weight * div_pen

    return loss


@torch.no_grad()
def evaluate_retrieval_metrics(
    model: TwoTowerV3Model,
    eval_split: TwoTowerPreparedSplit,
    *,
    corpus_vectors: np.ndarray,
    corpus_post_ids: Sequence[str],
    use_mol: bool = True,
    ks: Sequence[int] = (10, 50, 100),
    batch_size: int = 128,
    device: Optional[torch.device] = None,
) -> Dict[str, float]:
    """在固定候选池上评估双塔用户向量对真值正例的 Recall@K 与 MRR@100。"""
    model.eval()
    target_device = device or next(model.parameters()).device
    n_eval = len(eval_split)
    n_corpus = len(corpus_post_ids)
    if n_eval == 0 or n_corpus == 0:
        return {f"recall@{k}": 0.0 for k in ks} | {"mrr@100": 0.0}

    pid_to_idx = {pid: i for i, pid in enumerate(corpus_post_ids)}
    c_vecs = np.asarray(corpus_vectors, dtype=np.float32)
    c_norms = np.linalg.norm(c_vecs, axis=1, keepdims=True) + 1e-12
    c_vecs = c_vecs / c_norms

    hits_by_k = {int(k): 0.0 for k in ks}
    mrr_sum = 0.0
    valid_eval = 0

    # 分批在线算分与实时定秩，彻底避免 n_eval × n_corpus 巨型矩阵内存爆炸
    c_vecs_t = c_vecs.T  # (D, M)
    for start in range(0, n_eval, batch_size):
        end = min(n_eval, start + batch_size)
        idx = np.arange(start, end)
        batch = _slice_batch_to_device(eval_split, idx, target_device)
        user_vecs, _ = model.encode_user_batch(batch)  # (b, K, D)
        u_np = user_vecs.detach().cpu().numpy()
        bsz_cur, k_heads, dim = u_np.shape
        if not use_mol or k_heads == 1:
            scores = u_np[:, 0, :] @ c_vecs_t  # (b, M)
        else:
            # 使用 BLAS 矩阵乘替代 einsum 计算 MoL 多头最大余弦激活
            scores = (u_np.reshape(bsz_cur * k_heads, dim) @ c_vecs_t).reshape(bsz_cur, k_heads, -1).max(axis=1)

        for local_i, row_idx in enumerate(range(start, end)):
            target_col = pid_to_idx.get(eval_split.pos_post_ids[row_idx])
            if target_col is None:
                continue
            valid_eval += 1
            row_scores = scores[local_i]
            tgt_val = row_scores[target_col]
            higher = int(np.sum(row_scores > tgt_val))
            ties_before = int(np.sum(row_scores[:target_col] == tgt_val))
            rank = higher + ties_before + 1
            for k in ks:
                if rank <= int(k):
                    hits_by_k[int(k)] += 1.0
            if rank <= 100:
                mrr_sum += 1.0 / float(rank)

    denom = float(max(1, valid_eval))
    metrics = {f"recall@{k}": hits_by_k[int(k)] / denom for k in ks}
    metrics["mrr@100"] = mrr_sum / denom
    metrics["evaluated_samples"] = float(valid_eval)
    return metrics


@torch.no_grad()
def encode_corpus_candidates(
    model: TwoTowerV3Model,
    corpus_posts: Sequence[Mapping[str, Any]],
    *,
    text_dim: int = 256,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
    post_text_emb_map: Optional[Mapping[str, np.ndarray]] = None,
    batch_size: int = 256,
    device: Optional[torch.device] = None,
) -> Tuple[np.ndarray, List[str]]:
    """批量用 CandidateTowerV3 计算全体语料库 256d L2 归一化 ANN 向量。"""
    model.eval()
    target_device = device or next(model.parameters()).device
    n = len(corpus_posts)
    if n == 0:
        return np.zeros((0, model.config.embedding_dim), dtype=np.float32), []

    post_ids: List[str] = []
    p_hash = np.zeros(n, dtype=np.int64)
    a_hash = np.zeros(n, dtype=np.int64)
    c_sids = np.zeros((n, SID_NUM_LEVELS), dtype=np.int64)
    c_in_net = np.ones(n, dtype=np.int64)
    c_video = np.zeros(n, dtype=np.int64)
    c_txt = np.zeros((n, text_dim), dtype=np.float32)

    for i, post in enumerate(corpus_posts):
        pid = str(post.get("post_id") or post.get("postId") or f"p_{i}")
        post_ids.append(pid)
        p_hash[i] = stable_id_hash_u64(pid)
        a_hash[i] = stable_id_hash_u64(post.get("author_hash") or post.get("authorHash"))
        c_video[i] = 1 if post.get("has_video") or post.get("hasVideo") else 0
        wire = (
            post_sid_wire_map[pid]
            if post_sid_wire_map is not None and pid in post_sid_wire_map
            else post.get("semantic_ids", WIRE_MISSING_SID)
        )
        if wire is not None and len(wire) == SID_NUM_LEVELS:
            c_sids[i] = np.asarray(wire_to_model_sids(wire), dtype=np.int64)
        if post_text_emb_map is not None and pid in post_text_emb_map:
            v = np.asarray(post_text_emb_map[pid], dtype=np.float32).reshape(-1)
            c_txt[i, : min(text_dim, v.shape[0])] = v[: min(text_dim, v.shape[0])]

    out_vecs: List[np.ndarray] = []
    for start in range(0, n, batch_size):
        sl = slice(start, min(n, start + batch_size))
        ann_vec, _, _ = model.candidate_tower.encode_with_context(
            cand_post_hashes=torch.from_numpy(p_hash[sl]).to(target_device),
            cand_author_hashes=torch.from_numpy(a_hash[sl]).to(target_device),
            cand_sids=torch.from_numpy(c_sids[sl]).to(target_device),
            cand_in_network=torch.from_numpy(c_in_net[sl]).to(target_device),
            cand_has_video=torch.from_numpy(c_video[sl]).to(target_device),
            cand_text_emb=torch.from_numpy(c_txt[sl]).to(target_device),
        )
        out_vecs.append(ann_vec.detach().cpu().numpy().astype(np.float32))

    return np.concatenate(out_vecs, axis=0), post_ids


def build_faiss_hnsw_sq8_index(
    vectors: np.ndarray,
    post_ids: Sequence[str],
    out_models_dir: Path,
    *,
    hnsw_m: int = 16,
    ef_construction: int = 80,
    ef_search: int = 64,
) -> Tuple[Path, Path]:
    """构建 FAISS `IndexHNSWSQ(QT_8bit)` 量化图检索索引并落盘 `faiss_id_mapping.json`。"""
    arr = np.asarray(vectors, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[0] != len(post_ids):
        raise ValueError(f"vectors shape {arr.shape} mismatches post_ids len {len(post_ids)}")
    if arr.shape[0] == 0:
        raise ValueError("cannot build FAISS HNSW-SQ8 index on empty corpus")

    norms = np.linalg.norm(arr, axis=1, keepdims=True) + 1e-12
    normed = np.ascontiguousarray(arr / norms, dtype=np.float32)
    dim = int(normed.shape[1])

    index = faiss.IndexHNSWSQ(dim, faiss.ScalarQuantizer.QT_8bit, int(hnsw_m), faiss.METRIC_INNER_PRODUCT)
    index.hnsw.efConstruction = int(ef_construction)
    index.hnsw.efSearch = int(ef_search)
    index.train(normed)
    index.add(normed)

    out_dir = Path(out_models_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "faiss_hnsw_sq8.index"
    mapping_path = out_dir / "faiss_id_mapping.json"

    faiss.write_index(index, str(index_path))
    mapping_payload = {
        "index_type": "hnsw_sq8",
        "embedding_dim": dim,
        "count": len(post_ids),
        "idx_to_post_id": {str(idx): str(pid) for idx, pid in enumerate(post_ids)},
    }
    mapping_path.write_text(json.dumps(mapping_payload, indent=2), encoding="utf-8")
    return index_path, mapping_path


def train_two_tower_v3(
    train_split: TwoTowerPreparedSplit,
    *,
    val_split: Optional[TwoTowerPreparedSplit] = None,
    corpus_posts: Optional[Sequence[Mapping[str, Any]]] = None,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
    post_text_emb_map: Optional[Mapping[str, np.ndarray]] = None,
    config: Optional[TwoTowerV3Config] = None,
    sid_artifact: Optional[Any] = None,
    epochs: int = 8,
    batch_size: int = 128,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    use_mol: bool = True,
    mask_in_batch_false_negatives: bool = True,
    apply_log_q_correction: bool = True,
    checkpoint_manager: Optional[CheckpointManager] = None,
    seed: int = 42,
    device: Optional[str] = None,
) -> Tuple[TwoTowerV3Model, Dict[str, Any]]:
    """执行 TwoTower V3 训练主循环，集成 OOM 缩容保护、断点续训与评估。"""
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    target_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))

    cfg = config or TwoTowerV3Config()
    text_dim = int(train_split.pos_text_emb.shape[1]) if train_split.pos_text_emb.ndim == 2 else 256
    model = TwoTowerV3Model(cfg, text_input_dim=text_dim, sid_artifact=sid_artifact).to(target_device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

    start_epoch = 0
    global_step = 0
    best_score = -1.0
    if checkpoint_manager is not None:
        resumed = checkpoint_manager.resume_latest(model, optimizer=optimizer, map_location=target_device)
        if resumed is not None:
            start_epoch = int(resumed.get("epoch", 0))
            global_step = int(resumed.get("step", 0))
            if resumed.get("metric_value") is not None:
                best_score = float(resumed["metric_value"])

    n_train = len(train_split)
    oom_ctrl = OomSafeBatchController(initial_batch_size=min(batch_size, max(4, n_train)), min_batch_size=4)
    loss_history: List[float] = []

    for epoch in range(start_epoch, max(1, epochs)):
        model.train()
        perm = rng.permutation(n_train)
        cursor = 0
        epoch_losses: List[float] = []

        while cursor < n_train:
            def _do_accum_step(cur_bs: int, accum_steps: int) -> float:
                optimizer.zero_grad(set_to_none=True)
                total_step_loss = 0.0
                steps_run = 0
                local_cursor = cursor
                for _ in range(accum_steps):
                    if local_cursor >= n_train:
                        break
                    batch_idx = perm[local_cursor : local_cursor + cur_bs]
                    local_cursor += len(batch_idx)
                    batch = _slice_batch_to_device(train_split, batch_idx, target_device)

                    user_vecs, user_ctx = model.encode_user_batch(batch)
                    _, cand_mol_vecs, cand_ctx = model.encode_candidate_batch(batch, prefix="pos_")
                    logits = model.scorer(
                        user_vecs,
                        cand_mol_vecs,
                        user_ctx,
                        cand_ctx,
                        use_mol=use_mol,
                    )
                    raw_loss = compute_two_tower_v3_loss(
                        logits,
                        pos_post_hashes=batch["pos_post_hashes"],
                        cand_log_q=batch["pos_log_q"],
                        sample_weights=batch["sample_weights"],
                        user_vecs=user_vecs if use_mol else None,
                        mask_in_batch_false_negatives=mask_in_batch_false_negatives,
                        apply_log_q_correction=apply_log_q_correction,
                    )
                    (raw_loss / float(accum_steps)).backward()
                    total_step_loss += float(raw_loss.item())
                    steps_run += 1

                if steps_run > 0:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                    optimizer.step()
                return total_step_loss / float(max(1, steps_run))

            step_loss = oom_ctrl.run_step_with_backoff(_do_accum_step)
            cursor += oom_ctrl.micro_batch_size * oom_ctrl.grad_accum_steps
            global_step += 1
            epoch_losses.append(step_loss)

        mean_epoch_loss = float(np.mean(epoch_losses)) if epoch_losses else 0.0
        loss_history.append(mean_epoch_loss)

        cur_metric = -mean_epoch_loss
        if val_split is not None and corpus_posts:
            c_vecs, c_pids = encode_corpus_candidates(
                model,
                corpus_posts,
                text_dim=text_dim,
                post_sid_wire_map=post_sid_wire_map,
                post_text_emb_map=post_text_emb_map,
                device=target_device,
            )
            val_metrics = evaluate_retrieval_metrics(
                model,
                val_split,
                corpus_vectors=c_vecs,
                corpus_post_ids=c_pids,
                use_mol=use_mol,
                device=target_device,
            )
            cur_metric = float(val_metrics.get("recall@50", 0.0) + 0.5 * val_metrics.get("mrr@100", 0.0))

        is_best = cur_metric > best_score
        if is_best:
            best_score = cur_metric
        if checkpoint_manager is not None:
            checkpoint_manager.save(
                step=global_step,
                epoch=epoch + 1,
                model=model,
                optimizer=optimizer,
                metric_value=cur_metric,
                is_best=is_best,
                extra={"loss": mean_epoch_loss},
            )

    eval_summary: Dict[str, Any] = {
        "final_loss": loss_history[-1] if loss_history else 0.0,
        "loss_history": loss_history,
        "oom_events": oom_ctrl.oom_events,
    }
    if val_split is not None and corpus_posts:
        c_vecs, c_pids = encode_corpus_candidates(
            model,
            corpus_posts,
            text_dim=text_dim,
            post_sid_wire_map=post_sid_wire_map,
            post_text_emb_map=post_text_emb_map,
            device=target_device,
        )
        eval_summary["val_metrics"] = evaluate_retrieval_metrics(
            model,
            val_split,
            corpus_vectors=c_vecs,
            corpus_post_ids=c_pids,
            use_mol=use_mol,
            device=target_device,
        )
    return model, eval_summary


def run_ablation_two_tower_mol(
    train_split: TwoTowerPreparedSplit,
    val_split: TwoTowerPreparedSplit,
    corpus_posts: Sequence[Mapping[str, Any]],
    *,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
    post_text_emb_map: Optional[Mapping[str, np.ndarray]] = None,
    base_config: Optional[TwoTowerV3Config] = None,
    sid_artifact: Optional[Any] = None,
    epochs: int = 5,
    batch_size: int = 64,
    seed: int = 42,
    device: Optional[str] = None,
) -> Dict[str, Any]:
    """Ablation ②：同配置同数据对比单头余弦双塔 (`use_mol=False`) vs `K=4` MoL + 假负例屏蔽 + Log-Q。"""
    cfg = base_config or TwoTowerV3Config()
    single_cfg = TwoTowerV3Config(
        hidden_dim=cfg.hidden_dim,
        embedding_dim=cfg.embedding_dim,
        num_layers=cfg.num_layers,
        num_heads=cfg.num_heads,
        num_kv_heads=cfg.num_kv_heads,
        ffn_multiplier=cfg.ffn_multiplier,
        mol_num_heads=1,
        max_history_len=cfg.max_history_len,
        post_hash_buckets=cfg.post_hash_buckets,
        author_hash_buckets=cfg.author_hash_buckets,
        time_num_buckets=cfg.time_num_buckets,
        dropout=cfg.dropout,
        use_user_embedding=False,
        enable_sid_embedder=cfg.enable_sid_embedder,
    )

    _, base_res = train_two_tower_v3(
        train_split,
        val_split=val_split,
        corpus_posts=corpus_posts,
        post_sid_wire_map=post_sid_wire_map,
        post_text_emb_map=post_text_emb_map,
        config=single_cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        use_mol=False,
        mask_in_batch_false_negatives=False,
        apply_log_q_correction=False,
        seed=seed,
        device=device,
    )
    _, mol_res = train_two_tower_v3(
        train_split,
        val_split=val_split,
        corpus_posts=corpus_posts,
        post_sid_wire_map=post_sid_wire_map,
        post_text_emb_map=post_text_emb_map,
        config=cfg,
        sid_artifact=sid_artifact,
        epochs=epochs,
        batch_size=batch_size,
        use_mol=True,
        mask_in_batch_false_negatives=True,
        apply_log_q_correction=True,
        seed=seed,
        device=device,
    )

    b_m = base_res.get("val_metrics", {})
    v_m = mol_res.get("val_metrics", {})
    return {
        "ablation": "two_tower_mol_vs_single_head",
        "baseline_single_head": b_m,
        "v3_mol_k4": v_m,
        "delta_recall_at_50": float(v_m.get("recall@50", 0.0) - b_m.get("recall@50", 0.0)),
        "delta_recall_at_100": float(v_m.get("recall@100", 0.0) - b_m.get("recall@100", 0.0)),
        "delta_mrr_at_100": float(v_m.get("mrr@100", 0.0) - b_m.get("mrr@100", 0.0)),
    }
