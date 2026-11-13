"""Phoenix V2 多任务排序模型：严格复刻 x-algorithm Candidate Isolation Transformer 范式。"""

from __future__ import annotations

import json
import zlib
from pathlib import Path
from typing import Dict, Optional

import torch
import torch.nn as nn

from recsys.contracts.actions import (
    ACTION_LOSS_WEIGHTS,
    ACTION_TYPE_MAP,
    CONTINUOUS_ACTIONS,
    NUM_ACTION_TYPES,
    NUM_PREDICTED_ACTIONS,
    PREDICTED_ACTIONS,
)

# 兼容别名：保证旧脚本从 phoenix_v2_model 导入 LABEL_ACTIONS 不报错
LABEL_ACTIONS = PREDICTED_ACTIONS

_HASH_MODULO = (1 << 30) - 2


def stable_id_hash(raw_id: object) -> int:
    """将任意字符串或整型实体 ID 映射为跨进程稳定且不溢出的正整数。"""
    if raw_id is None:
        return 0
    if isinstance(raw_id, int) and not isinstance(raw_id, bool):
        return 0 if raw_id <= 0 else (2 + (zlib.crc32(str(raw_id).encode("utf-8")) % _HASH_MODULO))
    text = str(raw_id).strip()
    if not text or text == "<PAD>":
        return 0
    if text == "<UNK>":
        return 1
    return 2 + (zlib.crc32(text.encode("utf-8")) % _HASH_MODULO)


class HashEmbedding(nn.Module):
    """多哈希桶共享嵌入层，避免超大稀疏 ID 词表导致显存与体积膨胀。"""

    def __init__(self, num_hashes: int, num_buckets: int, dim: int):
        super().__init__()
        self.num_hashes = max(1, int(num_hashes))
        self.num_buckets = max(8, int(num_buckets))
        self.dim = int(dim)
        self.tables = nn.ModuleList(
            [nn.Embedding(self.num_buckets, dim, padding_idx=0) for _ in range(self.num_hashes)]
        )
        # 固定质数种子以构造彼此独立的多重哈希映射
        self.register_buffer(
            "primes",
            torch.tensor([2654435761, 2246822519, 3266489917, 668265263][: self.num_hashes], dtype=torch.long),
            persistent=False,
        )

    def _hash(self, ids: torch.Tensor, seed_idx: int) -> torch.Tensor:
        prime = self.primes[seed_idx]
        # 保留 0 号槽位给 <PAD>，真实 ID 映射到 [1, num_buckets - 1]
        hashed = ((ids.abs() * prime + (seed_idx + 1) * 1013904223) % (self.num_buckets - 1)) + 1
        return torch.where(ids == 0, torch.zeros_like(ids), hashed)

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        out = None
        for i in range(self.num_hashes):
            bucket_ids = self._hash(ids, i)
            emb = self.tables[i](bucket_ids)
            out = emb if out is None else (out + emb)
        return out / float(self.num_hashes)


