"""Phoenix V3 精排 Teacher/Student 双规格模型（GQA + SwiGLU + HSTU rab + CandidateOnlyAttention + 3-Expert PLE + PAL + 14头 + CREAD-30）。

严格对标 x-algorithm `recsys_attention.py`、`loss_recsys.py` 与 `V3PhoenixSpec` 14 张量契约：
- 严禁候选间相互 Attention（Candidate Isolation）；末 `num_cand_only_layers` 层采用 O(C*(H+1)) 仅候选注意力；
- `cand_served_position == 0` 在推理期将 PAL 位置偏差分支严格归零；
- 所有 ONNX 前向计算仅用标准矩阵与切片算子，完全兼容 `opset_version=17, dynamo=False` 导出与 INT8 量化。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from src.contracts.actions import CREAD_NUM_BINS, NUM_ACTION_TYPES, NUM_PREDICTED_ACTIONS
from src.models.rq_vae_sid import RQVaeArtifact, SidEntityEmbedder
from src.models.two_tower_v3 import _RMSNorm


@dataclass(frozen=True)
class PhoenixV3Config:
    """Phoenix V3 Teacher / Student 统一配置（通过 factory preset 或单测微型规格构造）。"""

    dim: int = 256
    num_layers: int = 6
    num_cand_only_layers: int = 2
    num_heads: int = 8
    num_kv_heads: int = 2
    ffn_multiplier: float = 2.6667
    max_history_len: int = 128
    max_candidates: int = 64
    max_served_positions: int = 128
    post_hash_buckets: int = 65536
    author_hash_buckets: int = 16384
    time_num_buckets: int = 16
    num_shared_experts: int = 2
    num_task_groups: int = 3  # 0: 正向交互, 1: 负向反馈, 2: CREAD-30 连续停留
    num_binary_heads: int = NUM_PREDICTED_ACTIONS + 1  # 13 core + video_quality_view = 14
    cread_num_bins: int = CREAD_NUM_BINS
    rab_num_buckets: int = 32
    dropout: float = 0.05
    enable_sid_embedder: bool = True

    def __post_init__(self) -> None:
        if self.dim % self.num_heads != 0:
            raise ValueError(f"dim={self.dim} must be divisible by num_heads={self.num_heads}")
        if self.num_heads % self.num_kv_heads != 0:
            raise ValueError(f"num_heads={self.num_heads} must be divisible by num_kv_heads={self.num_kv_heads}")
        if self.num_cand_only_layers < 0 or self.num_cand_only_layers > self.num_layers:
            raise ValueError("num_cand_only_layers must be within [0, num_layers]")

    @classmethod
    def teacher_preset(cls, **overrides: int | float | bool) -> "PhoenixV3Config":
        """生产推荐 Teacher 默认规格：512d / 10 层（8 层联合隔离 + 2 层 CandidateOnly）。"""
        defaults = dict(dim=512, num_layers=10, num_cand_only_layers=2, num_heads=8, num_kv_heads=2)
        defaults.update(overrides)
        return cls(**defaults)  # type: ignore[arg-type]

    @classmethod
    def student_preset(cls, **overrides: int | float | bool) -> "PhoenixV3Config":
        """生产推荐线上 Student 默认规格：256d / 6 层（4 层联合隔离 + 2 层 CandidateOnly）。"""
        defaults = dict(dim=256, num_layers=6, num_cand_only_layers=2, num_heads=8, num_kv_heads=2)
        defaults.update(overrides)
        return cls(**defaults)  # type: ignore[arg-type]


class _JointIsolatedAttentionBlock(nn.Module):
    """联合历史-候选 GQA 块：严格实施 Candidate Isolation（候选只能看历史+自身）+ HSTU 相对偏置。"""

    def __init__(self, cfg: PhoenixV3Config) -> None:
        super().__init__()
        d = cfg.dim
        self.num_heads = cfg.num_heads
        self.num_kv_heads = cfg.num_kv_heads
        self.num_kv_groups = cfg.num_heads // cfg.num_kv_heads
        self.head_dim = d // cfg.num_heads

        self.norm1 = _RMSNorm(d)
        self.q_proj = nn.Linear(d, cfg.num_heads * self.head_dim, bias=False)
        self.k_proj = nn.Linear(d, cfg.num_kv_heads * self.head_dim, bias=False)
        self.v_proj = nn.Linear(d, cfg.num_kv_heads * self.head_dim, bias=False)
        self.o_proj = nn.Linear(cfg.num_heads * self.head_dim, d, bias=False)

        inner = max(d, int(((d * cfg.ffn_multiplier + 31) // 32) * 32))
        self.norm2 = _RMSNorm(d)
        self.gate_proj = nn.Linear(d, inner, bias=False)
        self.up_proj = nn.Linear(d, inner, bias=False)
        self.down_proj = nn.Linear(inner, d, bias=False)
        self.drop = nn.Dropout(cfg.dropout)

    def forward(
        self,
        tokens: torch.Tensor,     # (B, H + C, D)
        attn_bias: torch.Tensor,  # (B, num_heads_or_1, H + C, H + C)
    ) -> torch.Tensor:
        bsz, total_len, d = tokens.shape
        h = self.norm1(tokens)

        q = self.q_proj(h).view(bsz, total_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(h).view(bsz, total_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(h).view(bsz, total_len, self.num_kv_heads, self.head_dim).transpose(1, 2)

        if self.num_kv_groups > 1:
            k = k.repeat_interleave(self.num_kv_groups, dim=1)
            v = v.repeat_interleave(self.num_kv_groups, dim=1)

        scores = torch.matmul(q, k.transpose(-2, -1)) * (float(self.head_dim) ** -0.5) + attn_bias
        probs = self.drop(torch.softmax(scores, dim=-1))
        ctx = torch.matmul(probs, v).transpose(1, 2).contiguous().view(bsz, total_len, d)
        tokens = tokens + self.drop(self.o_proj(ctx))

        h2 = self.norm2(tokens)
        ffn = self.down_proj(F.silu(self.gate_proj(h2)) * self.up_proj(h2))
        return tokens + self.drop(ffn)


class _CandidateOnlyAttentionBlock(nn.Module):
    """末层 O(C*(H+1)) CandidateOnlyAttention：候选只读取历史上下文与自反信号，物理杜绝 C^2 交互。"""

    def __init__(self, cfg: PhoenixV3Config) -> None:
        super().__init__()
        d = cfg.dim
        self.num_heads = cfg.num_heads
        self.num_kv_heads = cfg.num_kv_heads
        self.num_kv_groups = cfg.num_heads // cfg.num_kv_heads
        self.head_dim = d // cfg.num_heads

        self.norm_q = _RMSNorm(d)
        self.norm_kv = _RMSNorm(d)
        self.q_proj = nn.Linear(d, cfg.num_heads * self.head_dim, bias=False)
        self.k_proj = nn.Linear(d, cfg.num_kv_heads * self.head_dim, bias=False)
        self.v_proj = nn.Linear(d, cfg.num_kv_heads * self.head_dim, bias=False)
        self.o_proj = nn.Linear(cfg.num_heads * self.head_dim, d, bias=False)

        inner = max(d, int(((d * cfg.ffn_multiplier + 31) // 32) * 32))
        self.norm2 = _RMSNorm(d)
        self.gate_proj = nn.Linear(d, inner, bias=False)
        self.up_proj = nn.Linear(d, inner, bias=False)
        self.down_proj = nn.Linear(inner, d, bias=False)
        self.drop = nn.Dropout(cfg.dropout)

    def forward(
        self,
        cand_tokens: torch.Tensor,  # (B, C, D)
        hist_tokens: torch.Tensor,  # (B, H, D)
        hist_mask: torch.Tensor,    # (B, H)
    ) -> torch.Tensor:
        bsz, c_len, d = cand_tokens.shape
        h_len = hist_tokens.shape[1]

        q_in = self.norm_q(cand_tokens)
        kv_hist_in = self.norm_kv(hist_tokens)
        kv_self_in = self.norm_kv(cand_tokens)

        q = self.q_proj(q_in).view(bsz, c_len, self.num_heads, self.head_dim).transpose(1, 2)  # (B, nh, C, hd)
        k_h = self.k_proj(kv_hist_in).view(bsz, h_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        v_h = self.v_proj(kv_hist_in).view(bsz, h_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        k_s = self.k_proj(kv_self_in).view(bsz, c_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        v_s = self.v_proj(kv_self_in).view(bsz, c_len, self.num_kv_heads, self.head_dim).transpose(1, 2)

        if self.num_kv_groups > 1:
            k_h = k_h.repeat_interleave(self.num_kv_groups, dim=1)
            v_h = v_h.repeat_interleave(self.num_kv_groups, dim=1)
            k_s = k_s.repeat_interleave(self.num_kv_groups, dim=1)
            v_s = v_s.repeat_interleave(self.num_kv_groups, dim=1)

        scale = float(self.head_dim) ** -0.5
        # 1) 历史键交互得分 (B, nh, C, H)
        hist_scores = torch.matmul(q, k_h.transpose(-2, -1)) * scale
        hist_bias = (1.0 - hist_mask.to(dtype=q.dtype)).unsqueeze(1).unsqueeze(2) * -1e4
        hist_scores = hist_scores + hist_bias
        # 2) 自身自反键得分 (B, nh, C, 1) -> O(C) 而非 O(C^2)
        self_score = torch.sum(q * k_s, dim=-1, keepdim=True) * scale

        all_scores = torch.cat([hist_scores, self_score], dim=-1)  # (B, nh, C, H + 1)
        all_probs = self.drop(torch.softmax(all_scores, dim=-1))
        prob_h = all_probs[..., :h_len]        # (B, nh, C, H)
        prob_s = all_probs[..., h_len:]        # (B, nh, C, 1)

        ctx = torch.matmul(prob_h, v_h) + prob_s * v_s  # (B, nh, C, hd)
        ctx = ctx.transpose(1, 2).contiguous().view(bsz, c_len, d)
        cand_tokens = cand_tokens + self.drop(self.o_proj(ctx))

        h2 = self.norm2(cand_tokens)
        ffn = self.down_proj(F.silu(self.gate_proj(h2)) * self.up_proj(h2))
        return cand_tokens + self.drop(ffn)


class _ExpertMlp(nn.Module):
    def __init__(self, dim: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, dim * 2),
            nn.SiLU(),
            nn.Linear(dim * 2, dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class PleMultiTaskHeadV3(nn.Module):
    """3-Expert Group PLE（共享专家 + 正向/负向/CREAD 专属专家门控）+ 14+30 多头输出。"""

    # 正向 10 头索引 (click..follow_author + video_quality_view=13) 与 负向 4 头索引 (9..12)
    POSITIVE_HEAD_INDICES = (0, 1, 2, 3, 4, 5, 6, 7, 8, 13)
    NEGATIVE_HEAD_INDICES = (9, 10, 11, 12)

    def __init__(self, cfg: PhoenixV3Config) -> None:
        super().__init__()
        d = cfg.dim
        self.num_shared = cfg.num_shared_experts
        self.num_groups = cfg.num_task_groups
        self.num_binary_heads = cfg.num_binary_heads
        self.cread_num_bins = cfg.cread_num_bins

        self.shared_experts = nn.ModuleList([_ExpertMlp(d) for _ in range(cfg.num_shared_experts)])
        self.task_experts = nn.ModuleList([_ExpertMlp(d) for _ in range(cfg.num_task_groups)])
        # 每个任务组独立门控权重：融合全部 shared_experts + 该组专属 task_expert
        total_for_group = cfg.num_shared_experts + 1
        self.gates = nn.ModuleList([nn.Linear(d, total_for_group) for _ in range(cfg.num_task_groups)])
        self.group_norms = nn.ModuleList([_RMSNorm(d) for _ in range(cfg.num_task_groups)])

        # 组 0 -> 正向交互 10 头；组 1 -> 负向免疫 4 头；组 2 -> CREAD-30 分布与期望停留头
        self.pos_head = nn.Linear(d, len(self.POSITIVE_HEAD_INDICES))
        self.neg_head = nn.Linear(d, len(self.NEGATIVE_HEAD_INDICES))
        self.cread_head = nn.Linear(d, cfg.cread_num_bins)

    def forward(self, cand_repr: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """输入候选表达 `(B, C, D)`，返回 `(action_logits (B, C, 14), cread_logits (B, C, 30), fused_hidden)`。"""
        shared_outs = [exp(cand_repr) for exp in self.shared_experts]
        group_reprs = []
        for g_idx in range(self.num_groups):
            task_out = self.task_experts[g_idx](cand_repr)
            stacked = torch.stack(shared_outs + [task_out], dim=-2)  # (B, C, E, D)
            weights = torch.softmax(self.gates[g_idx](cand_repr), dim=-1).unsqueeze(-1)  # (B, C, E, 1)
            mixed = self.group_norms[g_idx](torch.sum(weights * stacked, dim=-2))
            group_reprs.append(mixed)

        pos_logits = self.pos_head(group_reprs[0])  # (B, C, 10)
        neg_logits = self.neg_head(group_reprs[1])  # (B, C, 4)
        # 按标准 14 头下标 [0..8, 9..12, 13] 静态拼接 (B, C, 14)（对 ONNX 友好、零原位 scatter 副作用）
        action_logits = torch.cat(
            [pos_logits[..., :9], neg_logits, pos_logits[..., 9:]],
            dim=-1,
        )
        cread_logits = self.cread_head(group_reprs[2])
        return action_logits, cread_logits, group_reprs[0]


class PalPositionBiasModule(nn.Module):
    """Position-Aware Adaptation Layer (PAL)：仅当 `served_position > 0` 生效，推理期置 0 自动剥离偏置。"""

    def __init__(self, max_positions: int, num_binary_heads: int, cread_num_bins: int) -> None:
        super().__init__()
        self.max_positions = int(max_positions)
        self.pos_action_bias = nn.Embedding(max_positions, num_binary_heads, padding_idx=0)
        self.pos_cread_bias = nn.Embedding(max_positions, cread_num_bins, padding_idx=0)
        # 小尺度初始化避免初期破坏主干
        nn.init.zeros_(self.pos_action_bias.weight)
        nn.init.zeros_(self.pos_cread_bias.weight)

    def forward(self, cand_served_position: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        clamped = cand_served_position.clamp(0, self.max_positions - 1)
        active = (clamped > 0).unsqueeze(-1).to(dtype=self.pos_action_bias.weight.dtype)
        return self.pos_action_bias(clamped) * active, self.pos_cread_bias(clamped) * active


class PhoenixV3Model(nn.Module):
    """Phoenix V3 全特征交叉精排模型（兼容 Teacher 512d/10L 与 Student 256d/6L ONNX 导出）。"""

    def __init__(
        self,
        config: Optional[PhoenixV3Config] = None,
        *,
        sid_artifact: Optional[RQVaeArtifact] = None,
    ) -> None:
        super().__init__()
        self.config = config or PhoenixV3Config.student_preset()
        d = self.config.dim

        # 共享哈希/枚举嵌入（同样禁用任何 userId 静态表）
        self.post_hash_emb = nn.Embedding(self.config.post_hash_buckets, d, padding_idx=0)
        self.author_hash_emb = nn.Embedding(self.config.author_hash_buckets, d, padding_idx=0)
        self.action_type_emb = nn.Embedding(NUM_ACTION_TYPES + 4, d)
        self.time_bucket_emb = nn.Embedding(self.config.time_num_buckets, d)
        self.action_mask_proj = nn.Linear(NUM_PREDICTED_ACTIONS, d, bias=False)
        self.hist_pos_emb = nn.Embedding(self.config.max_history_len, d)

        self.in_network_emb = nn.Embedding(2, d)
        self.has_video_emb = nn.Embedding(2, d)
        self.role_type_emb = nn.Embedding(2, d)  # 0=历史交互 token, 1=候选 token

        self.sid_embedder: Optional[SidEntityEmbedder] = (
            SidEntityEmbedder(out_dim=d, artifact=sid_artifact) if self.config.enable_sid_embedder else None
        )

        # HSTU 相对位置差 & 相对时间桶偏置表，提升对长短时兴趣演变敏感度
        self.rab_pos_bias = nn.Embedding(self.config.rab_num_buckets, self.config.num_heads)
        self.rab_time_bias = nn.Embedding(self.config.time_num_buckets, self.config.num_heads)

        num_joint = self.config.num_layers - self.config.num_cand_only_layers
        self.joint_layers = nn.ModuleList([_JointIsolatedAttentionBlock(self.config) for _ in range(num_joint)])
        self.cand_only_layers = nn.ModuleList(
            [_CandidateOnlyAttentionBlock(self.config) for _ in range(self.config.num_cand_only_layers)]
        )
        self.cand_out_norm = _RMSNorm(d)
        self.ple_head = PleMultiTaskHeadV3(self.config)
        self.pal_bias = PalPositionBiasModule(
            self.config.max_served_positions,
            self.config.num_binary_heads,
            self.config.cread_num_bins,
        )

    def _safe_hash_bucket(self, raw_hashes: torch.Tensor, buckets: int) -> torch.Tensor:
        return torch.where(
            raw_hashes > 0,
            1 + ((raw_hashes - 1) % max(1, buckets - 1)),
            torch.zeros_like(raw_hashes),
        )

    def _build_joint_isolation_bias(
        self,
        history_mask: torch.Tensor,  # (B, H)
        cand_mask: torch.Tensor,     # (B, C)
        history_time_buckets: torch.Tensor,  # (B, H)
    ) -> torch.Tensor:
        """构建严格候选隔离 + HSTU 相对位置与时间桶偏置矩阵 `(B, num_heads, H+C, H+C)`。"""
        bsz, h_len = history_mask.shape
        c_len = cand_mask.shape[1]
        device = history_mask.device
        dtype = self.rab_pos_bias.weight.dtype

        # 1) 构造 0/1 静态隔离图：
        #    行=query，列=key：
        #    [H, H]: 历史对历史全开放 (1)
        #    [H, C]: 历史看不到候选 (0)
        #    [C, H]: 候选看到全部历史 (1)
        #    [C, C]: 候选只能看自身对角线 eye(C)
        hh = torch.ones((h_len, h_len), device=device, dtype=dtype)
        hc = torch.zeros((h_len, c_len), device=device, dtype=dtype)
        ch = torch.ones((c_len, h_len), device=device, dtype=dtype)
        cc = torch.eye(c_len, device=device, dtype=dtype)
        struct_allow = torch.cat([torch.cat([hh, hc], dim=1), torch.cat([ch, cc], dim=1)], dim=0)  # (H+C, H+C)

        # 与 key 有效掩码 (B, H+C) 相交；并保证每行对角 self 恒允许，防止全 padding 行产生 NaN
        key_valid = torch.cat([history_mask, cand_mask], dim=1).to(dtype=dtype)  # (B, H+C)
        allow = struct_allow.unsqueeze(0) * key_valid.unsqueeze(1)  # (B, H+C, H+C)
        self_eye = torch.eye(h_len + c_len, device=device, dtype=dtype).unsqueeze(0)
        allow = torch.clamp(allow + self_eye, max=1.0)
        mask_bias = (1.0 - allow).unsqueeze(1) * -1e4  # (B, 1, H+C, H+C)

        # 2) 为历史区间注入 HSTU 相对位置/相对时间差偏置 (B, num_heads, H, H)
        pos_idx = torch.arange(h_len, device=device, dtype=torch.long)
        rel_pos = (pos_idx.unsqueeze(1) - pos_idx.unsqueeze(0)).abs().clamp(0, self.config.rab_num_buckets - 1)
        h_pos_rab = self.rab_pos_bias(rel_pos).permute(2, 0, 1).unsqueeze(0)  # (1, nh, H, H)

        tb = history_time_buckets.clamp(0, self.config.time_num_buckets - 1)
        rel_tb = (tb.unsqueeze(2) - tb.unsqueeze(1)).abs().clamp(0, self.config.time_num_buckets - 1)  # (B, H, H)
        h_time_rab = self.rab_time_bias(rel_tb).permute(0, 3, 1, 2)  # (B, nh, H, H)

        # 将 HxH 的 HSTU rab 嵌入 (B, nh, H+C, H+C) 左上角
        full_rab_top = torch.cat([h_pos_rab + h_time_rab, h_pos_rab.new_zeros((bsz, self.config.num_heads, h_len, c_len))], dim=-1)
        full_rab_bot = h_pos_rab.new_zeros((bsz, self.config.num_heads, c_len, h_len + c_len))
        full_rab = torch.cat([full_rab_top, full_rab_bot], dim=2)
        return mask_bias + full_rab

    def forward_with_details(
        self,
        history_post_hashes: torch.Tensor,
        history_author_hashes: torch.Tensor,
        history_action_types: torch.Tensor,
        history_time_buckets: torch.Tensor,
        history_sids: torch.Tensor,
        history_action_masks: torch.Tensor,
        history_mask: torch.Tensor,
        cand_post_hashes: torch.Tensor,
        cand_author_hashes: torch.Tensor,
        cand_sids: torch.Tensor,
        cand_in_network: torch.Tensor,
        cand_has_video: torch.Tensor,
        cand_served_position: torch.Tensor,
        cand_mask: torch.Tensor,
        *,
        apply_pal: bool = True,
    ) -> Dict[str, torch.Tensor]:
        """完整前向：返回 `action_logits`, `cread_logits`, `cand_hidden`（供蒸馏/隐状态检查）。"""
        bsz, h_len = history_post_hashes.shape
        device = history_post_hashes.device

        hp_idx = self._safe_hash_bucket(history_post_hashes, self.config.post_hash_buckets)
        ha_idx = self._safe_hash_bucket(history_author_hashes, self.config.author_hash_buckets)
        h_pos = torch.arange(h_len, device=device, dtype=torch.long).clamp(0, self.config.max_history_len - 1)
        role_hist = self.role_type_emb(torch.zeros((1, 1), device=device, dtype=torch.long))
        role_cand = self.role_type_emb(torch.ones((1, 1), device=device, dtype=torch.long))

        h_emb = (
            self.post_hash_emb(hp_idx)
            + self.author_hash_emb(ha_idx)
            + self.action_type_emb(history_action_types.clamp(0, NUM_ACTION_TYPES + 3))
            + self.time_bucket_emb(history_time_buckets.clamp(0, self.config.time_num_buckets - 1))
            + self.action_mask_proj(history_action_masks.to(dtype=torch.float32))
            + self.hist_pos_emb(h_pos).unsqueeze(0)
            + role_hist
        )
        if self.sid_embedder is not None:
            h_emb = h_emb + self.sid_embedder(history_sids)
        h_emb = h_emb * history_mask.to(dtype=h_emb.dtype).unsqueeze(-1)

        cp_idx = self._safe_hash_bucket(cand_post_hashes, self.config.post_hash_buckets)
        ca_idx = self._safe_hash_bucket(cand_author_hashes, self.config.author_hash_buckets)
        c_emb = (
            self.post_hash_emb(cp_idx)
            + self.author_hash_emb(ca_idx)
            + self.in_network_emb(cand_in_network.clamp(0, 1))
            + self.has_video_emb(cand_has_video.clamp(0, 1))
            + role_cand
        )
        if self.sid_embedder is not None:
            c_emb = c_emb + self.sid_embedder(cand_sids)
        c_emb = c_emb * cand_mask.to(dtype=c_emb.dtype).unsqueeze(-1)

        tokens = torch.cat([h_emb, c_emb], dim=1)  # (B, H+C, D)
        joint_bias = self._build_joint_isolation_bias(history_mask, cand_mask, history_time_buckets)
        for blk in self.joint_layers:
            tokens = blk(tokens, joint_bias)

        hist_out = tokens[:, :h_len, :]
        cand_out = tokens[:, h_len:, :]

        for cand_blk in self.cand_only_layers:
            cand_out = cand_blk(cand_out, hist_out, history_mask)

        cand_out = self.cand_out_norm(cand_out)
        action_logits, cread_logits, ple_hidden = self.ple_head(cand_out)

        if apply_pal:
            pal_act, pal_cread = self.pal_bias(cand_served_position)
            action_logits = action_logits + pal_act
            cread_logits = cread_logits + pal_cread

        return {
            "action_logits": action_logits,
            "cread_logits": cread_logits,
            "cand_hidden": ple_hidden,
        }

    def forward(
        self,
        history_post_hashes: torch.Tensor,
        history_author_hashes: torch.Tensor,
        history_action_types: torch.Tensor,
        history_time_buckets: torch.Tensor,
        history_sids: torch.Tensor,
        history_action_masks: torch.Tensor,
        history_mask: torch.Tensor,
        cand_post_hashes: torch.Tensor,
        cand_author_hashes: torch.Tensor,
        cand_sids: torch.Tensor,
        cand_in_network: torch.Tensor,
        cand_has_video: torch.Tensor,
        cand_served_position: torch.Tensor,
        cand_mask: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """ONNX 导出标准前向接口：返回 `(action_logits (B, C, 14), cread_logits (B, C, 30))`。"""
        out = self.forward_with_details(
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
            apply_pal=True,
        )
        return out["action_logits"], out["cread_logits"]
