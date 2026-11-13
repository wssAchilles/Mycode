"""Two-Tower 双塔召回模型训练器：支持 InfoNCE + Log-Q 流行度纠偏与完整 MLP 向量导出。"""

from __future__ import annotations

import argparse
from contextlib import nullcontext
import json
import math
import pickle
import random
import shutil
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

from recsys.models.two_tower import TwoTowerModel, compute_infonce_loss

_DEFAULT_ML_DIR = Path(__file__).resolve().parent.parent.parent


@dataclass
class TwoTowerTrainConfig:
    """Two-Tower 训练超参数与产物目录配置。"""

    data_dir: Path = _DEFAULT_ML_DIR / "data"
    models_dir: Path = _DEFAULT_ML_DIR / "models"
    samples_path: Optional[Path] = None
    batch_size: int = 2048
    embedding_dim: int = 256
    epochs: int = 5
    lr: float = 1e-3
    max_history: int = 50
    num_negatives: int = 4
    loss_type: str = "infonce"  # "infonce" | "bpr"
    temperature: float = 0.07
    log_q_correction: bool = True
    item_embedding_dtype: str = "float32"
    num_workers: int = 0
    max_steps_per_epoch: int = 0
    seed: int = 42


def _resolve_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def compute_item_log_probs(samples: Sequence[dict], news_vocab: Dict[str, int]) -> torch.Tensor:
    """统计正样本物品频率的 log(P_q)，用于 InfoNCE 批内负样本 Log-Q 纠偏。"""
    unk_idx = int(news_vocab.get("<UNK>", 1))
    counts: Counter[int] = Counter()
    total = 0
    for sample in samples:
        cid = news_vocab.get(sample["candidate_id"], unk_idx)
        counts[int(cid)] += 1
        total += 1

    vocab_size = len(news_vocab)
    # 平滑频率下界，避免未出现 ID 的 log(0)
    probs = torch.full((vocab_size,), 1.0 / max(1, total + vocab_size), dtype=torch.float32)
    denom = float(max(1, total + vocab_size))
    for item_idx, cnt in counts.items():
        if 0 <= item_idx < vocab_size:
            probs[item_idx] = (float(cnt) + 1.0) / denom
    return torch.log(probs)


class TwoTowerDataset(Dataset):
    """Two-Tower 训练数据集，仅抽取正反馈样本构造用户-物料配对。"""

    def __init__(
        self,
        samples_path: Path,
        news_vocab: Dict[str, int],
        user_vocab: Dict[str, int],
        max_history: int = 50,
    ):
        with open(samples_path, "rb") as f:
            all_samples = pickle.load(f)

        self.samples = [s for s in all_samples if s.get("label", 1) == 1]
        if not self.samples:
            self.samples = list(all_samples)
        self.news_vocab = news_vocab
        self.user_vocab = user_vocab
        self.max_history = max_history
        self.num_news = len(news_vocab)
        self.unk_user_idx = int(user_vocab.get("<UNK>", 1))
        self.unk_news_idx = int(news_vocab.get("<UNK>", 1))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        sample = self.samples[idx]
        user_id = self.user_vocab.get(sample["user_id"], self.unk_user_idx)
        history_ids = [self.news_vocab.get(nid, self.unk_news_idx) for nid in sample.get("history", [])]
        target_id = self.news_vocab.get(sample["candidate_id"], self.unk_news_idx)

        if len(history_ids) > self.max_history:
            history_ids = history_ids[-self.max_history :]
            mask = [1.0] * self.max_history
        else:
            pad_len = self.max_history - len(history_ids)
            mask = [1.0] * len(history_ids) + [0.0] * pad_len
            history_ids = history_ids + [0] * pad_len

        return {
            "user_id": torch.tensor(user_id, dtype=torch.long),
            "history": torch.tensor(history_ids, dtype=torch.long),
            "mask": torch.tensor(mask, dtype=torch.float),
            "target_id": torch.tensor(target_id, dtype=torch.long),
        }


