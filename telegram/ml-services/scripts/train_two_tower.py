import torch
from torch.utils.data import Dataset, DataLoader
import pickle
import numpy as np
from pathlib import Path
from tqdm import tqdm
import torch.nn as nn
import torch.optim as optim
from model_arch import TwoTowerModel

# 配置 (Max Scale for Colab Pro)
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"

# 🚀 H100 (80GB VRAM) EXTREME Configuration
BATCH_SIZE = 65536    # 炸裂级 Batch Size，跑满 H100
EMBEDDING_DIM = 768    
EPOCHS = 50            # 跑得快，多跑几轮
LR = 0.001             # 大 Batch 通常配合稍大一点的 LR (或配合 Warmup，这里保持稳健)
MAX_HISTORY_LEN = 100  

# 设备配置 (优先使用 MPS)
if torch.backends.mps.is_available():
    device = torch.device("mps")
    print("🚀 Using MPS (Apple Silicon) acceleration")
elif torch.cuda.is_available():
    device = torch.device("cuda")
    print("🚀 Using CUDA acceleration")
else:
    device = torch.device("cpu")
    print("⚠️ Using CPU")

class MindDataset(Dataset):
    def __init__(self, samples_path, news_vocab, user_vocab):
        print(f"Loading data from {samples_path}...")
        with open(samples_path, "rb") as f:
            self.samples = pickle.load(f)
        self.news_vocab = news_vocab
        self.user_vocab = user_vocab
        
    def __len__(self):
        return len(self.samples)
    
    def __getitem__(self, idx):
        sample = self.samples[idx]
        
        # User ID
        user_id = self.user_vocab.get(sample['user_id'], self.user_vocab.get("<UNK>", 0))
        
        # History
        history_ids = [self.news_vocab.get(nid, self.news_vocab.get("<UNK>", 0)) for nid in sample['history']]
        # Pad/Truncate
        if len(history_ids) > MAX_HISTORY_LEN:
            history_ids = history_ids[-MAX_HISTORY_LEN:]
            mask = [1] * MAX_HISTORY_LEN
        else:
            len_hist = len(history_ids)
            history_ids = history_ids + [0] * (MAX_HISTORY_LEN - len_hist)
            mask = [1] * len_hist + [0] * (MAX_HISTORY_LEN - len_hist)
            
        # Target News
        target_id = self.news_vocab.get(sample['candidate_id'], self.news_vocab.get("<UNK>", 0))
        
        # Label
        label = float(sample['label'])
        
        return {
            "user_id": torch.tensor(user_id, dtype=torch.long),
            "history": torch.tensor(history_ids, dtype=torch.long),
            "mask": torch.tensor(mask, dtype=torch.float),
            "target": torch.tensor(target_id, dtype=torch.long),
            "label": torch.tensor(label, dtype=torch.float)
        }

def train():
    # 1. 加载词表
    print("📖 Loading vocabularies...")
    with open(DATA_DIR / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
    with open(DATA_DIR / "user_vocab.pkl", "rb") as f:
        user_vocab = pickle.load(f)
        
    # 2. 创建 Dataset & DataLoader (Optimized for H100)
    # 启用多进程加载 (num_workers) 和 锁页内存 (pin_memory) 消除 CPU 瓶颈
    train_dataset = MindDataset(DATA_DIR / "train_samples.pkl", news_vocab, user_vocab)
    train_loader = DataLoader(
        train_dataset, 
        batch_size=BATCH_SIZE, 
        shuffle=True,
        num_workers=8,        # 4个 CPU 核心并行预处理数据
        pin_memory=True,      # 加速 CPU -> GPU 传输
        persistent_workers=True, # 保持进程活跃，避免每个 Epoch 重启开销
        prefetch_factor=4     # 预取更多数据，让 CPU 跑在 GPU 前面
    )
    
    # 3. 初始化模型
    model = TwoTowerModel(
        num_users=len(user_vocab),
        num_news=len(news_vocab),
        embedding_dim=EMBEDDING_DIM
    ).to(device)
    
    criterion = nn.BCEWithLogitsLoss() # Binary Cross Entropy
    optimizer = optim.Adam(model.parameters(), lr=LR)
    
    print(f"🔥 Start training for {EPOCHS} epochs...")
    model.train()
    
    for epoch in range(EPOCHS):
        total_loss = 0
        progress_bar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{EPOCHS}")
        
        for batch in progress_bar:
            # Move to device
            user_ids = batch['user_id'].to(device)
            history = batch['history'].to(device)
            mask = batch['mask'].to(device)
            targets = batch['target'].to(device)
            labels = batch['label'].to(device)
            
            # Forward
            logits, _, _ = model(user_ids, history, mask, targets)
            
            # Loss
            # BCEWithLogitsLoss expects [batch]
            loss = criterion(logits, labels)
            
            # Backward
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            progress_bar.set_postfix({"loss": f"{loss.item():.4f}"})
            
        avg_loss = total_loss / len(train_loader)
        print(f"✅ Epoch {epoch+1} finished. Avg Loss: {avg_loss:.4f}")
        
        # Save checkpoint
        MODELS_DIR.mkdir(exist_ok=True)
        torch.save(model.state_dict(), MODELS_DIR / f"two_tower_epoch_{epoch+1}.pt")

    print("🎉 Training finished!")
    
    # Save embeddings for FAISS
    print("💾 Saving embeddings for Retrieval Service...")
    model.eval()
    with torch.no_grad():
        # Export Item Embeddings
        # 注意: 这里只导出了训练集中见过的 News Embedding。
        # 实际生产中需要对所有 News 进行 inference。
        # 这里简单起见，直接保存 Embedding 层的权重 (如果只用 ID Embedding)
        item_embeddings = model.news_encoder.news_embedding.weight.data.cpu().numpy()
        np.save(DATA_DIR / "item_embeddings.npy", item_embeddings)
        print(f"   Saved {item_embeddings.shape[0]} item embeddings.")

if __name__ == "__main__":
    train()
