import torch
import torch.nn as nn
import torch.nn.functional as F

class NewsEncoder(nn.Module):
    def __init__(self, num_news, num_categories, embedding_dim=64):
        """
        新闻侧塔：将新闻编码为向量
        简单实现：News ID Embedding + Category Embedding (如果有)
        """
        super().__init__()
        # News ID Embedding
        self.news_embedding = nn.Embedding(num_news, embedding_dim)
        # 这里的 num_categories 可以是 subcategory 的数量，简单起见先只用 ID
        # 如果需要文本特征，可以后续接入 BERT/CNN
        
        self.fc = nn.Sequential(
            nn.Linear(embedding_dim, embedding_dim),
            nn.ReLU(),
            nn.Linear(embedding_dim, embedding_dim)
        )

    def forward(self, news_ids):
        # news_ids: [batch_size]
        emb = self.news_embedding(news_ids)
        out = self.fc(emb)
        return F.normalize(out, p=2, dim=1) # L2 归一化，方便计算 Cosine 相似度


class UserEncoder(nn.Module):
    def __init__(self, num_users, news_encoder, embedding_dim=64):
        """
        用户侧塔：将用户编码为向量
        实现：如果是新用户，用 UserID Embedding；
        如果有历史行为，用 History News Embeddings 的平均/Attention
        在此简化实现中：Avg Pooling of History News
        """
        super().__init__()
        self.user_embedding = nn.Embedding(num_users, embedding_dim)
        self.news_encoder = news_encoder # 共享 News Encoder 用于编码历史
        
        self.fc = nn.Sequential(
            nn.Linear(embedding_dim, embedding_dim),
            nn.ReLU(),
            nn.Linear(embedding_dim, embedding_dim)
        )

    def forward(self, user_ids, history_news_ids, history_mask):
        """
        user_ids: [batch_size]
        history_news_ids: [batch_size, max_history_len]
        history_mask: [batch_size, max_history_len] (1=valid, 0=pad)
        """
        # 1. User ID Embedding (作为 Base 偏好)
        user_emb = self.user_embedding(user_ids)
        
        # 2. History Embedding (Avg Pooling)
        # [batch, seq, dim]
        history_emb = self.news_encoder.news_embedding(history_news_ids)
        
        # Mask out padding
        mask = history_mask.unsqueeze(-1) # [batch, seq, 1]
        history_emb = history_emb * mask
        
        # Sum & Mean
        sum_emb = history_emb.sum(dim=1) # [batch, dim]
        count = mask.sum(dim=1).clamp(min=1) # [batch, 1]
        avg_history_emb = sum_emb / count
        
        # Combine (Simple Add or Concat)
        # 这里用简单相加
        combined = user_emb + avg_history_emb
        
        out = self.fc(combined)
        return F.normalize(out, p=2, dim=1)

class TwoTowerModel(nn.Module):
    def __init__(self, num_users, num_news, embedding_dim=64):
        super().__init__()
        self.news_encoder = NewsEncoder(num_news, num_categories=0, embedding_dim=embedding_dim)
        self.user_encoder = UserEncoder(num_users, self.news_encoder, embedding_dim=embedding_dim)
        
    def forward(self, user_ids, history_news_ids, history_mask, target_news_ids):
        """
        训练时的前向传播
        """
        # 1. 生成 User Vector
        user_vec = self.user_encoder(user_ids, history_news_ids, history_mask)
        
        # 2. 生成 Target Item Vector
        item_vec = self.news_encoder(target_news_ids)
        
        # 3. 计算 Logits (Cosine Similarity * Temperature)
        # 因为已经归一化，Dot Product 就是 Cosine Similarity
        logits = (user_vec * item_vec).sum(dim=1)
        
        return logits, user_vec, item_vec
