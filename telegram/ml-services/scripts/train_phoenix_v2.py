"""
Phoenix V2 训练脚本 — 适配云 GPU 小规模训练

推荐硬件:
  - Mini (128-dim): Google Colab T4 (免费) 或 Colab Pro T4 (~5分钟/epoch)
  - Medium (256-dim): Colab Pro A100 或 Lambda A10G (~20分钟/epoch)

完整训练流程:
  1. python export_training_data.py --mongo-uri $MONGO_URI --days 30
  2. python train_phoenix_v2.py --data-dir data/ --epochs 20
  3. 输出: models/phoenix_v2_latest.pt

在 Colab 中使用:
  !pip install torch tqdm
  !python train_phoenix_v2.py --data-dir /content/data/ --epochs 10 --batch-size 512
"""

import argparse
import pickle
import shutil
import time
from pathlib import Path
from typing import Dict, List, Tuple

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

from phoenix_v2_model import (
    LABEL_ACTIONS,
    ACTION_TYPE_MAP,
    NUM_PREDICTED_ACTIONS,
    PhoenixV2Ranker,
    create_mini_phoenix,
    create_medium_phoenix,
)

# ============================================================
# 配置
# ============================================================
DEFAULTS = {
    "batch_size": 256,
    "epochs": 20,
    "lr": 3e-4,
    "weight_decay": 1e-4,
    "warmup_steps": 500,
    "max_grad_norm": 1.0,
    "label_smoothing": 0.02,
    "dwell_threshold_ms": 3000,  # 停留 > 3秒 视为正样本
}

# 损失权重 (正面行为权重高, 负面行为权重也高因为稀缺)
ACTION_LOSS_WEIGHTS = {
    "click": 1.0,
    "like": 0.8,
    "reply": 0.9,
    "repost": 0.8,
    "quote": 0.7,
    "share": 0.6,
    "dwell": 0.5,
    "video_view": 0.5,
    "dismiss": 1.2,   # 负面行为 — 权重高因为样本少
    "report": 1.5,    # 负面行为 — 权重最高
}

DATA_DIR = Path(__file__).parent.parent / "data"
MODELS_DIR = Path(__file__).parent.parent / "models"


# ============================================================
# Dataset
# ============================================================
class PhoenixV2Dataset(Dataset):
    def __init__(
        self,
        samples_path: Path,
        user_vocab: Dict[str, int],
        post_vocab: Dict[str, int],
        author_vocab: Dict[str, int],
        max_history_len: int = 64,
        dwell_threshold_ms: float = 3000,
    ):
        with open(samples_path, "rb") as f:
            self.samples = pickle.load(f)
        self.user_vocab = user_vocab
        self.post_vocab = post_vocab
        self.author_vocab = author_vocab
        self.max_history_len = max_history_len
        self.dwell_threshold_ms = dwell_threshold_ms

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        sample = self.samples[idx]

        # User ID
        user_id = self.user_vocab.get(sample["user_id"], 0)

        # History
        history = sample["history"]
        if len(history) > self.max_history_len:
            history = history[-self.max_history_len:]

        hist_post_ids = []
        hist_author_ids = []
        hist_action_types = []
        for pid, aid, atype in history:
            hist_post_ids.append(self.post_vocab.get(pid, 0))
            hist_author_ids.append(self.author_vocab.get(aid, 0))
            hist_action_types.append(atype if isinstance(atype, int) else ACTION_TYPE_MAP.get(atype, 7))

        hist_len = len(hist_post_ids)
        # Pad
        pad_len = self.max_history_len - hist_len
        hist_post_ids = [0] * pad_len + hist_post_ids
        hist_author_ids = [0] * pad_len + hist_author_ids
        hist_action_types = [7] * pad_len + hist_action_types  # 7 = impression (padding)
        hist_mask = [0.0] * pad_len + [1.0] * hist_len

        # Candidate
        cand_post_id = self.post_vocab.get(sample["candidate_post_id"], 0)
        cand_author_id = self.author_vocab.get(sample["candidate_author_id"], 0)

        # Labels
        labels = sample.get("labels", {})
        label_tensor = []
        for action in LABEL_ACTIONS:
            if action == "dwell":
                # dwell: 停留时间 > 阈值 视为正
                value = 1.0 if sample.get("dwell_ms", 0) >= self.dwell_threshold_ms else 0.0
            else:
                value = float(labels.get(action, 0.0))
            label_tensor.append(value)

        return {
            "user_id": torch.tensor(user_id, dtype=torch.long),
            "hist_post_ids": torch.tensor(hist_post_ids, dtype=torch.long),
            "hist_author_ids": torch.tensor(hist_author_ids, dtype=torch.long),
            "hist_action_types": torch.tensor(hist_action_types, dtype=torch.long),
            "hist_mask": torch.tensor(hist_mask, dtype=torch.float),
            "cand_post_id": torch.tensor(cand_post_id, dtype=torch.long),
            "cand_author_id": torch.tensor(cand_author_id, dtype=torch.long),
            "cand_mask": torch.tensor(1.0, dtype=torch.float),
            "labels": torch.tensor(label_tensor, dtype=torch.float),
        }


