import torch
from torch.utils.data import Dataset, DataLoader
import pickle
import torch.nn as nn
import torch.optim as optim
from pathlib import Path
from tqdm import tqdm
from phoenix_model import PhoenixRanker

# 配置
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"
BATCH_SIZE = 64 # Transformer 显存占用大，调小 Batch
EMBEDDING_DIM = 256
NUM_HEADS = 4
NUM_LAYERS = 2 # 快速训练 demo (实际可用 4-6)
EPOCHS = 3
LR = 0.0001
MAX_HISTORY = 40
NUM_CANDIDATES = 5 # 每次训练采样 1正 + 4负

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
        
        # 为了简单，我们仍遍历 samples。如果是 Positive，就随机采负。
        # 如果是 Negative 样本... 这里为了演示 Candidate Isolation，我们强制构造 list。
        
        sample = self.samples[idx]
        target_id = self.news_vocab.get(sample['candidate_id'], 0)
        label = sample['label']
        
        # 简单 Hack: 只拿 Label=1 的数据来训练 List 排序?
        # 这样会丢弃 dataset 里原本的 Label=0 的强负例（Impressions but not clicked）。
        # 正确做法：按 Session/ImpressionID 聚合。
        # 但 preprocess_mind output 已经是 flat samples。
        # 妥协：每次只训练 1 个 candidate (Pointwise)，但依然走 Phoenix 架构 (num_candidates=1)。
        # 或者：在线随机负采样。
        
        # 让我们做 Pointwise 但支持 batch 维度扩展 (这里 num_candidates=1)
        # 这样代码简单，且能利用现有的 samples。 Isolation Mask 此时退化为无。
        
        # **修正**：为了展示 Phoenix "评分多个候选" 的能力，我们在 Inference 时会传入多个。
        # 在 Training 时，如果我们用 Pointwise Loss (BCE)，我们只需要传 1 个 candidate。
        # 如果用 Listwise Loss (InfoNCE / Softmax)，我们需要多个。
        # 这里为了稳定，使用 Pointwise Training, Batch Size = B。
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
    print("📖 Loading vocab...")
    with open(DATA_DIR / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
        
    print("preparing dataset...")
    dataset = PhoenixDataset(DATA_DIR / "train_samples.pkl", news_vocab, {})
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)
    
    print("🔧 Init Phoenix Model...")
    model = PhoenixRanker(
        num_news=len(news_vocab),
        embedding_dim=EMBEDDING_DIM,
        num_heads=NUM_HEADS,
        num_layers=NUM_LAYERS
    ).to(device)
    
    criterion = nn.BCEWithLogitsLoss()
    optimizer = optim.AdamW(model.parameters(), lr=LR)
    
    model.train()
    print("🔥 Start Phoenix Training...")
    
    for epoch in range(EPOCHS):
        total_loss = 0
        pbar = tqdm(loader, desc=f"Epoch {epoch+1}")
        
        for batch in pbar:
            history = batch['history'].to(device) # [B, HistLen]
            candidate = batch['candidate'].to(device) # [B, 1]
            label = batch['label'].to(device) # [B]
            
            # Forward
            # output dict keys: click, like, etc.
            # 我们只用 'click' head 对应 click label
            outputs = model(history, candidate)
            logits = outputs['click'].squeeze(-1) # [B, 1] -> [B, 1] or [B]??
            # model output shape: [B, num_cands]. here num_cands=1. -> [B, 1]
            
            loss = criterion(logits.flatten(), label)
            
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            pbar.set_postfix({"loss": f"{loss.item():.4f}"})
            
        avg_loss = total_loss / len(loader)
        print(f"✅ Epoch {epoch+1} finished. Loss: {avg_loss:.4f}")
        
        # Save
        torch.save(model.state_dict(), MODELS_DIR / f"phoenix_epoch_{epoch+1}.pt")

if __name__ == "__main__":
    train()
