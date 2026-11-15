"""V3 统一网络超参、码本规格与 ONNX 导出输入输出签名规范。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Tuple

from src.contracts.actions import CREAD_NUM_BINS, NUM_PREDICTED_ACTIONS
from src.contracts.sid import SID_CODEBOOK_SIZE, SID_NUM_LEVELS


@dataclass(frozen=True)
class V3RQVaeSpec:
    """6x256 Semantic ID 残差量化自编码器规格（Phase 28B Stage 1 训练实现）。"""

    input_dim: int = 768
    latent_dim: int = 256
    num_levels: int = SID_NUM_LEVELS
    codebook_size: int = SID_CODEBOOK_SIZE
    ema_decay: float = 0.99
    commitment_cost: float = 0.25


@dataclass(frozen=True)
class V3TwoTowerSpec:
    """无 ID MoL 双塔 V3 规格（Phase 28B Stage 2 训练与导出）。"""

    use_user_embedding: bool = False
    semantic_dim: int = 256
    output_dim: int = 256
    mol_num_heads: int = 4
    max_history_len: int = 128
    sid_levels: int = SID_NUM_LEVELS
    sid_codebook_size: int = SID_CODEBOOK_SIZE
    onnx_input_names: Tuple[str, ...] = (
        "history_post_hashes",
        "history_author_hashes",
        "history_action_types",
        "history_time_buckets",
        "history_sids",
        "history_action_masks",
        "attention_mask",
    )


@dataclass(frozen=True)
class V3PhoenixSpec:
    """Phoenix V3 Teacher/Student 网络与 ONNX 导出接口契约（Phase 28C 实现）。"""

    teacher_dim: int = 512
    student_dim: int = 256
    num_binary_heads: int = NUM_PREDICTED_ACTIONS + 1  # 13 core + video_quality_view
    cread_num_bins: int = CREAD_NUM_BINS
    max_history_len: int = 128
    max_candidates: int = 64
    num_shared_experts: int = 2
    num_task_groups: int = 3
    onnx_input_names: Tuple[str, ...] = field(
        default_factory=lambda: (
            "history_post_hashes",
            "history_author_hashes",
            "history_action_types",
            "history_time_buckets",
            "history_sids",
            "history_action_masks",
            "history_mask",
            "cand_post_hashes",
            "cand_author_hashes",
            "cand_sids",
            "cand_in_network",
            "cand_has_video",
            "cand_served_position",
            "cand_mask",
        )
    )
    onnx_output_names: Tuple[str, ...] = ("action_logits", "cread_logits")
