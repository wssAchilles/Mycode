import torch
import torch.nn as nn
import math

class PhoenixRanker(nn.Module):
    def __init__(self, num_news, embedding_dim=256, num_heads=4, num_layers=4, dropout=0.1):
        """
        Phoenix Ranking Model (Simplified)
        - Uses Transformer Encoder with restricted attention (Candidate Isolation)
        - Predicts multiple interaction probabilities (Click, Like, Repost)
        """
        super().__init__()
        self.embedding_dim = embedding_dim
        
        # Embeddings
        self.news_embedding = nn.Embedding(num_news, embedding_dim)
        self.position_embedding = nn.Embedding(512, embedding_dim) # Max seq len
        
        # Transformer
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embedding_dim,
            nhead=num_heads,
            dim_feedforward=embedding_dim * 4,
            dropout=dropout,
            batch_first=True,
            norm_first=True # Pre-Norm usually better for convergence
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        
        # Heads (Multi-Task Learning)
        # 预测 user 是否会对 candidate 产生交互
        self.click_head = nn.Linear(embedding_dim, 1)
        self.like_head = nn.Linear(embedding_dim, 1)
        self.reply_head = nn.Linear(embedding_dim, 1)
        self.repost_head = nn.Linear(embedding_dim, 1)
        
        self.dropout = nn.Dropout(dropout)
        self.ln_f = nn.LayerNorm(embedding_dim)

    def generate_square_subsequent_mask(self, sz: int) -> torch.Tensor:
        """Standard causal mask (not used here, but for reference)"""
        return torch.triu(torch.ones(sz, sz) * float('-inf'), diagonal=1)

    def create_isolation_mask(self, history_len, num_candidates):
        """
        Create Attention Mask for Candidate Isolation
        [History, Candidates]
        - History can attend to History (Bidirectional)
        - Candidates can attend to History
        - Candidates CANNOT attend to other Candidates (Isolation)
        """
        total_len = history_len + num_candidates
        # Initialize with 0 (allow attention)
        # Mask shape: [total_len, total_len]
        # PyTorch attention mask: 0=ok, -inf=masked (or True=masked depending on version, generic is float mask)
        
        mask = torch.zeros((total_len, total_len), dtype=torch.float)
        
        # Block Candidates from attending to other Candidates
        # Region: [history_len:, history_len:]
        # We want diagonal to be 0 (self-attention allowed), off-diagonal to be -inf
        
        cand_region_size = num_candidates
        # Create a matrix where off-diagonals are -inf
        candidates_mask = torch.full((cand_region_size, cand_region_size), float('-inf'))
        candidates_mask.fill_diagonal_(0.0)
        
        mask[history_len:, history_len:] = candidates_mask
        
        # History -> Candidates? Usually History doesn't attend to future Candidates.
        # But in Encoder, we output vectors for all positions.
        # The vector for 'History' token shouldn't "see" the candidate to avoid leakage if we used history rep?
        # Typically we only care about the Output at the Candidate positions.
        # So it doesn't matter what History attends to as long as Candidates attend correctly.
        # For strictness, let's block History -> Candidates.
        mask[:history_len, history_len:] = float('-inf')
        
        return mask

    def forward(self, history_ids, candidate_ids):
        """
        history_ids: [batch, history_len]
        candidate_ids: [batch, num_candidates]
        """
        batch_size, hist_len = history_ids.shape
        _, cand_len = candidate_ids.shape
        
        # 1. Combine Input: [History, Candidates]
        input_ids = torch.cat([history_ids, candidate_ids], dim=1) # [batch, seq_len]
        seq_len = input_ids.shape[1]
        
        # 2. Embeddings + Positional
        x = self.news_embedding(input_ids)
        positions = torch.arange(seq_len, device=input_ids.device).unsqueeze(0)
        x = x + self.position_embedding(positions)
        x = self.dropout(x)
        
        # 3. Create Mask
        # All batches share the same structural mask (since lengths are fixed/padded)
        # Note: In real variable length, we'd need padding mask too.
        # Here we assume fixed length for simplicity or padding handled by mask.
        mask = self.create_isolation_mask(hist_len, cand_len).to(input_ids.device)
        
        # 4. Transformer
        # x: [batch, seq, dim]
        # mask needs to be compatible with PyTorch version.
        # For TransformerEncoder: mask shape (L, L) or (N*num_heads, L, L)
        out = self.transformer(x, mask=mask)
        out = self.ln_f(out)
        
        # 5. Extract Candidate Outputs
        # Only take the vectors corresponding to candidates
        candidate_out = out[:, hist_len:, :] # [batch, num_cands, dim]
        
        # 6. Heads
        # Prediction for EACH candidate
        click_logits = self.click_head(candidate_out).squeeze(-1) # [batch, num_cands]
        like_logits = self.like_head(candidate_out).squeeze(-1)
        reply_logits = self.reply_head(candidate_out).squeeze(-1)
        repost_logits = self.repost_head(candidate_out).squeeze(-1)
        
        return {
            "click": click_logits,
            "like": like_logits,
            "reply": reply_logits,
            "repost": repost_logits
        }