def _in_batch_recall(user_vec: torch.Tensor, item_vec: torch.Tensor, k: int = 1) -> float:
    """计算当前 batch 内的 Recall@K 作为在线对比收敛观测指标。"""
    if user_vec.size(0) == 0:
        return 0.0
    sim = torch.matmul(user_vec, item_vec.t())
    top_k = min(k, sim.size(1))
    _, indices = torch.topk(sim, k=top_k, dim=1)
    targets = torch.arange(sim.size(0), device=sim.device).unsqueeze(1)
    hits = (indices == targets).any(dim=1).float().mean().item()
    return float(hits)


def train_two_tower(config: TwoTowerTrainConfig) -> Dict[str, Any]:
    """执行 Two-Tower 训练并导出权重、完整投影的 item_embeddings.npy 及训练报告。"""
    random.seed(config.seed)
    np.random.seed(config.seed)
    torch.manual_seed(config.seed)

    device = _resolve_device()
    data_dir = config.data_dir
    models_dir = config.models_dir
    models_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    samples_path = config.samples_path or (data_dir / "train_samples.pkl")
    with open(data_dir / "news_vocab.pkl", "rb") as f:
        news_vocab = pickle.load(f)
    with open(data_dir / "user_vocab.pkl", "rb") as f:
        user_vocab = pickle.load(f)

    dataset = TwoTowerDataset(samples_path, news_vocab, user_vocab, max_history=config.max_history)
    if len(dataset) == 0:
        raise RuntimeError(f"训练样本为空: {samples_path}")

    use_pin = device.type == "cuda"
    dataloader = DataLoader(
        dataset,
        batch_size=min(config.batch_size, len(dataset)) if len(dataset) > 0 else config.batch_size,
        shuffle=True,
        num_workers=max(0, config.num_workers),
        pin_memory=use_pin,
        drop_last=False,
    )

    model = TwoTowerModel(
        num_users=len(user_vocab),
        num_news=len(news_vocab),
        embedding_dim=config.embedding_dim,
    ).to(device)

    item_log_probs_table: Optional[torch.Tensor] = None
    if config.loss_type == "infonce" and config.log_q_correction:
        item_log_probs_table = compute_item_log_probs(dataset.samples, news_vocab).to(device)

    optimizer = optim.AdamW(model.parameters(), lr=config.lr, weight_decay=1e-5)
    bce = nn.BCEWithLogitsLoss()
    use_amp = device.type == "cuda"
    amp_dtype = torch.bfloat16 if (use_amp and torch.cuda.is_bf16_supported()) else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=(use_amp and amp_dtype == torch.float16))

    history_metrics: List[Dict[str, float]] = []
    latest_path = models_dir / "two_tower_epoch_latest.pt"

    for epoch in range(config.epochs):
        model.train()
        total_loss = 0.0
        total_r1 = 0.0
        steps = 0
        pbar = tqdm(dataloader, desc=f"TwoTower Epoch {epoch + 1}/{config.epochs}")

        for step, batch in enumerate(pbar):
            if config.max_steps_per_epoch > 0 and step >= config.max_steps_per_epoch:
                break

            user_id = batch["user_id"].to(device)
            history = batch["history"].to(device)
            mask = batch["mask"].to(device)
            target_id = batch["target_id"].to(device)

            optimizer.zero_grad(set_to_none=True)

            autocast_ctx = (
                torch.amp.autocast("cuda", dtype=amp_dtype) if use_amp else nullcontext()
            )
            with autocast_ctx:
                user_vec = model.user_encoder(user_id, history, mask)
                pos_vec = model.news_encoder(target_id)

                if config.loss_type == "infonce" and user_vec.size(0) > 1:
                    batch_log_probs = (
                        item_log_probs_table[target_id] if item_log_probs_table is not None else None
                    )
                    loss = compute_infonce_loss(
                        user_vec,
                        pos_vec,
                        temperature=config.temperature,
                        item_log_probs=batch_log_probs,
                    )
                else:
                    # 当 batch=1 或显式指定 bpr 时使用随机负采样对比损失
                    batch_sz = user_id.size(0)
                    neg_ids = torch.randint(1, max(2, len(news_vocab)), (batch_sz, config.num_negatives), device=device)
                    pos_score = (user_vec * pos_vec).sum(dim=1)
                    neg_vec = model.news_encoder(neg_ids.view(-1)).view(batch_sz, config.num_negatives, -1)
                    neg_score = torch.bmm(neg_vec, user_vec.unsqueeze(2)).squeeze(2)
                    pos_loss = bce(pos_score * 5.0, torch.ones_like(pos_score))
                    neg_loss = bce(neg_score * 5.0, torch.zeros_like(neg_score))
                    loss = pos_loss + neg_loss

            if scaler.is_enabled():
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                optimizer.step()

            steps += 1
            total_loss += float(loss.item())
            with torch.no_grad():
                total_r1 += _in_batch_recall(user_vec, pos_vec, k=1)
            pbar.set_postfix({"loss": f"{loss.item():.4f}", "r@1": f"{total_r1 / steps:.3f}"})

        avg_loss = total_loss / max(1, steps)
        avg_r1 = total_r1 / max(1, steps)
        history_metrics.append({"epoch": float(epoch + 1), "loss": avg_loss, "in_batch_recall_at_1": avg_r1})

        epoch_path = models_dir / f"two_tower_epoch_{epoch + 1}.pt"
        torch.save(model.state_dict(), epoch_path)
        shutil.copyfile(epoch_path, latest_path)

    # 关键修复：使用 NewsEncoder.forward() 导出全量物料向量，确保 MLP + L2 归一化完全对齐
    np_dtype = np.float16 if config.item_embedding_dtype == "float16" else np.float32
    item_embeddings = model.encode_all_items(batch_size=2048, device=device, dtype=np_dtype)
    item_emb_path = data_dir / "item_embeddings.npy"
    np.save(item_emb_path, item_embeddings)

    # 验证导出向量的单位范数误差
    sample_norms = np.linalg.norm(item_embeddings[: min(512, len(item_embeddings))].astype(np.float32), axis=1)
    max_norm_err = float(np.max(np.abs(sample_norms - 1.0))) if len(sample_norms) > 0 else 0.0

    report = {
        "model": "two_tower",
        "device": str(device),
        "lossType": config.loss_type,
        "temperature": config.temperature,
        "logQCorrection": config.log_q_correction,
        "embeddingDim": config.embedding_dim,
        "numUsers": len(user_vocab),
        "numItems": len(news_vocab),
        "numSamples": len(dataset),
        "itemEmbeddingShape": list(item_embeddings.shape),
        "itemEmbeddingDtype": str(item_embeddings.dtype),
        "maxUnitNormError": max_norm_err,
        "epochs": history_metrics,
        "latestModelPath": str(latest_path),
        "itemEmbeddingsPath": str(item_emb_path),
    }
    report_path = models_dir / "two_tower_train_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Two-Tower retrieval model.")
    parser.add_argument("--data-dir", type=Path, default=_DEFAULT_ML_DIR / "data")
    parser.add_argument("--models-dir", type=Path, default=_DEFAULT_ML_DIR / "models")
    parser.add_argument("--samples", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--embedding-dim", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--max-history", type=int, default=50)
    parser.add_argument("--num-negatives", type=int, default=4)
    parser.add_argument("--loss", choices=["infonce", "bpr"], default="infonce")
    parser.add_argument("--temperature", type=float, default=0.07)
    parser.add_argument("--no-log-q", action="store_true", help="Disable Log-Q popularity debiasing")
    parser.add_argument("--item-embedding-dtype", choices=["float16", "float32"], default="float32")
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--max-steps-per-epoch", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = TwoTowerTrainConfig(
        data_dir=args.data_dir,
        models_dir=args.models_dir,
        samples_path=args.samples,
        batch_size=args.batch_size,
        embedding_dim=args.embedding_dim,
        epochs=args.epochs,
        lr=args.lr,
        max_history=args.max_history,
        num_negatives=args.num_negatives,
        loss_type=args.loss,
        temperature=args.temperature,
        log_q_correction=not args.no_log_q,
        item_embedding_dtype=args.item_embedding_dtype,
        num_workers=args.num_workers,
        max_steps_per_epoch=args.max_steps_per_epoch,
        seed=args.seed,
    )
    report = train_two_tower(cfg)
    print(json.dumps(report, ensure_ascii=False, indent=2))
