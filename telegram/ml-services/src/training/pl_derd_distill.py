"""Phoenix V3 多目标损失与蒸馏内核：14头 Masked BCE + CREAD-30 + Plackett-Luce Listwise + DE-RRD。

对标 x-algorithm `loss_recsys.py`（CREAD 序数离散概率与 Masked Multi-Hot BCE）
与榜样排名蒸馏最佳实践（Plackett-Luce 列表似然 + DE-RRD 头部排序强化蒸馏）。
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from src.contracts.actions import (
    ACTION_LOSS_WEIGHTS,
    CREAD_NUM_BINS,
    NUM_PREDICTED_ACTIONS,
    V3_PREDICTION_HEADS,
    WEIGHTED_SCORER_PARAMS,
    build_cread_bin_edges_ms,
    dwell_ms_to_cread_bucket,
)
from src.contracts.sid import SID_NUM_LEVELS, WIRE_MISSING_SID, wire_to_model_sids
from src.feature_adapters.history_packer import stable_id_hash_u64
from src.models.phoenix_v3 import PhoenixV3Config, PhoenixV3Model
from src.models.rq_vae_sid import RQVaeArtifact
from src.training.checkpoint_manager import CheckpointManager, OomSafeBatchController
from src.training.muon_adamw import (
    ModelEMA,
    MuonAdamW,
    clip_grad_norm_partitioned,
    compute_v3_early_stop_metric,
)


@dataclass
class PhoenixPreparedSlates:
    """分组排列表批量张量数据结构（供 Teacher 训练、Student 蒸馏及校准共同复用）。"""

    history_post_hashes: np.ndarray     # (S, H) int64
    history_author_hashes: np.ndarray   # (S, H) int64
    history_action_types: np.ndarray    # (S, H) int64
    history_time_buckets: np.ndarray    # (S, H) int64
    history_sids: np.ndarray            # (S, H, 6) int64
    history_action_masks: np.ndarray    # (S, H, 13) float32
    history_mask: np.ndarray            # (S, H) int64

    cand_post_hashes: np.ndarray        # (S, C) int64
    cand_author_hashes: np.ndarray      # (S, C) int64
    cand_sids: np.ndarray               # (S, C, 6) int64
    cand_in_network: np.ndarray         # (S, C) int64
    cand_has_video: np.ndarray          # (S, C) int64
    cand_served_position: np.ndarray    # (S, C) int64
    cand_mask: np.ndarray               # (S, C) int64

    labels_14: np.ndarray               # (S, C, 14) float32
    mask_14: np.ndarray                 # (S, C, 14) float32
    dwell_buckets: np.ndarray           # (S, C) int64
    dwell_mask: np.ndarray              # (S, C) float32
    relevance_scores: np.ndarray        # (S, C) float32
    is_random_exposure: np.ndarray      # (S, C) uint8
    user_hash_ids: List[str]            # len S
    cand_post_ids: List[List[str]]      # (S, C)

    def __len__(self) -> int:
        return self.history_post_hashes.shape[0]


def _row_relevance_utility(row: Mapping[str, Any]) -> float:
    """根据 `WEIGHTED_SCORER_PARAMS` 计算单条样本的真值连续综合效用值，作为 Listwise 排序真值。"""
    labels = row.get("action_labels") or []
    masks = row.get("action_mask") or []
    total = 0.0
    for idx in range(min(NUM_PREDICTED_ACTIONS, len(labels))):
        m = int(masks[idx]) if idx < len(masks) else 1
        if m > 0 and int(labels[idx]) > 0:
            act_name = V3_PREDICTION_HEADS[idx]
            total += float(WEIGHTED_SCORER_PARAMS.get(act_name, 1.0))
    if int(row.get("video_quality_view_mask") or 0) > 0 and int(row.get("video_quality_view_label") or 0) > 0:
        total += float(WEIGHTED_SCORER_PARAMS.get("video_quality_view", 3.0))
    if int(row.get("dwell_mask") or 0) > 0:
        dwell_sec = max(0.0, float(row.get("dwell_ms") or 0.0) / 1000.0)
        total += float(WEIGHTED_SCORER_PARAMS.get("dwell_time", 0.05)) * min(120.0, dwell_sec)
    return float(total)


def prepare_phoenix_v3_slates(
    rows: Sequence[Mapping[str, Any]],
    *,
    max_history_len: int = 128,
    max_candidates: int = 32,
    group_window_ms: int = 300_000,
    post_sid_wire_map: Optional[Mapping[str, Sequence[int]]] = None,
) -> PhoenixPreparedSlates:
    """按 `(user_hash_id, action_ts_ms // group_window_ms)` 将 PIT 样本切片打包为整齐榜单批次。"""
    groups: Dict[Tuple[str, int], List[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        uid = str(row.get("user_hash_id") or row.get("userId") or "anon")
        ts_ms = int(row.get("action_ts_ms") or 0)
        bucket = ts_ms // max(1, int(group_window_ms))
        groups[(uid, bucket)].append(row)

    # 切分过长会话到 <= max_candidates 的独立榜单槽，保持时序不跨窗泄漏
    slates: List[List[Mapping[str, Any]]] = []
    cap_c = max(1, int(max_candidates))
    for (_, _), items in groups.items():
        items_sorted = sorted(items, key=lambda r: int(r.get("action_ts_ms") or 0))
        for start in range(0, len(items_sorted), cap_c):
            slates.append(items_sorted[start : start + cap_c])

    n_slates = len(slates)
    cap_h = max(1, int(max_history_len))
    history_post_hashes = np.zeros((n_slates, cap_h), dtype=np.int64)
    history_author_hashes = np.zeros((n_slates, cap_h), dtype=np.int64)
    history_action_types = np.zeros((n_slates, cap_h), dtype=np.int64)
    history_time_buckets = np.full((n_slates, cap_h), 15, dtype=np.int64)
    history_sids = np.zeros((n_slates, cap_h, SID_NUM_LEVELS), dtype=np.int64)
    history_action_masks = np.zeros((n_slates, cap_h, NUM_PREDICTED_ACTIONS), dtype=np.float32)
    history_mask = np.zeros((n_slates, cap_h), dtype=np.int64)

    cand_post_hashes = np.zeros((n_slates, cap_c), dtype=np.int64)
    cand_author_hashes = np.zeros((n_slates, cap_c), dtype=np.int64)
    cand_sids = np.zeros((n_slates, cap_c, SID_NUM_LEVELS), dtype=np.int64)
    cand_in_network = np.zeros((n_slates, cap_c), dtype=np.int64)
    cand_has_video = np.zeros((n_slates, cap_c), dtype=np.int64)
    cand_served_position = np.zeros((n_slates, cap_c), dtype=np.int64)
    cand_mask = np.zeros((n_slates, cap_c), dtype=np.int64)

    labels_14 = np.zeros((n_slates, cap_c, NUM_PREDICTED_ACTIONS + 1), dtype=np.float32)
    mask_14 = np.zeros((n_slates, cap_c, NUM_PREDICTED_ACTIONS + 1), dtype=np.float32)
    dwell_buckets = np.zeros((n_slates, cap_c), dtype=np.int64)
    dwell_mask = np.zeros((n_slates, cap_c), dtype=np.float32)
    relevance_scores = np.zeros((n_slates, cap_c), dtype=np.float32)
    is_random_exposure = np.zeros((n_slates, cap_c), dtype=np.uint8)
    user_hash_ids: List[str] = []
    cand_post_ids: List[List[str]] = []

    cread_edges = build_cread_bin_edges_ms()

    for s_idx, slate_rows in enumerate(slates):
        # 取本组首条 PIT 记录的严格因果历史作为当前 Slate 共享上下文，杜绝同批后段动作回泄
        rep = slate_rows[0]
        user_hash_ids.append(str(rep.get("user_hash_id") or rep.get("userId") or "anon"))
        h_pids = list(rep.get("history_post_ids") or [])[-cap_h:]
        h_auths = list(rep.get("history_author_hashes") or [])[-cap_h:]
        h_acts = list(rep.get("history_action_types") or [])[-cap_h:]
        h_tbs = list(rep.get("history_time_buckets") or [])[-cap_h:]
        h_sids = list(rep.get("history_sids") or [])[-cap_h:]
        rep_mask = list(rep.get("action_mask") or [1] * NUM_PREDICTED_ACTIONS)[:NUM_PREDICTED_ACTIONS]
        if len(rep_mask) < NUM_PREDICTED_ACTIONS:
            rep_mask = rep_mask + [0] * (NUM_PREDICTED_ACTIONS - len(rep_mask))
        rep_mask_arr = np.asarray([1.0 if int(v) > 0 else 0.0 for v in rep_mask], dtype=np.float32)

        for t_idx, raw_pid in enumerate(h_pids):
            pid_s = str(raw_pid or "")
            history_post_hashes[s_idx, t_idx] = stable_id_hash_u64(pid_s)
            if t_idx < len(h_auths):
                history_author_hashes[s_idx, t_idx] = stable_id_hash_u64(h_auths[t_idx])
            if t_idx < len(h_acts):
                history_action_types[s_idx, t_idx] = max(0, int(h_acts[t_idx]))
            if t_idx < len(h_tbs):
                history_time_buckets[s_idx, t_idx] = max(0, min(15, int(h_tbs[t_idx])))

            wire_s = (
                post_sid_wire_map[pid_s]
                if post_sid_wire_map is not None and pid_s in post_sid_wire_map
                else (h_sids[t_idx] if t_idx < len(h_sids) else WIRE_MISSING_SID)
            )
            if wire_s is not None and len(wire_s) == SID_NUM_LEVELS:
                history_sids[s_idx, t_idx] = np.asarray(wire_to_model_sids(wire_s), dtype=np.int64)
            history_action_masks[s_idx, t_idx] = rep_mask_arr
            history_mask[s_idx, t_idx] = 1

        if not h_pids:
            history_mask[s_idx, 0] = 1

        row_pids: List[str] = []
        for c_idx, crow in enumerate(slate_rows):
            cpid = str(crow.get("candidate_post_id") or "")
            row_pids.append(cpid)
            cand_post_hashes[s_idx, c_idx] = stable_id_hash_u64(cpid)
            cand_author_hashes[s_idx, c_idx] = stable_id_hash_u64(crow.get("candidate_author_hash"))
            cand_in_network[s_idx, c_idx] = 1 if int(crow.get("candidate_in_network") or 0) > 0 else 0
            cand_has_video[s_idx, c_idx] = 1 if int(crow.get("candidate_has_video") or 0) > 0 else 0
            # PAL 训练位置偏移保留真实 served_position + 1（>= 1 触发 PAL，0 恒留作无偏在线推理）
            raw_pos = int(crow.get("served_position") or 0)
            cand_served_position[s_idx, c_idx] = max(1, min(127, raw_pos + 1)) if raw_pos >= 0 else 0
            cand_mask[s_idx, c_idx] = 1

            wire_c = (
                post_sid_wire_map[cpid]
                if post_sid_wire_map is not None and cpid in post_sid_wire_map
                else crow.get("candidate_sids", WIRE_MISSING_SID)
            )
            if wire_c is not None and len(wire_c) == SID_NUM_LEVELS:
                cand_sids[s_idx, c_idx] = np.asarray(wire_to_model_sids(wire_c), dtype=np.int64)

            c_labels = list(crow.get("action_labels") or [0] * NUM_PREDICTED_ACTIONS)
            c_masks = list(crow.get("action_mask") or [1] * NUM_PREDICTED_ACTIONS)
            for h_i in range(NUM_PREDICTED_ACTIONS):
                labels_14[s_idx, c_idx, h_i] = 1.0 if h_i < len(c_labels) and int(c_labels[h_i]) > 0 else 0.0
                mask_14[s_idx, c_idx, h_i] = 1.0 if h_i < len(c_masks) and int(c_masks[h_i]) > 0 else 0.0

            labels_14[s_idx, c_idx, NUM_PREDICTED_ACTIONS] = (
                1.0 if int(crow.get("video_quality_view_label") or 0) > 0 else 0.0
            )
            mask_14[s_idx, c_idx, NUM_PREDICTED_ACTIONS] = (
                1.0 if int(crow.get("video_quality_view_mask") or 0) > 0 else 0.0
            )

            d_ms = float(crow.get("dwell_ms") or 0.0)
            d_mask = int(crow.get("dwell_mask") or 0)
            dwell_buckets[s_idx, c_idx] = dwell_ms_to_cread_bucket(d_ms, cread_edges)
            dwell_mask[s_idx, c_idx] = 1.0 if d_mask > 0 else 0.0
            relevance_scores[s_idx, c_idx] = _row_relevance_utility(crow)
            is_random_exposure[s_idx, c_idx] = 1 if int(crow.get("is_random_exposure") or 0) > 0 else 0

        cand_post_ids.append(row_pids)

    return PhoenixPreparedSlates(
        history_post_hashes=history_post_hashes,
        history_author_hashes=history_author_hashes,
        history_action_types=history_action_types,
        history_time_buckets=history_time_buckets,
        history_sids=history_sids,
        history_action_masks=history_action_masks,
        history_mask=history_mask,
        cand_post_hashes=cand_post_hashes,
        cand_author_hashes=cand_author_hashes,
        cand_sids=cand_sids,
        cand_in_network=cand_in_network,
        cand_has_video=cand_has_video,
        cand_served_position=cand_served_position,
        cand_mask=cand_mask,
        labels_14=labels_14,
        mask_14=mask_14,
        dwell_buckets=dwell_buckets,
        dwell_mask=dwell_mask,
        relevance_scores=relevance_scores,
        is_random_exposure=is_random_exposure,
        user_hash_ids=user_hash_ids,
        cand_post_ids=cand_post_ids,
    )


def concat_phoenix_slates(slates_list: Sequence[PhoenixPreparedSlates]) -> PhoenixPreparedSlates:
    """在榜单维度拼接多个 `PhoenixPreparedSlates`，保留每个 Slate 内部候选隔离边界。"""
    valid = [s for s in slates_list if len(s) > 0]
    if not valid:
        raise ValueError("concat_phoenix_slates requires at least one non-empty PhoenixPreparedSlates")
    if len(valid) == 1:
        return valid[0]
    return PhoenixPreparedSlates(
        history_post_hashes=np.concatenate([s.history_post_hashes for s in valid], axis=0),
        history_author_hashes=np.concatenate([s.history_author_hashes for s in valid], axis=0),
        history_action_types=np.concatenate([s.history_action_types for s in valid], axis=0),
        history_time_buckets=np.concatenate([s.history_time_buckets for s in valid], axis=0),
        history_sids=np.concatenate([s.history_sids for s in valid], axis=0),
        history_action_masks=np.concatenate([s.history_action_masks for s in valid], axis=0),
        history_mask=np.concatenate([s.history_mask for s in valid], axis=0),
        cand_post_hashes=np.concatenate([s.cand_post_hashes for s in valid], axis=0),
        cand_author_hashes=np.concatenate([s.cand_author_hashes for s in valid], axis=0),
        cand_sids=np.concatenate([s.cand_sids for s in valid], axis=0),
        cand_in_network=np.concatenate([s.cand_in_network for s in valid], axis=0),
        cand_has_video=np.concatenate([s.cand_has_video for s in valid], axis=0),
        cand_served_position=np.concatenate([s.cand_served_position for s in valid], axis=0),
        cand_mask=np.concatenate([s.cand_mask for s in valid], axis=0),
        labels_14=np.concatenate([s.labels_14 for s in valid], axis=0),
        mask_14=np.concatenate([s.mask_14 for s in valid], axis=0),
        dwell_buckets=np.concatenate([s.dwell_buckets for s in valid], axis=0),
        dwell_mask=np.concatenate([s.dwell_mask for s in valid], axis=0),
        relevance_scores=np.concatenate([s.relevance_scores for s in valid], axis=0),
        is_random_exposure=np.concatenate([s.is_random_exposure for s in valid], axis=0),
        user_hash_ids=[uid for s in valid for uid in s.user_hash_ids],
        cand_post_ids=[pids for s in valid for pids in s.cand_post_ids],
    )


def _slice_slates_to_device(
    slates: PhoenixPreparedSlates,
    indices: np.ndarray,
    device: torch.device,
) -> Dict[str, torch.Tensor]:
    idx = np.asarray(indices, dtype=np.int64)
    return {
        "history_post_hashes": torch.from_numpy(slates.history_post_hashes[idx]).to(device),
        "history_author_hashes": torch.from_numpy(slates.history_author_hashes[idx]).to(device),
        "history_action_types": torch.from_numpy(slates.history_action_types[idx]).to(device),
        "history_time_buckets": torch.from_numpy(slates.history_time_buckets[idx]).to(device),
        "history_sids": torch.from_numpy(slates.history_sids[idx]).to(device),
        "history_action_masks": torch.from_numpy(slates.history_action_masks[idx]).to(device),
        "history_mask": torch.from_numpy(slates.history_mask[idx]).to(device),
        "cand_post_hashes": torch.from_numpy(slates.cand_post_hashes[idx]).to(device),
        "cand_author_hashes": torch.from_numpy(slates.cand_author_hashes[idx]).to(device),
        "cand_sids": torch.from_numpy(slates.cand_sids[idx]).to(device),
        "cand_in_network": torch.from_numpy(slates.cand_in_network[idx]).to(device),
        "cand_has_video": torch.from_numpy(slates.cand_has_video[idx]).to(device),
        "cand_served_position": torch.from_numpy(slates.cand_served_position[idx]).to(device),
        "cand_mask": torch.from_numpy(slates.cand_mask[idx]).to(device),
        "labels_14": torch.from_numpy(slates.labels_14[idx]).to(device),
        "mask_14": torch.from_numpy(slates.mask_14[idx]).to(device),
        "dwell_buckets": torch.from_numpy(slates.dwell_buckets[idx]).to(device),
        "dwell_mask": torch.from_numpy(slates.dwell_mask[idx]).to(device),
        "relevance_scores": torch.from_numpy(slates.relevance_scores[idx]).to(device),
    }


def _forward_model_on_batch(
    model: PhoenixV3Model,
    batch: Mapping[str, torch.Tensor],
    *,
    apply_pal: bool = True,
) -> Dict[str, torch.Tensor]:
    return model.forward_with_details(
        history_post_hashes=batch["history_post_hashes"],
        history_author_hashes=batch["history_author_hashes"],
        history_action_types=batch["history_action_types"],
        history_time_buckets=batch["history_time_buckets"],
        history_sids=batch["history_sids"],
        history_action_masks=batch["history_action_masks"],
        history_mask=batch["history_mask"],
        cand_post_hashes=batch["cand_post_hashes"],
        cand_author_hashes=batch["cand_author_hashes"],
        cand_sids=batch["cand_sids"],
        cand_in_network=batch["cand_in_network"],
        cand_has_video=batch["cand_has_video"],
        cand_served_position=batch["cand_served_position"],
        cand_mask=batch["cand_mask"],
        apply_pal=apply_pal,
    )


def compute_masked_14head_bce(
    action_logits: torch.Tensor,  # (B, C, 14)
    labels_14: torch.Tensor,      # (B, C, 14)
    mask_14: torch.Tensor,        # (B, C, 14)
    cand_mask: torch.Tensor,      # (B, C)
) -> torch.Tensor:
    """按 `ACTION_LOSS_WEIGHTS` 与 `action_mask * cand_mask` 计算 14 头掩码加权二元交叉熵。"""
    head_weights = torch.tensor(
        [float(ACTION_LOSS_WEIGHTS.get(h, 1.0)) for h in V3_PREDICTION_HEADS],
        device=action_logits.device,
        dtype=action_logits.dtype,
    ).view(1, 1, -1)

    eff_mask = mask_14 * cand_mask.to(dtype=action_logits.dtype).unsqueeze(-1)
    bce = F.binary_cross_entropy_with_logits(action_logits, labels_14, reduction="none")
    weighted_mask = eff_mask * head_weights
    denom = weighted_mask.sum().clamp_min(1.0)
    return (bce * weighted_mask).sum() / denom


def compute_cread30_loss(
    cread_logits: torch.Tensor,   # (B, C, 30)
    dwell_buckets: torch.Tensor,  # (B, C) int64
    dwell_mask: torch.Tensor,     # (B, C) float
    cand_mask: torch.Tensor,      # (B, C) int64
    *,
    ordinal_weight: float = 0.5,
) -> torch.Tensor:
    """x-algorithm 风格 CREAD-30 序数离散分布损失：分桶交叉熵 + 累计生存 CDF 二元交叉熵。"""
    eff_mask = dwell_mask.to(dtype=cread_logits.dtype) * cand_mask.to(dtype=cread_logits.dtype)
    valid_count = eff_mask.sum()
    if float(valid_count.detach().item()) < 0.5:
        return cread_logits.new_zeros(())

    num_bins = cread_logits.shape[-1]
    ce = F.cross_entropy(
        cread_logits.view(-1, num_bins),
        dwell_buckets.clamp(0, num_bins - 1).view(-1),
        reduction="none",
    ).view_as(eff_mask)
    ce_loss = (ce * eff_mask).sum() / valid_count.clamp_min(1.0)

    # 序数累加阈值惩罚：P(Y >= k) = sum_{j=k}^{29} softmax(logits)_j
    probs = torch.softmax(cread_logits, dim=-1)  # (B, C, 30)
    surv_probs = torch.flip(torch.cumsum(torch.flip(probs, dims=[-1]), dim=-1), dims=[-1])[..., 1:]  # (B, C, 29)
    surv_probs = surv_probs.clamp(1e-6, 1.0 - 1e-6)
    thresholds = torch.arange(1, num_bins, device=cread_logits.device, dtype=torch.long).view(1, 1, -1)
    surv_targets = (dwell_buckets.unsqueeze(-1) >= thresholds).to(dtype=cread_logits.dtype)
    ord_bce = -(surv_targets * torch.log(surv_probs) + (1.0 - surv_targets) * torch.log(1.0 - surv_probs))
    ord_loss = (ord_bce.mean(dim=-1) * eff_mask).sum() / valid_count.clamp_min(1.0)
    return ce_loss + ordinal_weight * ord_loss


def compute_scalar_rank_utility(
    action_logits: torch.Tensor,  # (B, C, 14)
    cread_logits: torch.Tensor,   # (B, C, 30)
    *,
    cread_edges_ms: Optional[Sequence[float]] = None,
) -> torch.Tensor:
    """按线上加权打分器契约计算单列可微综合排序效用得分 `(B, C)`，供 PL 与 DE-RRD 使用。"""
    head_utils = torch.tensor(
        [float(WEIGHTED_SCORER_PARAMS.get(h, 0.0)) for h in V3_PREDICTION_HEADS],
        device=action_logits.device,
        dtype=action_logits.dtype,
    ).view(1, 1, -1)
    action_probs = torch.sigmoid(action_logits)
    utility = torch.sum(action_probs * head_utils, dim=-1)  # (B, C)

    edges = cread_edges_ms if cread_edges_ms is not None else build_cread_bin_edges_ms()
    mids_sec = torch.tensor(
        [0.5 * (edges[i] + edges[i + 1]) / 1000.0 for i in range(len(edges) - 1)],
        device=cread_logits.device,
        dtype=cread_logits.dtype,
    ).view(1, 1, -1)
    cread_probs = torch.softmax(cread_logits, dim=-1)
    expected_dwell_sec = torch.sum(cread_probs * mids_sec, dim=-1)
    dwell_w = float(WEIGHTED_SCORER_PARAMS.get("dwell_time", 0.05))
    return utility + dwell_w * torch.log1p(expected_dwell_sec.clamp_min(0.0))


def compute_plackett_luce_loss(
    rank_scores: torch.Tensor,       # (B, C)
    relevance_scores: torch.Tensor,  # (B, C)
    cand_mask: torch.Tensor,         # (B, C)
    *,
    tau: float = 1.0,
) -> torch.Tensor:
    """Plackett-Luce Listwise 排序似然损失：仅对包含 >=2 个有效候选的榜单计算有序排列对数似然。"""
    valid = cand_mask > 0
    valid_counts = valid.sum(dim=1)
    has_slate = valid_counts >= 2
    if not bool(has_slate.any()):
        return rank_scores.new_zeros(())

    rel = relevance_scores[has_slate]
    scores = rank_scores[has_slate] / max(1e-3, float(tau))
    mask = valid[has_slate]

    # 按真值效用降序重排每个榜单，未填充槽位沉底
    sort_key = rel.masked_fill(~mask, -1e9)
    order = torch.argsort(sort_key, dim=-1, descending=True)
    sorted_scores = torch.gather(scores, 1, order)
    sorted_rel = torch.gather(rel, 1, order)
    sorted_mask = torch.gather(mask, 1, order)

    # 使用后缀对数和稳健求得每一跳的归一化分母: log sum_{j >= t, valid} exp(s_j)
    masked_s = sorted_scores.masked_fill(~sorted_mask, -1e9)
    max_s = torch.max(masked_s, dim=-1, keepdim=True).values.clamp(min=-1e4, max=1e4)
    exp_s = torch.exp((masked_s - max_s).clamp(max=20.0)) * sorted_mask.to(dtype=scores.dtype)
    suffix_exp = torch.flip(torch.cumsum(torch.flip(exp_s, dims=[-1]), dim=-1), dims=[-1])
    log_denom = max_s + torch.log(suffix_exp.clamp_min(1e-12))

    # 仅对拥有严格正相关性差值 (rel > min_rel 或 rel > 0) 的主排名位置累计梯度
    active_pos = sorted_mask & (sorted_rel > 0.0)
    # 同时排除最后一个有效元素（单候选分母=分子，对数似然恒 0）
    suffix_valid_count = torch.flip(
        torch.cumsum(torch.flip(sorted_mask.to(torch.long), dims=[-1]), dim=-1),
        dims=[-1],
    )
    active_pos = active_pos & (suffix_valid_count >= 2)
    if not bool(active_pos.any()):
        return rank_scores.new_zeros(())

    pl_nll = -(sorted_scores - log_denom)
    return (pl_nll * active_pos.to(dtype=scores.dtype)).sum() / active_pos.sum().clamp_min(1).to(dtype=scores.dtype)


def compute_de_rrd_distill_loss(
    *,
    student_action_logits: torch.Tensor,  # (B, C, 14)
    student_cread_logits: torch.Tensor,   # (B, C, 30)
    teacher_action_logits: torch.Tensor,  # (B, C, 14)
    teacher_cread_logits: torch.Tensor,   # (B, C, 30)
    student_scores: torch.Tensor,         # (B, C)
    teacher_scores: torch.Tensor,         # (B, C)
    cand_mask: torch.Tensor,              # (B, C)
    mask_14: torch.Tensor,                # (B, C, 14)
    temperature: float = 2.0,
    top_k_emphasis: int = 5,
) -> torch.Tensor:
    """DE-RRD 精排蒸馏损失：14头 Logit KL/MSE + CREAD 分布 KL + 头部 Relaxed Top-K 序保真蒸馏。"""
    t = max(0.5, float(temperature))
    cm_f = cand_mask.to(dtype=student_action_logits.dtype)
    eff_head_mask = mask_14 * cm_f.unsqueeze(-1)

    # 1) 14 头逐概率软目标蒸馏（BCE over teacher sigmoid + 轻微 Logit MSE）
    with torch.no_grad():
        t_action_probs = torch.sigmoid(teacher_action_logits / t)
        t_cread_probs = torch.softmax(teacher_cread_logits / t, dim=-1)

    head_kl = F.binary_cross_entropy_with_logits(
        student_action_logits / t,
        t_action_probs,
        reduction="none",
    ) * (t * t)
    logit_mse = (student_action_logits - teacher_action_logits.detach()) ** 2
    action_distill = ((0.7 * head_kl + 0.3 * logit_mse) * eff_head_mask).sum() / eff_head_mask.sum().clamp_min(1.0)

    # 2) CREAD-30 连续停留分布蒸馏
    s_cread_logp = F.log_softmax(student_cread_logits / t, dim=-1)
    cread_kl = F.kl_div(s_cread_logp, t_cread_probs, reduction="none").sum(dim=-1) * (t * t)
    cread_distill = (cread_kl * cm_f).sum() / cm_f.sum().clamp_min(1.0)

    # 3) DE-RRD Relaxed Rank Emphasis Listwise KL：加权强化 Teacher 前 K 位高价值候选序对齐
    valid = cand_mask > 0
    has_slate = valid.sum(dim=1) >= 2
    list_distill = student_action_logits.new_zeros(())
    if bool(has_slate.any()):
        t_sc = teacher_scores[has_slate].detach()
        s_sc = student_scores[has_slate]
        m_sc = valid[has_slate]

        order = torch.argsort(t_sc.masked_fill(~m_sc, -1e9), dim=-1, descending=True)
        ranks = torch.zeros_like(order, dtype=s_sc.dtype)
        rank_vals = torch.arange(order.shape[1], device=s_sc.device, dtype=s_sc.dtype).unsqueeze(0).expand_as(order)
        ranks.scatter_(1, order, rank_vals)
        # 排名前 top_k_emphasis 位获得最高蒸馏权重，尾部平滑衰减
        rank_emphasis = 1.0 + torch.exp(-ranks / float(max(1, top_k_emphasis)))

        t_logits_masked = (t_sc / t).masked_fill(~m_sc, -1e9)
        s_logits_masked = (s_sc / t).masked_fill(~m_sc, -1e9)
        t_list_p = torch.softmax(t_logits_masked, dim=-1) * rank_emphasis
        t_list_p = t_list_p / t_list_p.sum(dim=-1, keepdim=True).clamp_min(1e-9)
        s_list_logp = F.log_softmax(s_logits_masked, dim=-1)
        list_distill = (-(t_list_p * s_list_logp).sum(dim=-1)).mean() * (t * t)

    return action_distill + 0.3 * cread_distill + 0.5 * list_distill


@torch.no_grad()
def evaluate_phoenix_v3_slates(
    model: PhoenixV3Model,
    slates: PhoenixPreparedSlates,
    *,
    batch_size: int = 64,
    device: Optional[torch.device] = None,
) -> Dict[str, Any]:
    """在验证切片上以无偏推理态（`cand_served_position=0` / PAL 归零）计算早停指标并返回原始 logits。"""
    model.eval()
    target_device = device or next(model.parameters()).device
    n = len(slates)
    if n == 0:
        return {"early_stop_score": 0.5, "unbiased_macro_roc_auc": 0.5, "negative_auc": 0.5}

    all_probs = []
    all_logits = []
    all_cread_logits = []
    use_amp = target_device.type == "cuda" and torch.cuda.is_bf16_supported()
    for start in range(0, n, batch_size):
        idx = np.arange(start, min(n, start + batch_size))
        batch = _slice_slates_to_device(slates, idx, target_device)
        batch["cand_served_position"] = torch.zeros_like(batch["cand_served_position"])
        with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=use_amp):
            out = _forward_model_on_batch(model, batch, apply_pal=False)
        act_f = out["action_logits"].detach().float()
        cread_f = out["cread_logits"].detach().float()
        all_logits.append(act_f.cpu().numpy())
        all_cread_logits.append(cread_f.cpu().numpy())
        all_probs.append(torch.sigmoid(act_f).cpu().numpy())

    logits_np = np.concatenate(all_logits, axis=0)      # (S, C, 14)
    cread_np = np.concatenate(all_cread_logits, axis=0) # (S, C, 30)
    probs_np = np.concatenate(all_probs, axis=0)        # (S, C, 14)

    cm = slates.cand_mask > 0
    flat_probs = probs_np[cm]
    flat_labels = slates.labels_14[cm]
    flat_masks = slates.mask_14[cm]
    flat_rand = slates.is_random_exposure[cm]

    metrics = compute_v3_early_stop_metric(
        flat_probs,
        flat_labels,
        flat_masks,
        is_random_exposure=flat_rand,
    )
    metrics["flat_logits"] = logits_np[cm]
    metrics["flat_probs"] = flat_probs
    metrics["flat_labels"] = flat_labels
    metrics["flat_masks"] = flat_masks
    metrics["flat_cread_logits"] = cread_np[cm]
    return metrics


def train_phoenix_v3_teacher(
    train_slates: PhoenixPreparedSlates,
    *,
    val_slates: Optional[PhoenixPreparedSlates] = None,
    config: Optional[PhoenixV3Config] = None,
    sid_artifact: Optional[RQVaeArtifact] = None,
    epochs: int = 8,
    batch_size: int = 32,
    lr: float = 3e-4,
    muon_lr_multiplier: float = 8.0,
    use_muon: bool = True,
    pl_weight: float = 0.25,
    cread_weight: float = 0.35,
    ema_decay: float = 0.99,
    use_bf16_amp: bool = True,
    checkpoint_manager: Optional[CheckpointManager] = None,
    init_model: Optional[PhoenixV3Model] = None,
    seed: int = 42,
    device: Optional[str] = None,
) -> Tuple[PhoenixV3Model, Dict[str, Any]]:
    """训练 Phoenix V3 Teacher（支持从 Stage 3A `init_model` 继续微调 + Muon+AdamW + EMA + PL + CREAD-30 + PAL）。"""
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    target_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    if target_device.type == "cuda":
        torch.set_float32_matmul_precision("high")
    amp_enabled = bool(use_bf16_amp and target_device.type == "cuda" and torch.cuda.is_bf16_supported())

    cfg = init_model.config if init_model is not None else (config or PhoenixV3Config.teacher_preset())
    model = (init_model if init_model is not None else PhoenixV3Model(cfg, sid_artifact=sid_artifact)).to(target_device)

    optimizer: torch.optim.Optimizer
    if use_muon:
        optimizer = MuonAdamW.from_model(model, lr=lr, muon_lr_multiplier=muon_lr_multiplier, weight_decay=0.01)
    else:
        optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)

    ema = ModelEMA(model, decay=ema_decay)
    start_epoch = 0
    global_step = 0
    best_score = -1.0
    if checkpoint_manager is not None:
        resumed = checkpoint_manager.resume_latest(model, optimizer=optimizer, ema=ema, map_location=target_device)
        if resumed is not None:
            start_epoch = int(resumed.get("epoch", 0))
            global_step = int(resumed.get("step", 0))
            if resumed.get("metric_value") is not None:
                best_score = float(resumed["metric_value"])

    n_train = len(train_slates)
    oom_ctrl = OomSafeBatchController(initial_batch_size=min(batch_size, max(2, n_train)), min_batch_size=2)
    cread_edges = build_cread_bin_edges_ms()
    history_logs: List[Dict[str, float]] = []

    for epoch in range(start_epoch, max(1, epochs)):
        model.train()
        perm = rng.permutation(n_train)
        cursor = 0
        losses: List[float] = []

        while cursor < n_train:
            def _accum_step(cur_bs: int, accum_steps: int) -> float:
                optimizer.zero_grad(set_to_none=True)
                acc_loss = 0.0
                ran = 0
                local_cur = cursor
                for _ in range(accum_steps):
                    if local_cur >= n_train:
                        break
                    b_idx = perm[local_cur : local_cur + cur_bs]
                    local_cur += len(b_idx)
                    batch = _slice_slates_to_device(train_slates, b_idx, target_device)

                    with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=amp_enabled):
                        out = _forward_model_on_batch(model, batch, apply_pal=True)
                        debiased_out = (
                            out
                            if pl_weight <= 0.0
                            else _forward_model_on_batch(
                                model,
                                {**batch, "cand_served_position": torch.zeros_like(batch["cand_served_position"])},
                                apply_pal=False,
                            )
                        )
                    bce_loss = compute_masked_14head_bce(
                        out["action_logits"].float(), batch["labels_14"], batch["mask_14"], batch["cand_mask"]
                    )
                    c_loss = compute_cread30_loss(
                        out["cread_logits"].float(), batch["dwell_buckets"], batch["dwell_mask"], batch["cand_mask"]
                    )
                    # Listwise 排序在剔除 PAL 位置偏置后的无偏分数上计算，避免位置偏差污染主序
                    rank_sc = compute_scalar_rank_utility(
                        debiased_out["action_logits"].float(),
                        debiased_out["cread_logits"].float(),
                        cread_edges_ms=cread_edges,
                    )
                    pl_loss = compute_plackett_luce_loss(rank_sc, batch["relevance_scores"], batch["cand_mask"])
                    total = bce_loss + cread_weight * c_loss + pl_weight * pl_loss
                    (total / float(accum_steps)).backward()
                    acc_loss += float(total.item())
                    ran += 1

                if ran > 0:
                    if isinstance(optimizer, MuonAdamW):
                        clip_grad_norm_partitioned(optimizer, max_norm=1.0)
                    else:
                        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                    optimizer.step()
                    ema.update(model)
                return acc_loss / float(max(1, ran))

            losses.append(oom_ctrl.run_step_with_backoff(_accum_step))
            cursor += oom_ctrl.micro_batch_size * oom_ctrl.grad_accum_steps
            global_step += 1

        mean_loss = float(np.mean(losses)) if losses else 0.0
        val_score = -mean_loss
        epoch_info: Dict[str, float] = {"epoch": float(epoch + 1), "train_loss": mean_loss}

        if val_slates is not None and len(val_slates) > 0:
            with ema.use_ema(model):
                val_res = evaluate_phoenix_v3_slates(
                    model, val_slates, batch_size=max(64, batch_size), device=target_device
                )
            val_score = float(val_res["early_stop_score"])
            epoch_info["early_stop_score"] = val_score
            epoch_info["unbiased_macro_roc_auc"] = float(val_res["unbiased_macro_roc_auc"])
            epoch_info["negative_auc"] = float(val_res["negative_auc"])

        history_logs.append(epoch_info)
        is_best = val_score > best_score
        if is_best:
            best_score = val_score
        if checkpoint_manager is not None:
            checkpoint_manager.save(
                step=global_step,
                epoch=epoch + 1,
                model=model,
                optimizer=optimizer,
                ema=ema,
                metric_value=val_score,
                is_best=is_best,
                extra=epoch_info,
            )

    # 结束后应用 EMA 稳定权重作为最终模型产出
    ema.apply_shadow(model)
    final_eval = (
        evaluate_phoenix_v3_slates(model, val_slates, batch_size=max(64, batch_size), device=target_device)
        if val_slates is not None and len(val_slates) > 0
        else {}
    )
    summary = {
        "final_loss": history_logs[-1]["train_loss"] if history_logs else 0.0,
        "best_early_stop_score": best_score,
        "history": history_logs,
        "val_metrics": {k: v for k, v in final_eval.items() if isinstance(v, float)},
    }
    return model, summary


def distill_phoenix_v3_student(
    train_slates: PhoenixPreparedSlates,
    *,
    teacher_model: Optional[PhoenixV3Model] = None,
    val_slates: Optional[PhoenixPreparedSlates] = None,
    student_config: Optional[PhoenixV3Config] = None,
    sid_artifact: Optional[RQVaeArtifact] = None,
    epochs: int = 8,
    batch_size: int = 32,
    lr: float = 4e-4,
    distill_weight: float = 0.6,
    pl_weight: float = 0.25,
    cread_weight: float = 0.35,
    temperature: float = 2.0,
    use_muon: bool = True,
    use_bf16_amp: bool = True,
    checkpoint_manager: Optional[CheckpointManager] = None,
    seed: int = 42,
    device: Optional[str] = None,
) -> Tuple[PhoenixV3Model, Dict[str, Any]]:
    """使用 Teacher 指导 Student 训练，联合优化硬真值 + DE-RRD 排序蒸馏 + Plackett-Luce。"""
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    target_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    if target_device.type == "cuda":
        torch.set_float32_matmul_precision("high")
    amp_enabled = bool(use_bf16_amp and target_device.type == "cuda" and torch.cuda.is_bf16_supported())

    s_cfg = student_config or PhoenixV3Config.student_preset()
    student = PhoenixV3Model(s_cfg, sid_artifact=sid_artifact).to(target_device)

    if teacher_model is not None:
        teacher_model = teacher_model.to(target_device)
        teacher_model.eval()
        for p in teacher_model.parameters():
            p.requires_grad_(False)

    optimizer: torch.optim.Optimizer
    if use_muon:
        optimizer = MuonAdamW.from_model(student, lr=lr, muon_lr_multiplier=8.0, weight_decay=0.01)
    else:
        optimizer = torch.optim.AdamW(student.parameters(), lr=lr, weight_decay=0.01)

    ema = ModelEMA(student, decay=0.995)
    start_epoch = 0
    global_step = 0
    best_score = -1.0
    if checkpoint_manager is not None:
        resumed = checkpoint_manager.resume_latest(student, optimizer=optimizer, ema=ema, map_location=target_device)
        if resumed is not None:
            start_epoch = int(resumed.get("epoch", 0))
            global_step = int(resumed.get("step", 0))
            if resumed.get("metric_value") is not None:
                best_score = float(resumed["metric_value"])

    n_train = len(train_slates)
    oom_ctrl = OomSafeBatchController(initial_batch_size=min(batch_size, max(2, n_train)), min_batch_size=2)
    cread_edges = build_cread_bin_edges_ms()
    history_logs: List[Dict[str, float]] = []

    for epoch in range(start_epoch, max(1, epochs)):
        student.train()
        perm = rng.permutation(n_train)
        cursor = 0
        losses: List[float] = []

        while cursor < n_train:
            def _accum_distill(cur_bs: int, accum_steps: int) -> float:
                optimizer.zero_grad(set_to_none=True)
                acc_loss = 0.0
                ran = 0
                local_cur = cursor
                for _ in range(accum_steps):
                    if local_cur >= n_train:
                        break
                    b_idx = perm[local_cur : local_cur + cur_bs]
                    local_cur += len(b_idx)
                    batch = _slice_slates_to_device(train_slates, b_idx, target_device)

                    # 1) 训练期允许 PAL 学习位置偏差以清洗主干特征
                    debiased_batch = {**batch, "cand_served_position": torch.zeros_like(batch["cand_served_position"])}
                    with torch.amp.autocast("cuda", dtype=torch.bfloat16, enabled=amp_enabled):
                        out_pal = _forward_model_on_batch(student, batch, apply_pal=True)
                        # 2) 无偏推理分支（served_position=0）与 Teacher 软排名对齐
                        out_deb = _forward_model_on_batch(student, debiased_batch, apply_pal=False)
                        t_out: Optional[Dict[str, torch.Tensor]] = None
                        if teacher_model is not None and distill_weight > 0.0:
                            with torch.no_grad():
                                t_out = _forward_model_on_batch(teacher_model, debiased_batch, apply_pal=False)

                    bce_loss = compute_masked_14head_bce(
                        out_pal["action_logits"].float(), batch["labels_14"], batch["mask_14"], batch["cand_mask"]
                    )
                    c_loss = compute_cread30_loss(
                        out_pal["cread_logits"].float(), batch["dwell_buckets"], batch["dwell_mask"], batch["cand_mask"]
                    )

                    s_act_f = out_deb["action_logits"].float()
                    s_cread_f = out_deb["cread_logits"].float()
                    s_scores = compute_scalar_rank_utility(
                        s_act_f, s_cread_f, cread_edges_ms=cread_edges
                    )
                    pl_loss = compute_plackett_luce_loss(s_scores, batch["relevance_scores"], batch["cand_mask"])

                    total = bce_loss + cread_weight * c_loss + pl_weight * pl_loss
                    if t_out is not None:
                        t_act_f = t_out["action_logits"].float()
                        t_cread_f = t_out["cread_logits"].float()
                        t_scores = compute_scalar_rank_utility(
                            t_act_f, t_cread_f, cread_edges_ms=cread_edges
                        )
                        derd_loss = compute_de_rrd_distill_loss(
                            student_action_logits=s_act_f,
                            student_cread_logits=s_cread_f,
                            teacher_action_logits=t_act_f,
                            teacher_cread_logits=t_cread_f,
                            student_scores=s_scores,
                            teacher_scores=t_scores,
                            cand_mask=batch["cand_mask"],
                            mask_14=batch["mask_14"],
                            temperature=temperature,
                        )
                        total = total + distill_weight * derd_loss

                    (total / float(accum_steps)).backward()
                    acc_loss += float(total.item())
                    ran += 1

                if ran > 0:
                    if isinstance(optimizer, MuonAdamW):
                        clip_grad_norm_partitioned(optimizer, max_norm=1.0)
                    else:
                        torch.nn.utils.clip_grad_norm_(student.parameters(), max_norm=1.0)
                    optimizer.step()
                    ema.update(student)
                return acc_loss / float(max(1, ran))

            losses.append(oom_ctrl.run_step_with_backoff(_accum_distill))
            cursor += oom_ctrl.micro_batch_size * oom_ctrl.grad_accum_steps
            global_step += 1

        mean_loss = float(np.mean(losses)) if losses else 0.0
        val_score = -mean_loss
        ep_info: Dict[str, float] = {"epoch": float(epoch + 1), "train_loss": mean_loss}

        if val_slates is not None and len(val_slates) > 0:
            with ema.use_ema(student):
                val_res = evaluate_phoenix_v3_slates(
                    student, val_slates, batch_size=max(64, batch_size), device=target_device
                )
            val_score = float(val_res["early_stop_score"])
            ep_info["early_stop_score"] = val_score
            ep_info["unbiased_macro_roc_auc"] = float(val_res["unbiased_macro_roc_auc"])
            ep_info["negative_auc"] = float(val_res["negative_auc"])

        history_logs.append(ep_info)
        is_best = val_score > best_score
        if is_best:
            best_score = val_score
        if checkpoint_manager is not None:
            checkpoint_manager.save(
                step=global_step,
                epoch=epoch + 1,
                model=student,
                optimizer=optimizer,
                ema=ema,
                metric_value=val_score,
                is_best=is_best,
                extra=ep_info,
            )

    ema.apply_shadow(student)
    final_eval = (
        evaluate_phoenix_v3_slates(student, val_slates, batch_size=max(64, batch_size), device=target_device)
        if val_slates is not None and len(val_slates) > 0
        else {}
    )
    return student, {
        "final_loss": history_logs[-1]["train_loss"] if history_logs else 0.0,
        "best_early_stop_score": best_score,
        "history": history_logs,
        "val_metrics": {k: v for k, v in final_eval.items() if isinstance(v, float)},
    }