class HistoryTokenizer(nn.Module):
    """历史行为序列化编码：帖子哈希 + 作者哈希 + 动作类型 + 位置 + 相对时间衰减桶。"""

    def __init__(
        self,
        dim: int,
        max_seq_len: int = 200,
        num_hashes: int = 2,
        num_time_buckets: int = 16,
    ):
        super().__init__()
        hash_dim = max(8, dim // 3)
        self.post_emb = HashEmbedding(num_hashes, 100_000, hash_dim)
        self.author_emb = HashEmbedding(num_hashes, 50_000, hash_dim)
        self.action_emb = nn.Embedding(NUM_ACTION_TYPES, hash_dim)
        self.position_emb = nn.Embedding(max_seq_len, dim)
        self.time_bucket_emb = nn.Embedding(num_time_buckets, dim)
        self.proj = nn.Linear(hash_dim * 3, dim)

    def forward(
        self,
        post_ids: torch.Tensor,
        author_ids: torch.Tensor,
        action_types: torch.Tensor,
        positions: torch.Tensor,
        time_buckets: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        post_h = self.post_emb(post_ids)
        author_h = self.author_emb(author_ids)
        action_h = self.action_emb(action_types.clamp(0, NUM_ACTION_TYPES - 1))
        combined = torch.cat([post_h, author_h, action_h], dim=-1)
        token = self.proj(combined) + self.position_emb(positions.clamp(0, self.position_emb.num_embeddings - 1))
        if time_buckets is not None:
            token = token + self.time_bucket_emb(time_buckets.clamp(0, self.time_bucket_emb.num_embeddings - 1))
        return token


class CandidateTokenizer(nn.Module):
    """候选帖子编码：帖子哈希 + 作者哈希 + 位置 + 是否关注网内/视频特征。"""

    def __init__(self, dim: int, max_candidates: int = 64, num_hashes: int = 2):
        super().__init__()
        hash_dim = max(8, dim // 2)
        self.post_emb = HashEmbedding(num_hashes, 100_000, hash_dim)
        self.author_emb = HashEmbedding(num_hashes, 50_000, hash_dim)
        self.position_emb = nn.Embedding(max_candidates, dim)
        self.in_network_emb = nn.Embedding(2, dim)
        self.has_video_emb = nn.Embedding(2, dim)
        self.proj = nn.Linear(hash_dim * 2, dim)

    def forward(
        self,
        post_ids: torch.Tensor,
        author_ids: torch.Tensor,
        positions: torch.Tensor,
        in_network: Optional[torch.Tensor] = None,
        has_video: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        post_h = self.post_emb(post_ids)
        author_h = self.author_emb(author_ids)
        combined = torch.cat([post_h, author_h], dim=-1)
        token = self.proj(combined) + self.position_emb(positions.clamp(0, self.position_emb.num_embeddings - 1))
        if in_network is not None:
            token = token + self.in_network_emb(in_network.long().clamp(0, 1))
        if has_video is not None:
            token = token + self.has_video_emb(has_video.long().clamp(0, 1))
        return token


class PhoenixV2Ranker(nn.Module):
    """
    Phoenix V2 多任务排序 Transformer：
      - 序列布局: [User(1) | History(S) | Candidates(C)]
      - 候选隔离掩码: History/User 禁止关注 Candidates；Candidates 仅能关注自身与 User/History
      - 多任务输出: PREDICTED_ACTIONS 离散动作 logits + dwell_time 连续停留回归 head
    """

    def __init__(
        self,
        dim: int = 256,
        num_heads: int = 8,
        num_layers: int = 4,
        ff_dim: Optional[int] = None,
        dropout: float = 0.1,
        max_history_len: int = 100,
        max_candidates: int = 64,
        num_hashes: int = 2,
    ):
        super().__init__()
        self.dim = int(dim)
        self.num_heads = int(num_heads)
        self.num_layers = int(num_layers)
        self.max_history_len = int(max_history_len)
        self.max_candidates = int(max_candidates)
        self.num_hashes = int(num_hashes)
        resolved_ff = int(ff_dim or self.dim * 4)

        self.history_tokenizer = HistoryTokenizer(self.dim, max(200, self.max_history_len * 2), num_hashes)
        self.candidate_tokenizer = CandidateTokenizer(self.dim, self.max_candidates, num_hashes)
        self.user_emb = HashEmbedding(num_hashes, 50_000, self.dim)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=self.dim,
            nhead=self.num_heads,
            dim_feedforward=resolved_ff,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=self.num_layers,
            enable_nested_tensor=False,
        )
        self.final_norm = nn.LayerNorm(self.dim)

        self.action_heads = nn.ModuleDict({name: nn.Linear(self.dim, 1) for name in PREDICTED_ACTIONS})
        self.continuous_heads = nn.ModuleDict({name: nn.Linear(self.dim, 1) for name in CONTINUOUS_ACTIONS})
        self.dropout = nn.Dropout(dropout)

        self._init_weights()

    def _init_weights(self) -> None:
        for param in self.parameters():
            if param.dim() > 1:
                nn.init.xavier_uniform_(param)

    def _build_isolation_mask(
        self,
        history_len: int,
        num_candidates: int,
        device: torch.device,
    ) -> torch.Tensor:
        """构建 Candidate Isolation 注意力掩码（与 x-algorithm 保持零候选串扰）。"""
        total = 1 + history_len + num_candidates
        mask = torch.zeros((total, total), device=device, dtype=torch.float32)

        # User 与 History 严禁读取 Candidate 信息，杜绝跨位置特征泄漏
        cand_start = 1 + history_len
        mask[:cand_start, cand_start:] = float("-inf")

        # 候选之间仅保留对角线 self-attention，彻底隔离排序列表上下文扰动
        cand_mask = torch.full((num_candidates, num_candidates), float("-inf"), device=device, dtype=torch.float32)
        cand_mask.fill_diagonal_(0.0)
        mask[cand_start:, cand_start:] = cand_mask
        return mask

    def export_config(self) -> Dict[str, int]:
        """导出重建同构模型实例所需的超参数配置。"""
        return {
            "dim": self.dim,
            "num_heads": self.num_heads,
            "num_layers": self.num_layers,
            "max_history_len": self.max_history_len,
            "max_candidates": self.max_candidates,
            "num_hashes": self.num_hashes,
        }

    def save_config(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.export_config(), ensure_ascii=False, indent=2), encoding="utf-8")

    def forward(
        self,
        user_ids: torch.Tensor,
        history_post_ids: torch.Tensor,
        history_author_ids: torch.Tensor,
        history_action_types: torch.Tensor,
        history_mask: torch.Tensor,
        candidate_post_ids: torch.Tensor,
        candidate_author_ids: torch.Tensor,
        candidate_mask: torch.Tensor,
        history_time_buckets: Optional[torch.Tensor] = None,
        candidate_in_network: Optional[torch.Tensor] = None,
        candidate_has_video: Optional[torch.Tensor] = None,
    ) -> Dict[str, torch.Tensor]:
        batch_size, hist_len = history_post_ids.shape
        num_cands = candidate_post_ids.shape[1]

        user_token = self.user_emb(user_ids).unsqueeze(1)
        hist_positions = torch.arange(hist_len, device=history_post_ids.device).unsqueeze(0).expand(batch_size, -1)
        hist_tokens = self.history_tokenizer(
            history_post_ids,
            history_author_ids,
            history_action_types,
            hist_positions,
            time_buckets=history_time_buckets,
        )

        cand_positions = torch.arange(num_cands, device=candidate_post_ids.device).unsqueeze(0).expand(batch_size, -1)
        cand_tokens = self.candidate_tokenizer(
            candidate_post_ids,
            candidate_author_ids,
            cand_positions,
            in_network=candidate_in_network,
            has_video=candidate_has_video,
        )

        seq = torch.cat([user_token, hist_tokens, cand_tokens], dim=1)
        seq = self.dropout(seq)

        isolation_mask = self._build_isolation_mask(hist_len, num_cands, seq.device)
        user_pad = torch.zeros((batch_size, 1), device=seq.device, dtype=torch.bool)
        hist_pad = history_mask == 0
        cand_pad = candidate_mask == 0
        padding_mask = torch.cat([user_pad, hist_pad, cand_pad], dim=1)

        encoded = self.transformer(seq, mask=isolation_mask, src_key_padding_mask=padding_mask)
        encoded = self.final_norm(encoded)
        cand_out = encoded[:, 1 + hist_len :, :]

        outputs: Dict[str, torch.Tensor] = {}
        for name, head in self.action_heads.items():
            outputs[name] = head(cand_out).squeeze(-1)
        for name, head in self.continuous_heads.items():
            outputs[name] = head(cand_out).squeeze(-1)
        return outputs


def create_mini_phoenix(**kwargs) -> PhoenixV2Ranker:
    """Mini 模型：适合 T4 GPU 或 CPU int8 量化快速推理。"""
    defaults = dict(
        dim=128,
        num_heads=4,
        num_layers=4,
        ff_dim=512,
        dropout=0.1,
        max_history_len=64,
        max_candidates=32,
        num_hashes=2,
    )
    defaults.update(kwargs)
    return PhoenixV2Ranker(**defaults)


def create_medium_phoenix(**kwargs) -> PhoenixV2Ranker:
    """Medium 模型：与线上 256d 向量契约同维的高容量排序主塔（适合 L4/A100）。"""
    defaults = dict(
        dim=256,
        num_heads=8,
        num_layers=6,
        ff_dim=1024,
        dropout=0.1,
        max_history_len=100,
        max_candidates=64,
        num_hashes=2,
    )
    defaults.update(kwargs)
    return PhoenixV2Ranker(**defaults)


def create_phoenix_for_scale(num_users: int, num_posts: int, **kwargs) -> PhoenixV2Ranker:
    """根据用户与语料规模选择合适容量，避免小数据集过拟合。"""
    if num_users < 100_000 and num_posts < 500_000:
        return create_mini_phoenix(**kwargs)
    return create_medium_phoenix(**kwargs)
