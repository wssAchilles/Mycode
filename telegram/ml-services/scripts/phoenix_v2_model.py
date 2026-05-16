"""
Phoenix V2 Ranking Model — 适配小规模训练的完整实现

核心改进 (对标 x-algorithm):
1. 多类型 Embedding: User Hash + Post + Author + Action Type
2. Candidate Isolation Mask (与 X 完全一致)
3. 10 个动作预测头 (覆盖正向+负向行为)
4. Padding Mask 支持变长序列
5. 支持 128-dim / 256-dim 两种规模

硬件要求:
  - 128-dim (mini): T4 16GB, ~10 分钟/epoch
  - 256-dim (medium): A10G 24GB, ~30 分钟/epoch
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import math
from typing import Dict, Optional


# ============================================================
# Action Type 定义 (与后端 ActionType 枚举对齐)
# ============================================================
ACTION_TYPES = [
    "like",            # 0
    "reply",           # 1
    "repost",          # 2
    "quote",           # 3
    "click",           # 4
    "profile_click",   # 5
    "share",           # 6
    "impression",      # 7
    "video_view",      # 8
    "dwell",           # 9
    "dismiss",         # 10
    "block_author",    # 11
    "report",          # 12
]
NUM_ACTION_TYPES = len(ACTION_TYPES)

# 预测头: 10 种动作概率 (X 有 15 种, 我们覆盖最重要的 10 种)
PREDICTED_ACTIONS = [
    "click",           # P(click)
    "like",            # P(favorite)
    "reply",           # P(reply)
    "repost",          # P(repost)
    "quote",           # P(quote)
    "share",           # P(share)
    "dwell",           # P(dwell > threshold)
    "video_view",      # P(video_view)
    "dismiss",         # P(not_interested) — 负向
    "report",          # P(report) — 负向
]
NUM_PREDICTED_ACTIONS = len(PREDICTED_ACTIONS)


# ============================================================
# Hash-Based Embedding (对标 X 的 hash-based embeddings)
# ============================================================
class HashEmbedding(nn.Module):
    """
    多哈希嵌入 — 用 K 个 hash function 将 ID 映射到 K 个 embedding table,
    然后拼接/求和。泛化性好，不需要完整的 ID 词表。

    X 使用 2 个 hash function, 1M vocab each。
    小规模我们用 2 个 hash, 50K vocab each。
    """

    def __init__(self, num_hashes: int = 2, vocab_size: int = 50_000, dim: int = 64):
        super().__init__()
        self.num_hashes = num_hashes
        self.vocab_size = vocab_size
        self.dim = dim
        self.tables = nn.ModuleList([
            nn.Embedding(vocab_size, dim) for _ in range(num_hashes)
        ])

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        """
        ids: [*] 任意形状的 ID tensor
        返回: [*, dim] 嵌入 (各 hash table 之和)
        """
        result = torch.zeros(*ids.shape, self.dim, device=ids.device, dtype=torch.float)
        for i, table in enumerate(self.tables):
            hashed = ids % (self.vocab_size + i * 31337)  # 不同 hash function
            hashed = hashed % self.vocab_size
            result = result + table(hashed)
        return result


# ============================================================
# History Token: [PostEmb + AuthorEmb + ActionEmb + PositionEmb]
# ============================================================
class HistoryTokenizer(nn.Module):
    """
    将用户行为序列的每个 token 编码为:
      post_embedding + author_embedding + action_type_embedding + position_embedding
    """

    def __init__(self, dim: int, max_seq_len: int = 200, num_hashes: int = 2):
        super().__init__()
        hash_dim = dim // 3  # post + author + action 各占 dim/3
        self.post_emb = HashEmbedding(num_hashes, 100_000, hash_dim)
        self.author_emb = HashEmbedding(num_hashes, 50_000, hash_dim)
        self.action_emb = nn.Embedding(NUM_ACTION_TYPES, hash_dim)
        self.position_emb = nn.Embedding(max_seq_len, dim)
        self.proj = nn.Linear(hash_dim * 3, dim)

    def forward(
        self,
        post_ids: torch.Tensor,      # [B, S]
        author_ids: torch.Tensor,     # [B, S]
        action_types: torch.Tensor,   # [B, S]
        positions: torch.Tensor,      # [B, S]
    ) -> torch.Tensor:
        post_h = self.post_emb(post_ids)           # [B, S, hash_dim]
        author_h = self.author_emb(author_ids)     # [B, S, hash_dim]
        action_h = self.action_emb(action_types)   # [B, S, hash_dim]
        combined = torch.cat([post_h, author_h, action_h], dim=-1)  # [B, S, 3*hash_dim]
        token = self.proj(combined)                # [B, S, dim]
        token = token + self.position_emb(positions)
        return token


# ============================================================
# Candidate Token: [PostEmb + AuthorEmb + PositionEmb]
# ============================================================
class CandidateTokenizer(nn.Module):
    """
    候选帖子编码: post_embedding + author_embedding + position_embedding
    (没有 action_type，因为候选还没被交互)
    """

    def __init__(self, dim: int, max_candidates: int = 64, num_hashes: int = 2):
        super().__init__()
        hash_dim = dim // 2
        self.post_emb = HashEmbedding(num_hashes, 100_000, hash_dim)
        self.author_emb = HashEmbedding(num_hashes, 50_000, hash_dim)
        self.position_emb = nn.Embedding(max_candidates, dim)
        self.proj = nn.Linear(hash_dim * 2, dim)

    def forward(
        self,
        post_ids: torch.Tensor,    # [B, C]
        author_ids: torch.Tensor,  # [B, C]
        positions: torch.Tensor,   # [B, C]
    ) -> torch.Tensor:
        post_h = self.post_emb(post_ids)         # [B, C, hash_dim]
        author_h = self.author_emb(author_ids)   # [B, C, hash_dim]
        combined = torch.cat([post_h, author_h], dim=-1)
        token = self.proj(combined)
        token = token + self.position_emb(positions)
        return token


# ============================================================
# Phoenix V2 Ranker (完整模型)
# ============================================================
class PhoenixV2Ranker(nn.Module):
    """
    Phoenix V2 排序模型

    架构:
      History Tokens [B, S, D] + Candidate Tokens [B, C, D]
      → Concatenate → Transformer Encoder (with Candidate Isolation Mask)
      → Extract Candidate outputs → 10 个动作预测头

    Candidate Isolation:
      - History ↔ History: full attention
      - Candidates → History: full attention
      - Candidates → Candidates: ONLY self-attention (diagonal)
      - History → Candidates: blocked (防止信息泄漏)
    """

    def __init__(
        self,
        dim: int = 128,
        num_heads: int = 4,
        num_layers: int = 4,
        ff_dim: Optional[int] = None,
        dropout: float = 0.1,
        max_history_len: int = 100,
        max_candidates: int = 32,
        num_hashes: int = 2,
    ):
        super().__init__()
        self.dim = dim
        self.max_history_len = max_history_len
        self.max_candidates = max_candidates
        ff_dim = ff_dim or dim * 4

        # Tokenizers
        self.history_tokenizer = HistoryTokenizer(dim, max_history_len * 2, num_hashes)
        self.candidate_tokenizer = CandidateTokenizer(dim, max_candidates, num_hashes)

        # User embedding (global user preference)
        self.user_emb = HashEmbedding(num_hashes, 50_000, dim)

        # Transformer Encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=dim,
            nhead=num_heads,
            dim_feedforward=ff_dim,
            dropout=dropout,
            batch_first=True,
            norm_first=True,  # Pre-Norm (更好的收敛性)
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.final_norm = nn.LayerNorm(dim)

        # 10 个动作预测头 (对标 X 的 15 个, 我们保留最重要的 10 个)
        self.action_heads = nn.ModuleDict({
            name: nn.Linear(dim, 1) for name in PREDICTED_ACTIONS
        })

        self.dropout = nn.Dropout(dropout)

        self._init_weights()

    def _init_weights(self):
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.xavier_uniform_(p)

    def _build_isolation_mask(
        self, history_len: int, num_candidates: int, device: torch.device
    ) -> torch.Tensor:
        """
        构建 Candidate Isolation Mask (与 X 的实现完全一致)

        布局: [User(1) | History(S) | Candidates(C)]

        - User + History: 互相全注意力
        - Candidates → User/History: 可以注意
        - Candidates → Candidates: 只能 self-attention (对角线)
        - User/History → Candidates: 阻断
        """
        total = 1 + history_len + num_candidates  # +1 for user token
        mask = torch.zeros(total, total, device=device, dtype=torch.float)

        # 阻断 User/History 注意 Candidates
        user_hist_end = 1 + history_len
        mask[:user_hist_end, user_hist_end:] = float("-inf")

        # Candidates 只能 self-attention (对角线)
        cand_start = user_hist_end
        cand_mask = torch.full(
            (num_candidates, num_candidates), float("-inf"), device=device
        )
        cand_mask.fill_diagonal_(0.0)
        mask[cand_start:, cand_start:] = cand_mask

        return mask

    def forward(
        self,
        user_ids: torch.Tensor,            # [B]
        history_post_ids: torch.Tensor,     # [B, S]
        history_author_ids: torch.Tensor,   # [B, S]
        history_action_types: torch.Tensor, # [B, S]
        history_mask: torch.Tensor,         # [B, S] (1=valid, 0=pad)
        candidate_post_ids: torch.Tensor,   # [B, C]
        candidate_author_ids: torch.Tensor, # [B, C]
        candidate_mask: torch.Tensor,       # [B, C] (1=valid, 0=pad)
    ) -> Dict[str, torch.Tensor]:
        B, S = history_post_ids.shape
        C = candidate_post_ids.shape[1]

        # 1. User Token
        user_token = self.user_emb(user_ids).unsqueeze(1)  # [B, 1, D]

        # 2. History Tokens
        hist_positions = torch.arange(S, device=history_post_ids.device)
        hist_tokens = self.history_tokenizer(
            history_post_ids, history_author_ids, history_action_types,
            hist_positions.unsqueeze(0).expand(B, -1),
        )  # [B, S, D]

        # 3. Candidate Tokens
        cand_positions = torch.arange(C, device=candidate_post_ids.device)
        cand_tokens = self.candidate_tokenizer(
            candidate_post_ids, candidate_author_ids,
            cand_positions.unsqueeze(0).expand(B, -1),
        )  # [B, C, D]

        # 4. Concatenate: [User | History | Candidates]
        x = torch.cat([user_token, hist_tokens, cand_tokens], dim=1)  # [B, 1+S+C, D]
        x = self.dropout(x)

        # 5. Build masks
        # (a) Candidate Isolation Mask
        isolation_mask = self._build_isolation_mask(S, C, x.device)

        # (b) Padding Mask: True = ignore
        user_pad = torch.zeros(B, 1, device=x.device, dtype=torch.bool)
        hist_pad = (history_mask == 0)  # [B, S]
        cand_pad = (candidate_mask == 0)  # [B, C]
        padding_mask = torch.cat([user_pad, hist_pad, cand_pad], dim=1)  # [B, 1+S+C]

        # 6. Transformer
        out = self.transformer(x, mask=isolation_mask, src_key_padding_mask=padding_mask)
        out = self.final_norm(out)

        # 7. Extract Candidate outputs
        cand_out = out[:, 1 + S:, :]  # [B, C, D]

        # 8. Predict actions
        results = {}
        for name, head in self.action_heads.items():
            results[name] = head(cand_out).squeeze(-1)  # [B, C]

        return results


# ============================================================
# 工厂函数
# ============================================================
def create_mini_phoenix(**kwargs) -> PhoenixV2Ranker:
    """Mini 模型: T4 16GB, ~10 分钟/epoch (10万用户, 日均100万行为)"""
    defaults = dict(dim=128, num_heads=4, num_layers=4, ff_dim=512, dropout=0.1,
                    max_history_len=64, max_candidates=32, num_hashes=2)
    defaults.update(kwargs)
    return PhoenixV2Ranker(**defaults)


def create_medium_phoenix(**kwargs) -> PhoenixV2Ranker:
    """Medium 模型: A10G 24GB, ~30 分钟/epoch"""
    defaults = dict(dim=256, num_heads=8, num_layers=6, ff_dim=1024, dropout=0.1,
                    max_history_len=100, max_candidates=32, num_hashes=2)
    defaults.update(kwargs)
    return PhoenixV2Ranker(**defaults)


def create_phoenix_for_scale(num_users: int, num_posts: int) -> PhoenixV2Ranker:
    """根据数据规模自动选择模型大小"""
    if num_users < 100_000 and num_posts < 500_000:
        print(f"📊 Scale: {num_users} users, {num_posts} posts → Using MINI Phoenix")
        return create_mini_phoenix()
    else:
        print(f"📊 Scale: {num_users} users, {num_posts} posts → Using MEDIUM Phoenix")
        return create_medium_phoenix()
