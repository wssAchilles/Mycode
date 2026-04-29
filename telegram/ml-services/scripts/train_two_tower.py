import argparse
import pickle
import shutil
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from model_arch import TwoTowerModel
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

# 配置 (Max Scale for Colab Pro)
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"

# Defaults are tuned for Colab H100 but can be lowered for smaller runtimes.
BATCH_SIZE = 65536
EMBEDDING_DIM = 768
EPOCHS = 50
LR = 0.001
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
    def __init__(self, samples_path, news_vocab, user_vocab, max_history_len: int):
        print(f"Loading data from {samples_path}...")
        with open(samples_path, "rb") as f:
            self.samples = pickle.load(f)
        self.news_vocab = news_vocab
        self.user_vocab = user_vocab
        self.max_history_len = max_history_len
        
    def __len__(self):
        return len(self.samples)
    
    def __getitem__(self, idx):
        sample = self.samples[idx]
        
        # User ID
        user_id = self.user_vocab.get(sample['user_id'], self.user_vocab.get("<UNK>", 0))
        
        # History
        history_ids = [self.news_vocab.get(nid, self.news_vocab.get("<UNK>", 0)) for nid in sample['history']]
        # Pad/Truncate
        if len(history_ids) > self.max_history_len:
            history_ids = history_ids[-self.max_history_len:]
            mask = [1] * self.max_history_len
        else:
            len_hist = len(history_ids)
            history_ids = history_ids + [0] * (self.max_history_len - len_hist)
            mask = [1] * len_hist + [0] * (self.max_history_len - len_hist)
            
        # Target News
        target_id = self.news_vocab.get(sample['candidate_id'], self.news_vocab.get("<UNK>", 0))
        
        # Label
        label = float(sample.get('label', 0.0))
        sample_weight = float(sample.get("sample_weight", 1.0))
        
        return {
            "user_id": torch.tensor(user_id, dtype=torch.long),
            "history": torch.tensor(history_ids, dtype=torch.long),
            "mask": torch.tensor(mask, dtype=torch.float),
            "target": torch.tensor(target_id, dtype=torch.long),
            "label": torch.tensor(label, dtype=torch.float),
            "sample_weight": torch.tensor(sample_weight, dtype=torch.float),
        }

def parse_args():
    parser = argparse.ArgumentParser(description="Train the Two-Tower retrieval model.")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument("--samples", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--embedding-dim", type=int, default=EMBEDDING_DIM)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--lr", type=float, default=LR)
    parser.add_argument("--max-history-len", type=int, default=MAX_HISTORY_LEN)
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--no-pin-memory", action="store_true")
    parser.add_argument(
        "--save-policy",
        choices=["all", "latest"],
        default="all",
        help="all keeps every epoch checkpoint; latest overwrites only two_tower_epoch_latest.pt.",
    )
    parser.add_argument(
        "--item-embedding-dtype",
        choices=["float32", "float16"],
        default="float32",
        help="dtype for exported item_embeddings.npy used by FAISS build.",
    )
    return parser.parse_args()


def train():
    args = parse_args()
    data_dir = args.data_dir
    models_dir = args.models_dir
    samples_path = args.samples or (data_dir / "train_samples.pkl")

    # 1. 加载词表
    print("📖 Loading vocabularies...")
    with open(data_dir / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
    with open(data_dir / "user_vocab.pkl", "rb") as f:
        user_vocab = pickle.load(f)
        
    # 2. 创建 Dataset & DataLoader (Optimized for H100)
    # 启用多进程加载 (num_workers) 和 锁页内存 (pin_memory) 消除 CPU 瓶颈
    train_dataset = MindDataset(samples_path, news_vocab, user_vocab, args.max_history_len)
    train_loader = DataLoader(
        train_dataset, 
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=not args.no_pin_memory and device.type == "cuda",
        persistent_workers=args.num_workers > 0,
        prefetch_factor=4 if args.num_workers > 0 else None,
    )
    
    # 3. 初始化模型
    model = TwoTowerModel(
        num_users=len(user_vocab),
        num_news=len(news_vocab),
        embedding_dim=args.embedding_dim,
    ).to(device)
    
    criterion = nn.BCEWithLogitsLoss(reduction="none")
    optimizer = optim.Adam(model.parameters(), lr=args.lr)
    
    print(f"🔥 Start training for {args.epochs} epochs...")
    model.train()
    
    latest_path = None
    for epoch in range(args.epochs):
        total_loss = 0
        progress_bar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{args.epochs}")
        
        for batch in progress_bar:
            # Move to device
            user_ids = batch['user_id'].to(device)
            history = batch['history'].to(device)
            mask = batch['mask'].to(device)
            targets = batch['target'].to(device)
            labels = batch['label'].to(device)
            sample_weights = batch['sample_weight'].to(device).clamp(min=0.1, max=10.0)
            
            # Forward
            logits, _, _ = model(user_ids, history, mask, targets)
            
            # Loss
            # BCEWithLogitsLoss expects [batch]
            loss = (criterion(logits, labels) * sample_weights).mean()
            
            # Backward
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            progress_bar.set_postfix({"loss": f"{loss.item():.4f}"})
            
        avg_loss = total_loss / len(train_loader)
        print(f"✅ Epoch {epoch+1} finished. Avg Loss: {avg_loss:.4f}")
        
        # Save checkpoint
        models_dir.mkdir(exist_ok=True)
        if args.save_policy == "latest":
            latest_path = models_dir / "two_tower_epoch_latest.pt"
        else:
            latest_path = models_dir / f"two_tower_epoch_{epoch+1}.pt"
        torch.save(model.state_dict(), latest_path)

    print("🎉 Training finished!")
    if latest_path is not None and latest_path.name != "two_tower_epoch_latest.pt":
        shutil.copyfile(latest_path, models_dir / "two_tower_epoch_latest.pt")
        print(f"   Latest checkpoint: {models_dir / 'two_tower_epoch_latest.pt'}")
    elif latest_path is not None:
        print(f"   Latest checkpoint: {latest_path}")
    
    # Save embeddings for FAISS
    print("💾 Saving embeddings for Retrieval Service...")
    model.eval()
    with torch.no_grad():
        # Export Item Embeddings
        # 注意: 这里只导出了训练集中见过的 News Embedding。
        # 实际生产中需要对所有 News 进行 inference。
        # 这里简单起见，直接保存 Embedding 层的权重 (如果只用 ID Embedding)
        item_embeddings = model.news_encoder.news_embedding.weight.data.cpu().numpy()
        if args.item_embedding_dtype == "float16":
            item_embeddings = item_embeddings.astype(np.float16)
        else:
            item_embeddings = item_embeddings.astype(np.float32)
        np.save(data_dir / "item_embeddings.npy", item_embeddings)
        print(f"   Saved {item_embeddings.shape[0]} item embeddings.")

if __name__ == "__main__":
    train()
