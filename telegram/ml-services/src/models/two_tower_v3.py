"""V3 双塔召回模型：严格无 User ID 序列 Transformer + MoL (K=4) 用户塔、候选塔与多头门控打分器。

对标 x-algorithm `recsys_two_tower_model.py` 与 `V3TwoTowerSpec`：
- 用户塔严格禁用任何 `userId` / 用户静态 Embedding 表（`use_user_embedding=False`）；
- 采用 GQA + SwiGLU 4 层 Transformer 编码异构历史序列（含 6x256 SID 与 actionMask[13]）；
- 输出 `K=4` 个单位化多兴趣表示 `(B, 4, D)`，并配合 `MolScorerV3` 双层 SiLU 门控计算匹配度。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from src.contracts.actions import NUM_ACTION_TYPES, NUM_PREDICTED_ACTIONS
from src.contracts.sid import SID_CODEBOOK_SIZE, SID_NUM_LEVELS
from src.models.rq_vae_sid import RQVaeArtifact, SidEntityEmbedder


@dataclass(frozen=True)
class TwoTowerV3Config:
    """TwoTower V3 双塔超参数配置（默认严格对齐 V3TwoTowerSpec）。"""

    hidden_dim: int = 256
    embedding_dim: int = 256
    num_layers: int = 4
    num_heads: int = 8
    num_kv_heads: int = 2
    ffn_multiplier: float = 2.6667
    mol_num_heads: int = 4
    max_history_len: int = 128
    post_hash_buckets: int = 65536
    author_hash_buckets: int = 16384
    time_num_buckets: int = 16
    dropout: float = 0.1
    use_user_embedding: bool = False  # 强制冻结为 False：用户表征 100% 由行为序列实时推断
    enable_sid_embedder: bool = True

    def __post_init__(self) -> None:
        if self.use_user_embedding:
            raise ValueError("TwoTower V3 strictly forbids static user ID embeddings (use_user_embedding must be False)")
        if self.hidden_dim % self.num_heads != 0:
            raise ValueError(f"hidden_dim={self.hidden_dim} must be divisible by num_heads={self.num_heads}")
        if self.num_heads % self.num_kv_heads != 0:
            raise ValueError(f"num_heads={self.num_heads} must be divisible by num_kv_heads={self.num_kv_heads}")


class _RMSNorm(nn.Module):
    """ONNX Ops-17 原生友好的均方根归一化层。"""

    def __init__(self, dim: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.eps = float(eps)
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        rms = torch.sqrt(torch.mean(x * x, dim=-1, keepdim=True) + self.eps)
        return (x / rms) * self.weight


class _GqaSwiGluBlock(nn.Module):
    """Grouped-Query Attention (GQA) + SwiGLU 前馈层，兼容 ONNX INT8 静态/动态导出。"""

    def __init__(
        self,
        dim: int,
        num_heads: int,
        num_kv_heads: int,
        ffn_multiplier: float = 2.6667,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.dim = int(dim)
        self.num_heads = int(num_heads)
        self.num_kv_heads = int(num_kv_heads)
        self.num_kv_groups = num_heads // num_kv_heads
        self.head_dim = dim // num_heads

        self.norm1 = _RMSNorm(dim)
        self.q_proj = nn.Linear(dim, num_heads * self.head_dim, bias=False)
        self.k_proj = nn.Linear(dim, num_kv_heads * self.head_dim, bias=False)
        self.v_proj = nn.Linear(dim, num_kv_heads * self.head_dim, bias=False)
        self.o_proj = nn.Linear(num_heads * self.head_dim, dim, bias=False)

        inner_dim = max(dim, int(((dim * ffn_multiplier + 31) // 32) * 32))
        self.norm2 = _RMSNorm(dim)
        self.gate_proj = nn.Linear(dim, inner_dim, bias=False)
        self.up_proj = nn.Linear(dim, inner_dim, bias=False)
        self.down_proj = nn.Linear(inner_dim, dim, bias=False)
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor, attn_bias: torch.Tensor) -> torch.Tensor:
        bsz, seq_len, _ = x.shape
        h = self.norm1(x)

        q = self.q_proj(h).view(bsz, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(h).view(bsz, seq_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(h).view(bsz, seq_len, self.num_kv_heads, self.head_dim).transpose(1, 2)

        if self.num_kv_groups > 1:
            k = k.repeat_interleave(self.num_kv_groups, dim=1)
            v = v.repeat_interleave(self.num_kv_groups, dim=1)

        scores = torch.matmul(q, k.transpose(-2, -1)) * (float(self.head_dim) ** -0.5) + attn_bias
        probs = torch.softmax(scores, dim=-1)
        probs = self.drop(probs)
        ctx = torch.matmul(probs, v).transpose(1, 2).contiguous().view(bsz, seq_len, self.dim)
        x = x + self.drop(self.o_proj(ctx))

        h2 = self.norm2(x)
        ffn = self.down_proj(F.silu(self.gate_proj(h2)) * self.up_proj(h2))
        return x + self.drop(ffn)


def _l2_normalize_last_dim(x: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    """使用显式平方和开方完成 L2 归一化，规避部分 ONNX opset 对 LpNorm 的降维兼容问题。"""
    norm = torch.sqrt(torch.sum(x * x, dim=-1, keepdim=True) + eps)
    return x / norm


class UserTowerV3(nn.Module):
    """无静态用户 ID 的序列 Transformer + MoL (K=4) 多兴趣用户塔。

    严格遵守 `V3TwoTowerSpec.onnx_input_names` 7 个张量输入顺序与形态：
    `(history_post_hashes, history_author_hashes, history_action_types,
      history_time_buckets, history_sids, history_action_masks, attention_mask)`
    """

    def __init__(
        self,
        config: TwoTowerV3Config,
        *,
        sid_artifact: Optional[RQVaeArtifact] = None,
    ) -> None:
        super().__init__()
        self.config = config
        d = config.hidden_dim

        self.post_hash_emb = nn.Embedding(config.post_hash_buckets, d, padding_idx=0)
        self.author_hash_emb = nn.Embedding(config.author_hash_buckets, d, padding_idx=0)
        self.action_type_emb = nn.Embedding(NUM_ACTION_TYPES + 4, d)
        self.time_bucket_emb = nn.Embedding(config.time_num_buckets, d)
        self.action_mask_proj = nn.Linear(NUM_PREDICTED_ACTIONS, d, bias=False)
        self.pos_emb = nn.Embedding(config.max_history_len, d)

        self.sid_embedder: Optional[SidEntityEmbedder] = (
            SidEntityEmbedder(out_dim=d, artifact=sid_artifact) if config.enable_sid_embedder else None
        )

        self.input_norm = _RMSNorm(d)
        self.layers = nn.ModuleList(
            [
                _GqaSwiGluBlock(
                    dim=d,
                    num_heads=config.num_heads,
                    num_kv_heads=config.num_kv_heads,
                    ffn_multiplier=config.ffn_multiplier,
                    dropout=config.dropout,
                )
                for _ in range(config.num_layers)
            ]
        )
        self.out_norm = _RMSNorm(d)

        # K=4 注意力池化查询向量，让不同 MoL 头关注用户的不同历史意图侧面
        k_heads = config.mol_num_heads
        self.head_queries = nn.Parameter(torch.randn(k_heads, d) * 0.02)
        self.head_projections = nn.ModuleList(
            [nn.Linear(d, config.embedding_dim, bias=False) for _ in range(k_heads)]
        )
        self.ctx_proj = nn.Linear(d, config.embedding_dim, bias=False)

    def encode_with_context(
        self,
        history_post_hashes: torch.Tensor,
        history_author_hashes: torch.Tensor,
        history_action_types: torch.Tensor,
        history_time_buckets: torch.Tensor,
        history_sids: torch.Tensor,
        history_action_masks: torch.Tensor,
        attention_mask: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """返回 `(user_vecs: (B, K, D_out), user_ctx: (B, D_out))`。"""
        bsz, seq_len = history_post_hashes.shape
        device = history_post_hashes.device

        # 对输入哈希安全取模映射进桶（保持 0=PAD 不受偏移破坏）
        p_idx = torch.where(
            history_post_hashes > 0,
            1 + ((history_post_hashes - 1) % max(1, self.config.post_hash_buckets - 1)),
            torch.zeros_like(history_post_hashes),
        )
        a_idx = torch.where(
            history_author_hashes > 0,
            1 + ((history_author_hashes - 1) % max(1, self.config.author_hash_buckets - 1)),
            torch.zeros_like(history_author_hashes),
        )
        act_idx = history_action_types.clamp(0, NUM_ACTION_TYPES + 3)
        tb_idx = history_time_buckets.clamp(0, self.config.time_num_buckets - 1)

        pos_ids = torch.arange(seq_len, device=device, dtype=torch.long).clamp(0, self.config.max_history_len - 1)

        x = (
            self.post_hash_emb(p_idx)
            + self.author_hash_emb(a_idx)
            + self.action_type_emb(act_idx)
            + self.time_bucket_emb(tb_idx)
            + self.action_mask_proj(history_action_masks.to(dtype=torch.float32))
            + self.pos_emb(pos_ids).unsqueeze(0)
        )
        if self.sid_embedder is not None:
            x = x + self.sid_embedder(history_sids)

        attn_f = attention_mask.to(dtype=x.dtype)
        x = self.input_norm(x) * attn_f.unsqueeze(-1)

        # 构造非填充注意力掩码 (B, 1, 1, L)
        attn_bias = (1.0 - attn_f).unsqueeze(1).unsqueeze(2) * -1e4
        for layer in self.layers:
            x = layer(x, attn_bias)
        x = self.out_norm(x)

        # 使用多头可学习 Query 与序列化表达交叉注意，聚合成 K 个独立表征向量
        seq_bias = (1.0 - attn_f).unsqueeze(1) * -1e4  # (B, 1, L)
        attn_logits = torch.matmul(self.head_queries.unsqueeze(0), x.transpose(1, 2))
        attn_logits = attn_logits * (float(self.config.hidden_dim) ** -0.5) + seq_bias
        attn_weights = torch.softmax(attn_logits, dim=-1)  # (B, K, L)
        pooled_heads = torch.matmul(attn_weights, x)  # (B, K, D)

        # 同时保留无空序列保护的平均上下文向量，供 MoL 门控网络与对齐使用
        mean_denom = attn_f.sum(dim=1, keepdim=True).clamp_min(1.0)
        mean_pooled = (x * attn_f.unsqueeze(-1)).sum(dim=1) / mean_denom
        user_ctx = self.ctx_proj(mean_pooled)

        head_outs = []
        for k_idx, proj in enumerate(self.head_projections):
            v_k = _l2_normalize_last_dim(proj(pooled_heads[:, k_idx, :]))
            head_outs.append(v_k)
        user_vecs = torch.stack(head_outs, dim=1)  # (B, K, D_out)
        return user_vecs, user_ctx

    def forward(
        self,
        history_post_hashes: torch.Tensor,
        history_author_hashes: torch.Tensor,
        history_action_types: torch.Tensor,
        history_time_buckets: torch.Tensor,
        history_sids: torch.Tensor,
        history_action_masks: torch.Tensor,
        attention_mask: torch.Tensor,
    ) -> torch.Tensor:
        """ONNX 导出标准前向接口：返回 `(B, K, D_out)` 归一化 MoL 用户向量。"""
        user_vecs, _ = self.encode_with_context(
            history_post_hashes=history_post_hashes,
            history_author_hashes=history_author_hashes,
            history_action_types=history_action_types,
            history_time_buckets=history_time_buckets,
            history_sids=history_sids,
            history_action_masks=history_action_masks,
            attention_mask=attention_mask,
        )
        return user_vecs


class CandidateTowerV3(nn.Module):
    """双塔候选塔：融合帖子哈希、作者哈希、6x256 SID、文本编码向量与属性输出 ANN/MoL 表征。

    采用基础向量 `cand_ann_vec (M, D_out)` + `K` 个低秩残差偏移组件，既能让线上
    FAISS HNSW-SQ8 仅按单一 `256d` 向量高效建库，又能在 `MolScorerV3` 中与用户 `K=4` 头精细交互。
    """

    def __init__(
        self,
        config: TwoTowerV3Config,
        *,
        text_input_dim: int = 256,
        sid_artifact: Optional[RQVaeArtifact] = None,
    ) -> None:
        super().__init__()
        self.config = config
        d = config.hidden_dim
        self.text_input_dim = int(text_input_dim)

        self.post_hash_emb = nn.Embedding(config.post_hash_buckets, d, padding_idx=0)
        self.author_hash_emb = nn.Embedding(config.author_hash_buckets, d, padding_idx=0)
        self.in_network_emb = nn.Embedding(2, d)
        self.has_video_emb = nn.Embedding(2, d)
        self.text_proj = nn.Linear(text_input_dim, d)
        self.sid_embedder: Optional[SidEntityEmbedder] = (
            SidEntityEmbedder(out_dim=d, artifact=sid_artifact) if config.enable_sid_embedder else None
        )

        self.mlp = nn.Sequential(
            _RMSNorm(d),
            nn.Linear(d, d * 2),
            nn.SiLU(),
            nn.Linear(d * 2, d),
        )
        self.ann_proj = nn.Linear(d, config.embedding_dim, bias=False)

        # x-algorithm 风格的低秩组件头：base + low_rank_res_k
        rank = max(16, config.embedding_dim // 4)
        self.mol_down = nn.ModuleList([nn.Linear(d, rank, bias=False) for _ in range(config.mol_num_heads)])
        self.mol_up = nn.ModuleList(
            [nn.Linear(rank, config.embedding_dim, bias=False) for _ in range(config.mol_num_heads)]
        )
        self.ctx_proj = nn.Linear(d, config.embedding_dim, bias=False)

    def encode_with_context(
        self,
        cand_post_hashes: torch.Tensor,
        cand_author_hashes: torch.Tensor,
        cand_sids: torch.Tensor,
        cand_in_network: torch.Tensor,
        cand_has_video: torch.Tensor,
        cand_text_emb: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """返回 `(cand_ann_vec: (M, D_out), cand_mol_vecs: (M, K, D_out), cand_ctx: (M, D_out))`。"""
        p_idx = torch.where(
            cand_post_hashes > 0,
            1 + ((cand_post_hashes - 1) % max(1, self.config.post_hash_buckets - 1)),
            torch.zeros_like(cand_post_hashes),
        )
        a_idx = torch.where(
            cand_author_hashes > 0,
            1 + ((cand_author_hashes - 1) % max(1, self.config.author_hash_buckets - 1)),
            torch.zeros_like(cand_author_hashes),
        )
        x = (
            self.post_hash_emb(p_idx)
            + self.author_hash_emb(a_idx)
            + self.in_network_emb(cand_in_network.clamp(0, 1))
            + self.has_video_emb(cand_has_video.clamp(0, 1))
        )
        if cand_text_emb is not None:
            x = x + self.text_proj(cand_text_emb.to(dtype=x.dtype))
        if self.sid_embedder is not None:
            x = x + self.sid_embedder(cand_sids)

        h = x + self.mlp(x)
        ann_base = self.ann_proj(h)
        cand_ann_vec = _l2_normalize_last_dim(ann_base)

        mol_heads = []
        for down, up in zip(self.mol_down, self.mol_up):
            # 围绕主 ANN 语义基底施加低秩残差，保障多头分形与主索引空间同源
            comp = ann_base + 0.35 * up(F.silu(down(h)))
            mol_heads.append(_l2_normalize_last_dim(comp))
        cand_mol_vecs = torch.stack(mol_heads, dim=1)  # (M, K, D_out)
        cand_ctx = self.ctx_proj(h)
        return cand_ann_vec, cand_mol_vecs, cand_ctx

    def forward(
        self,
        cand_post_hashes: torch.Tensor,
        cand_author_hashes: torch.Tensor,
        cand_sids: torch.Tensor,
        cand_in_network: torch.Tensor,
        cand_has_video: torch.Tensor,
        cand_text_emb: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """默认返回存入 FAISS HNSW-SQ8 的 `(M, D_out)` 归一化语义向量。"""
        ann_vec, _, _ = self.encode_with_context(
            cand_post_hashes=cand_post_hashes,
            cand_author_hashes=cand_author_hashes,
            cand_sids=cand_sids,
            cand_in_network=cand_in_network,
            cand_has_video=cand_has_video,
            cand_text_emb=cand_text_emb,
        )
        return ann_vec


class MolScorerV3(nn.Module):
    """Mixture-of-Logits (MoL) 双层 SiLU 上下文门控多头打分器（对齐 `x-algorithm`）。"""

    def __init__(
        self,
        embedding_dim: int = 256,
        num_heads: int = 4,
        gate_hidden_dim: int = 64,
        init_temperature: float = 0.07,
    ) -> None:
        super().__init__()
        self.num_heads = int(num_heads)
        self.log_inv_temp = nn.Parameter(torch.log(torch.tensor(1.0 / max(1e-3, init_temperature))))

        # 上下文门控两层 SiLU MLP：同时吸收 user_ctx 与 cand_ctx 产生 K 路动态权重
        self.user_gate_proj = nn.Linear(embedding_dim, gate_hidden_dim)
        self.cand_gate_proj = nn.Linear(embedding_dim, gate_hidden_dim)
        self.gate_out = nn.Sequential(
            nn.SiLU(),
            nn.Linear(gate_hidden_dim, num_heads),
        )

    def forward(
        self,
        user_vecs: torch.Tensor,  # (B, K, D)
        cand_mol_vecs: torch.Tensor,  # (M, K, D) 或 (M, D)
        user_ctx: torch.Tensor,  # (B, D)
        cand_ctx: torch.Tensor,  # (M, D)
        *,
        use_mol: bool = True,
    ) -> torch.Tensor:
        """计算全部 (B, M) 配对得分矩阵，支持 `use_mol=False` 单头退化供 Ablation ② 消融。"""
        scale = torch.exp(self.log_inv_temp).clamp(1.0, 50.0)
        if cand_mol_vecs.ndim == 2:
            # 广播单一候选向量至 K 个头，兼容直接用 FAISS 库向量打分
            c_expanded = cand_mol_vecs.unsqueeze(1).expand(-1, user_vecs.shape[1], -1)
        else:
            c_expanded = cand_mol_vecs

        if not use_mol or self.num_heads == 1:
            # 单头消融基线：均值融合或取第 0 头，走纯标量余弦点积
            u0 = _l2_normalize_last_dim(user_vecs[:, 0, :])
            c0 = _l2_normalize_last_dim(c_expanded[:, 0, :])
            return scale * torch.matmul(u0, c0.t())

        # K 路逐头相似度矩阵 (B, M, K)
        head_sims = torch.einsum("bkd,mkd->bmk", user_vecs, c_expanded)

        # 低显存组合门控：phi(u_ctx)[:, None, :] + psi(c_ctx)[None, :, :]
        u_g = self.user_gate_proj(user_ctx).unsqueeze(1)  # (B, 1, H)
        c_g = self.cand_gate_proj(cand_ctx).unsqueeze(0)  # (1, M, H)
        gate_logits = self.gate_out(u_g + c_g)  # (B, M, K)
        weights = torch.softmax(gate_logits, dim=-1)
        return scale * torch.sum(weights * head_sims, dim=-1)


class TwoTowerV3Model(nn.Module):
    """组合 UserTowerV3 + CandidateTowerV3 + MolScorerV3 的完整训练与导出容器。"""

    def __init__(
        self,
        config: Optional[TwoTowerV3Config] = None,
        *,
        text_input_dim: int = 256,
        sid_artifact: Optional[RQVaeArtifact] = None,
    ) -> None:
        super().__init__()
        self.config = config or TwoTowerV3Config()
        self.user_tower = UserTowerV3(self.config, sid_artifact=sid_artifact)
        self.candidate_tower = CandidateTowerV3(
            self.config,
            text_input_dim=text_input_dim,
            sid_artifact=sid_artifact,
        )
        self.scorer = MolScorerV3(
            embedding_dim=self.config.embedding_dim,
            num_heads=self.config.mol_num_heads,
        )

    def encode_user_batch(self, batch: Dict[str, torch.Tensor]) -> Tuple[torch.Tensor, torch.Tensor]:
        return self.user_tower.encode_with_context(
            history_post_hashes=batch["history_post_hashes"],
            history_author_hashes=batch["history_author_hashes"],
            history_action_types=batch["history_action_types"],
            history_time_buckets=batch["history_time_buckets"],
            history_sids=batch["history_sids"],
            history_action_masks=batch["history_action_masks"],
            attention_mask=batch["attention_mask"],
        )

    def encode_candidate_batch(
        self,
        batch: Dict[str, torch.Tensor],
        *,
        prefix: str = "pos_",
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        text_key = f"{prefix}text_emb"
        return self.candidate_tower.encode_with_context(
            cand_post_hashes=batch[f"{prefix}post_hashes"],
            cand_author_hashes=batch[f"{prefix}author_hashes"],
            cand_sids=batch[f"{prefix}sids"],
            cand_in_network=batch[f"{prefix}in_network"],
            cand_has_video=batch[f"{prefix}has_video"],
            cand_text_emb=batch.get(text_key),
        )
