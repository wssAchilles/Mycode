import argparse
import pickle
import shutil
from pathlib import Path

import torch.nn as nn
import torch.optim as optim
import torch
from phoenix_model import PhoenixRanker
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

# 配置 (Max Scale for Colab Pro)
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"

# Defaults are aligned with the current Cloud Run serving architecture.
BATCH_SIZE = 1536
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
    def __init__(self, samples_path, news_vocab, max_history: int):
        # 复用 Two-Tower 的 samples 格式，但需要在 getitem 时动态构造多候选(Positive + Negatives)
        with open(samples_path, "rb") as f:
            self.samples = pickle.load(f)
        self.news_vocab = news_vocab
        self.num_news = len(news_vocab)
        self.max_history = max_history
        
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
        label = float(sample.get('label', 0.0))
        labels = sample.get("labels") if isinstance(sample.get("labels"), dict) else {}
        
        # Pointwise Training, Batch Size = B。
        # 此时 Phoenix 输入 Candidates 长度为 1。
        
        history_ids = [self.news_vocab.get(nid, 0) for nid in sample['history']]
        if len(history_ids) > self.max_history:
            history_ids = history_ids[-self.max_history:]
        else:
            history_ids = history_ids + [0] * (self.max_history - len(history_ids))

        def action_value(name: str, fallback: float = 0.0) -> float:
            if name in labels:
                return float(labels.get(name) or 0.0)
            return fallback

        def action_mask(name: str, fallback_available: bool = False) -> float:
            return 1.0 if name in labels or fallback_available else 0.0
            
        return {
            "history": torch.tensor(history_ids, dtype=torch.long),
            "candidate": torch.tensor([target_id], dtype=torch.long), # [1]
            "click": torch.tensor(action_value("click", label), dtype=torch.float),
            "like": torch.tensor(action_value("like"), dtype=torch.float),
            "reply": torch.tensor(action_value("reply"), dtype=torch.float),
            "repost": torch.tensor(action_value("repost"), dtype=torch.float),
            "click_mask": torch.tensor(action_mask("click", True), dtype=torch.float),
            "like_mask": torch.tensor(action_mask("like"), dtype=torch.float),
            "reply_mask": torch.tensor(action_mask("reply"), dtype=torch.float),
            "repost_mask": torch.tensor(action_mask("repost"), dtype=torch.float),
        }

def parse_args():
    parser = argparse.ArgumentParser(description="Train the Phoenix multi-action ranking model.")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument("--samples", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--embedding-dim", type=int, default=EMBEDDING_DIM)
    parser.add_argument("--num-heads", type=int, default=NUM_HEADS)
    parser.add_argument("--num-layers", type=int, default=NUM_LAYERS)
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--lr", type=float, default=LR)
    parser.add_argument("--max-history", type=int, default=MAX_HISTORY)
    parser.add_argument("--num-workers", type=int, default=2)
    parser.add_argument("--no-amp", action="store_true")
    parser.add_argument("--no-pin-memory", action="store_true")
    return parser.parse_args()


def masked_bce(logits, labels, mask, criterion):
    loss = criterion(logits.flatten(), labels)
    masked = loss * mask
    denom = mask.sum().clamp(min=1.0)
    return masked.sum() / denom


def train():
    args = parse_args()
    data_dir = args.data_dir
    models_dir = args.models_dir
    samples_path = args.samples or (data_dir / "train_samples.pkl")

    # 0. 显存大扫除 (防止残留)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    print("📖 Loading vocab...")
    with open(data_dir / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
        
    print("preparing dataset...")
    dataset = PhoenixDataset(samples_path, news_vocab, args.max_history)
    
    # 启用多进程加载 (num_workers) 和 锁页内存 (pin_memory)
    loader = DataLoader(
        dataset, 
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=not args.no_pin_memory and device.type == "cuda",
        persistent_workers=args.num_workers > 0,
        prefetch_factor=2 if args.num_workers > 0 else None,
    )
    
    print("🔧 Init Phoenix Model...")
    model = PhoenixRanker(
        num_news=len(news_vocab),
        embedding_dim=args.embedding_dim,
        num_heads=args.num_heads,
        num_layers=args.num_layers,
    ).to(device)
    
    criterion = nn.BCEWithLogitsLoss(reduction="none")
    optimizer = optim.AdamW(model.parameters(), lr=args.lr)
    
    use_amp = (not args.no_amp) and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    print(f"⚡ Mixed Precision Training (AMP): {'enabled' if use_amp else 'disabled'}")
    
    model.train()
    print(f"🔥 Start Phoenix Training (Batch Size: {args.batch_size})...")
    
    latest_path = None
    for epoch in range(args.epochs):
        total_loss = 0
        pbar = tqdm(loader, desc=f"Epoch {epoch+1}")
        
        for batch in pbar:
            history = batch['history'].to(device) # [B, HistLen]
            candidate = batch['candidate'].to(device) # [B, 1]
            labels = {
                "click": batch["click"].to(device),
                "like": batch["like"].to(device),
                "reply": batch["reply"].to(device),
                "repost": batch["repost"].to(device),
            }
            masks = {
                "click": batch["click_mask"].to(device),
                "like": batch["like_mask"].to(device),
                "reply": batch["reply_mask"].to(device),
                "repost": batch["repost_mask"].to(device),
            }
            
            optimizer.zero_grad()
            
            with torch.amp.autocast(device_type="cuda", enabled=use_amp):
                # Forward
                outputs = model(history, candidate)
                loss = (
                    1.0 * masked_bce(outputs["click"], labels["click"], masks["click"], criterion)
                    + 0.6 * masked_bce(outputs["like"], labels["like"], masks["like"], criterion)
                    + 0.8 * masked_bce(outputs["reply"], labels["reply"], masks["reply"], criterion)
                    + 0.8 * masked_bce(outputs["repost"], labels["repost"], masks["repost"], criterion)
                )
            
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            
            total_loss += loss.item()
            pbar.set_postfix({"loss": f"{loss.item():.4f}"})
            
        avg_loss = total_loss / len(loader)
        print(f"✅ Epoch {epoch+1} finished. Loss: {avg_loss:.4f}")
        
        # Save
        models_dir.mkdir(exist_ok=True)
        latest_path = models_dir / f"phoenix_epoch_{epoch+1}.pt"
        torch.save(model.state_dict(), latest_path)

    if latest_path is not None:
        shutil.copyfile(latest_path, models_dir / "phoenix_epoch_latest.pt")
        print(f"   Latest checkpoint: {models_dir / 'phoenix_epoch_latest.pt'}")

if __name__ == "__main__":
    train()