# ============================================================
# 训练
# ============================================================
def get_cosine_schedule_with_warmup(optimizer, warmup_steps: int, total_steps: int):
    """Linear warmup + cosine decay"""
    def lr_lambda(step: int) -> float:
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1.0 + __import__("math").cos(progress * 3.14159))
    return torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)


def train():
    parser = argparse.ArgumentParser(description="Train Phoenix V2 Ranker")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument("--samples", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=DEFAULTS["batch_size"])
    parser.add_argument("--epochs", type=int, default=DEFAULTS["epochs"])
    parser.add_argument("--lr", type=float, default=DEFAULTS["lr"])
    parser.add_argument("--max-history", type=int, default=64)
    parser.add_argument("--warmup-steps", type=int, default=DEFAULTS["warmup_steps"])
    parser.add_argument("--label-smoothing", type=float, default=DEFAULTS["label_smoothing"])
    parser.add_argument("--no-amp", action="store_true")
    parser.add_argument("--model-size", choices=["mini", "medium"], default="mini")
    parser.add_argument("--resume", type=Path, default=None, help="从 checkpoint 恢复训练")
    args = parser.parse_args()

    data_dir = args.data_dir
    models_dir = args.models_dir

    # ---- 设备 ----
    if torch.cuda.is_available():
        device = torch.device("cuda")
        print(f"🚀 GPU: {torch.cuda.get_device_name(0)}")
        print(f"   显存: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
        print("🚀 Using Apple Silicon MPS")
    else:
        device = torch.device("cpu")
        print("⚠️ Using CPU (训练会很慢)")

    # ---- 加载词表 ----
    print("📖 加载词表...")
    vocabs = {}
    for name in ["user_vocab", "post_vocab", "author_vocab"]:
        path = data_dir / f"phoenix_v2_{name}.pkl"
        if not path.exists():
            print(f"❌ 找不到 {path}, 请先运行 export_training_data.py")
            return
        with open(path, "rb") as f:
            vocabs[name] = pickle.load(f)

    print(f"   users: {len(vocabs['user_vocab'])}, posts: {len(vocabs['post_vocab'])}, "
          f"authors: {len(vocabs['author_vocab'])}")

    # ---- Dataset ----
    samples_path = args.samples or data_dir / "phoenix_v2_samples.pkl"
    dataset = PhoenixV2Dataset(
        samples_path,
        vocabs["user_vocab"], vocabs["post_vocab"], vocabs["author_vocab"],
        max_history_len=args.max_history,
    )
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=2,
        pin_memory=device.type == "cuda",
        persistent_workers=True,
        prefetch_factor=2,
    )
    print(f"📊 样本数: {len(dataset)}, batch数: {len(loader)}")

    # ---- 模型 ----
    if args.model_size == "medium":
        model = create_medium_phoenix(max_history_len=args.max_history)
    else:
        model = create_mini_phoenix(max_history_len=args.max_history)

    # 更新 embedding table 大小以匹配词表
    # Hash Embedding 不需要精确匹配 (hash 自动映射), 所以跳过

    model = model.to(device)
    param_count = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"🔧 模型参数量: {param_count:,} ({param_count/1e6:.1f}M)")

    # ---- 恢复训练 ----
    start_epoch = 0
    if args.resume and args.resume.exists():
        state = torch.load(args.resume, map_location=device)
        model.load_state_dict(state["model"])
        start_epoch = state.get("epoch", 0)
        print(f"♻️ 从 epoch {start_epoch} 恢复训练")

    # ---- 优化器 + 调度器 ----
    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=DEFAULTS["weight_decay"])
    total_steps = len(loader) * args.epochs
    scheduler = get_cosine_schedule_with_warmup(optimizer, args.warmup_steps, total_steps)

    # ---- AMP ----
    use_amp = (not args.no_amp) and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    print(f"⚡ AMP: {'enabled' if use_amp else 'disabled'}")

    # ---- 损失函数 ----
    criterion = nn.BCEWithLogitsLoss(reduction="none")
    loss_weights = torch.tensor(
        [ACTION_LOSS_WEIGHTS.get(a, 1.0) for a in LABEL_ACTIONS],
        device=device,
    )
    label_smoothing = args.label_smoothing

    # ---- 训练循环 ----
    model.train()
    print(f"\n🔥 开始训练 ({args.model_size}, {args.epochs} epochs)...\n")

    for epoch in range(start_epoch, args.epochs):
        epoch_loss = 0.0
        epoch_action_losses = {a: 0.0 for a in LABEL_ACTIONS}
        epoch_action_counts = {a: 0 for a in LABEL_ACTIONS}
        t0 = time.time()

        pbar = tqdm(loader, desc=f"Epoch {epoch+1}/{args.epochs}")
        for step, batch in enumerate(pbar):
            # Move to device
            user_ids = batch["user_id"].to(device)
            hist_post_ids = batch["hist_post_ids"].to(device)
            hist_author_ids = batch["hist_author_ids"].to(device)
            hist_action_types = batch["hist_action_types"].to(device)
            hist_mask = batch["hist_mask"].to(device)
            cand_post_id = batch["cand_post_id"].to(device).unsqueeze(1)  # [B, 1]
            cand_author_id = batch["cand_author_id"].to(device).unsqueeze(1)  # [B, 1]
            cand_mask = batch["cand_mask"].to(device).unsqueeze(1)  # [B, 1]
            labels = batch["labels"].to(device)  # [B, 10]

            optimizer.zero_grad()

            with torch.amp.autocast(device_type="cuda", enabled=use_amp):
                # Forward
                outputs = model(
                    user_ids, hist_post_ids, hist_author_ids, hist_action_types, hist_mask,
                    cand_post_id, cand_author_id, cand_mask,
                )  # Dict[action_name, [B, 1]]

                # 计算多任务损失
                total_loss = torch.tensor(0.0, device=device)
                for i, action_name in enumerate(LABEL_ACTIONS):
                    logits = outputs[action_name].squeeze(1)  # [B]
                    target = labels[:, i]  # [B]

                    # Label smoothing
                    if label_smoothing > 0:
                        target = target * (1 - label_smoothing) + 0.5 * label_smoothing

                    # Masked loss (只对有标签的样本计算)
                    per_sample_loss = criterion(logits, target)
                    weighted_loss = per_sample_loss * loss_weights[i]

                    # Count positive samples for this action
                    pos_count = target.gt(0.5).sum().item()
                    epoch_action_counts[action_name] += pos_count

                    total_loss = total_loss + weighted_loss.mean()
                    epoch_action_losses[action_name] += weighted_loss.mean().item()

            scaler.scale(total_loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), DEFAULTS["max_grad_norm"])
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()

            epoch_loss += total_loss.item()
            pbar.set_postfix({"loss": f"{total_loss.item():.4f}", "lr": f"{scheduler.get_last_lr()[0]:.6f}"})

        # Epoch 结束
        elapsed = time.time() - t0
        avg_loss = epoch_loss / len(loader)
        print(f"\n✅ Epoch {epoch+1} 完成 ({elapsed:.0f}s)")
        print(f"   Avg Loss: {avg_loss:.4f}")
        for action_name in LABEL_ACTIONS:
            avg = epoch_action_losses[action_name] / len(loader)
            count = epoch_action_counts[action_name]
            print(f"   {action_name:15s}: loss={avg:.4f}, positives={count}")

        # 保存 checkpoint
        models_dir.mkdir(parents=True, exist_ok=True)
        checkpoint = {
            "epoch": epoch + 1,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "avg_loss": avg_loss,
            "config": {
                "model_size": args.model_size,
                "max_history": args.max_history,
                "dim": model.dim,
                "num_heads": model.transformer.layers[0].self_attn.num_heads,
                "num_layers": len(model.transformer.layers),
            },
        }
        ckpt_path = models_dir / f"phoenix_v2_epoch_{epoch+1}.pt"
        torch.save(checkpoint, ckpt_path)

    # 复制最新 checkpoint
    latest_path = models_dir / "phoenix_v2_latest.pt"
    shutil.copyfile(ckpt_path, latest_path)
    print(f"\n🎉 训练完成! 最新模型: {latest_path}")

    # ---- 导出推理用的纯模型权重 ----
    inference_path = models_dir / "phoenix_v2_inference.pt"
    torch.save(model.state_dict(), inference_path)
    print(f"💾 推理权重: {inference_path}")

    # ---- 打印模型摘要 ----
    size_mb = inference_path.stat().st_size / (1024 * 1024)
    print(f"\n📊 模型大小: {size_mb:.1f} MB")
    print(f"📊 参数量: {param_count:,}")
    print(f"📊 预测头: {NUM_PREDICTED_ACTIONS} 种动作")
    print(f"📊 历史长度: {args.max_history}")


if __name__ == "__main__":
    train()
