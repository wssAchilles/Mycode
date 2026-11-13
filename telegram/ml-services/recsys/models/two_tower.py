"""Two-Tower 双塔召回模型定义，严格保持与线上 checkpoint 权重键名兼容。"""

from __future__ import annotations

from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class NewsEncoder(nn.Module):
    """新闻/帖子编码器：ID 嵌入经过 MLP 投影并做 L2 归一化。"""

    def __init__(self, num_news: int, embedding_dim: int = 256):
        super().__init__()
        self.news_embedding = nn.Embedding(num_news, embedding_dim, padding_idx=0)
        self.fc = nn.Sequential(
            nn.Linear(embedding_dim, embedding_dim),
            nn.ReLU(),
            nn.Linear(embedding_dim, embedding_dim),
        )

    def forward(self, news_ids: torch.Tensor) -> torch.Tensor:
        """将候选 ID 张量编码为单位 L2 范数向量。"""
        emb = self.news_embedding(news_ids)
        out = self.fc(emb)
        return F.normalize(out, p=2, dim=1)


class UserEncoder(nn.Module):
    """用户编码器：融合用户 ID 嵌入与历史序列带掩码均值池化向量。"""

    def __init__(self, num_users: int, news_encoder: NewsEncoder, embedding_dim: int = 256):
        super().__init__()
        self.user_embedding = nn.Embedding(num_users, embedding_dim, padding_idx=0)
        self.news_encoder = news_encoder
        self.fc = nn.Sequential(
            nn.Linear(embedding_dim, embedding_dim),
            nn.ReLU(),
            nn.Linear(embedding_dim, embedding_dim),
        )

    def forward(
        self,
        user_ids: torch.Tensor,
        history_news_ids: torch.Tensor,
        history_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """输出与 NewsEncoder 同一投影空间且经过 L2 归一化的用户查询向量。"""
        user_emb = self.user_embedding(user_ids)
        history_emb = self.news_encoder.news_embedding(history_news_ids)

        if history_mask is not None:
            mask = history_mask.unsqueeze(-1)
            history_emb = history_emb * mask
            sum_emb = history_emb.sum(dim=1)
            count = mask.sum(dim=1).clamp(min=1e-9)
            avg_history_emb = sum_emb / count
        else:
            avg_history_emb = history_emb.mean(dim=1)

        combined = user_emb + avg_history_emb
        out = self.fc(combined)
        return F.normalize(out, p=2, dim=1)


class TwoTowerModel(nn.Module):
    """Two-Tower 双塔召回模型：训练与全量物料推理共享同一投影空间。"""

    def __init__(self, num_users: int, num_news: int, embedding_dim: int = 256):
        super().__init__()
        self.news_encoder = NewsEncoder(num_news, embedding_dim)
        self.user_encoder = UserEncoder(num_users, self.news_encoder, embedding_dim)

    def forward(
        self,
        user_ids: torch.Tensor,
        history_news_ids: torch.Tensor,
        history_mask: torch.Tensor,
        target_news_ids: torch.Tensor,
        neg_news_ids: Optional[torch.Tensor] = None,
    ):
        """训练前向传播：计算用户向量与正/负样本的内积相似度（余弦相似度）。"""
        user_vec = self.user_encoder(user_ids, history_news_ids, history_mask)
        target_vec = self.news_encoder(target_news_ids)
        pos_score = (user_vec * target_vec).sum(dim=1)

        if neg_news_ids is not None:
            batch_size, num_neg = neg_news_ids.shape
            flat_neg_ids = neg_news_ids.view(-1)
            neg_vec = self.news_encoder(flat_neg_ids).view(batch_size, num_neg, -1)
            neg_score = torch.bmm(neg_vec, user_vec.unsqueeze(2)).squeeze(2)
            return pos_score, neg_score

        return pos_score

    def encode_items(self, news_ids: torch.Tensor) -> torch.Tensor:
        """显式通过 NewsEncoder MLP 投影与 L2 归一化编码候选物品向量。"""
        return self.news_encoder(news_ids)

    @torch.no_grad()
    def encode_all_items(
        self,
        *,
        batch_size: int = 2048,
        device: Optional[torch.device] = None,
        dtype: np.dtype = np.float32,
    ) -> np.ndarray:
        """按批次通过完整 NewsEncoder.forward() 导出所有物品向量，消除静态表漂移。"""
        was_training = self.training
        self.eval()
        target_device = device or self.news_encoder.news_embedding.weight.device
        num_items = int(self.news_encoder.news_embedding.num_embeddings)
        dim = int(self.news_encoder.news_embedding.embedding_dim)

        output = np.empty((num_items, dim), dtype=dtype)
        try:
            for start in range(0, num_items, max(1, int(batch_size))):
                end = min(num_items, start + max(1, int(batch_size)))
                ids = torch.arange(start, end, dtype=torch.long, device=target_device)
                vecs = self.news_encoder(ids).detach().cpu().numpy()
                output[start:end] = vecs.astype(dtype, copy=False)
        finally:
            if was_training:
                self.train()
        return output


def compute_infonce_loss(
    user_vec: torch.Tensor,
    pos_item_vec: torch.Tensor,
    *,
    temperature: float = 0.07,
    item_log_probs: Optional[torch.Tensor] = None,
) -> torch.Tensor:
    """
    计算带 batch 内负采样与可选 Log-Q 流行度纠偏的 InfoNCE 对比损失。
    参考 Google/X Two-Tower 工业实现：logits[i, j] = <u_i, v_j> / T - log_q[j]。
    """
    temp = max(1e-4, float(temperature))
    logits = torch.matmul(user_vec, pos_item_vec.t()) / temp
    if item_log_probs is not None:
        # 对 batch 内作为负样本出现的高频物品做 Log-Q 纠偏，抑制热门偏置
        correction = item_log_probs.view(1, -1).to(logits.device, dtype=logits.dtype)
        batch_size = logits.size(0)
        diag_mask = torch.eye(batch_size, device=logits.device, dtype=torch.bool)
        logits = logits - torch.where(diag_mask, torch.zeros_like(logits), correction)

    labels = torch.arange(logits.size(0), device=logits.device, dtype=torch.long)
    return F.cross_entropy(logits, labels)
