import torch
from torch.utils.data import Dataset, DataLoader
import pickle
import torch.nn as nn
import torch.optim as optim
from pathlib import Path
from tqdm import tqdm
from phoenix_model import PhoenixRanker
import torch.cuda.amp as amp # 1. 引入混合精度模块

# 配置 (Max Scale for Colab Pro)
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"

# 🚀 H100 (80GB VRAM) MAX PERFORMANCE Configuration
BATCH_SIZE = 1536       # 1024占用42GB，1536预计占用63GB (安全跑满)
EMBEDDING_DIM = 768    
NUM_HEADS = 12         
NUM_LAYERS = 12        
EPOCHS = 10            
LR = 5e-5              
MAX_HISTORY = 100      
NUM_CANDIDATES = 20    

# 设备
if torch.backends.mps.is_available():
    device = torch.device("mps")
elif torch.cuda.is_available():
    device = torch.device("cuda")
else:
    device = torch.device("cpu")

class PhoenixDataset(Dataset):
    def __init__(self, samples_path, news_vocab, user_vocab):
        # 复用 Two-Tower 的 samples 格式，但需要在 getitem 时动态构造多候选(Positive + Negatives)
        with open(samples_path, "rb") as f:
            self.samples = pickle.load(f)
        self.news_vocab = news_vocab
        self.num_news = len(news_vocab)
        
        # 预计算所有新闻ID列表用于负采样
        self.all_news_ids = list(news_vocab.values())
        
    def __len__(self):
        return len(self.samples)
    
    def __getitem__(self, idx):
        # 这是一个简化版 Listwise 训练数据构造
        # 原始 samples 是 pointwise (1个样本1个label)
        # 我们这里只取 Positive 样本，然后随机采样 Negatives
        
        sample = self.samples[idx]
        target_id = self.news_vocab.get(sample['candidate_id'], 0)
        label = sample['label']
        
        # Pointwise Training, Batch Size = B。
        # 此时 Phoenix 输入 Candidates 长度为 1。
        
        history_ids = [self.news_vocab.get(nid, 0) for nid in sample['history']]
        if len(history_ids) > MAX_HISTORY:
            history_ids = history_ids[-MAX_HISTORY:]
        else:
            history_ids = history_ids + [0] * (MAX_HISTORY - len(history_ids))
            
        return {
            "history": torch.tensor(history_ids, dtype=torch.long),
            "candidate": torch.tensor([target_id], dtype=torch.long), # [1]
            "label": torch.tensor(float(label), dtype=torch.float)
        }

def train():
    # 0. 显存大扫除 (防止残留)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    print("📖 Loading vocab...")
    with open(DATA_DIR / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
        
    print("preparing dataset...")
    dataset = PhoenixDataset(DATA_DIR / "train_samples.pkl", news_vocab, {})
    
    # 启用多进程加载 (num_workers) 和 锁页内存 (pin_memory)
    loader = DataLoader(
        dataset, 
        batch_size=BATCH_SIZE, 
        shuffle=True,
        num_workers=2,        # 回退到 4 (8 核心可能导致死锁/卡住)
        pin_memory=True,      # 加速数据传输到 GPU
        persistent_workers=True # 保持进程活跃
    )
    
    print("🔧 Init Phoenix Model...")
    model = PhoenixRanker(
        num_news=len(news_vocab),
        embedding_dim=EMBEDDING_DIM,
        num_heads=NUM_HEADS,
        num_layers=NUM_LAYERS
    ).to(device)
    
    criterion = nn.BCEWithLogitsLoss()
    optimizer = optim.AdamW(model.parameters(), lr=LR)
    
    # 2. 初始化 AMP Scaler
    scaler = amp.GradScaler()
    print("⚡ Mixed Precision Training (AMP) Enabled")
    
    model.train()
    print(f"🔥 Start Phoenix Training (Batch Size: {BATCH_SIZE})...")
    
    for epoch in range(EPOCHS):
        total_loss = 0
        pbar = tqdm(loader, desc=f"Epoch {epoch+1}")
        
        for batch in pbar:
            history = batch['history'].to(device) # [B, HistLen]
            candidate = batch['candidate'].to(device) # [B, 1]
            label = batch['label'].to(device) # [B]
            
            optimizer.zero_grad()
            
            # 3. 使用 Autocast 自动混合精度
            with amp.autocast():
                # Forward
                outputs = model(history, candidate)
                logits = outputs['click'].squeeze(-1) # [B, 1] -> [B, 1] or [B]??
                loss = criterion(logits.flatten(), label)
            
            # 4. 使用 Scaler 进行反向传播
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            
            total_loss += loss.item()
            pbar.set_postfix({"loss": f"{loss.item():.4f}"})
            
        avg_loss = total_loss / len(loader)
        print(f"✅ Epoch {epoch+1} finished. Loss: {avg_loss:.4f}")
        
        # Save
        torch.save(model.state_dict(), MODELS_DIR / f"phoenix_epoch_{epoch+1}.pt")

if __name__ == "__main__":
    train()
