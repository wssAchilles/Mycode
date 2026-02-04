#!/usr/bin/env python3
"""
自动重训练脚本
定期从 Redis Stream 拉取用户行为数据，微调 Phoenix 模型

使用方式:
    python scripts/auto_retrain.py --hours 24 --epochs 1

可以配合 cron 使用:
    0 3 * * * cd /path/to/ml-services && python scripts/auto_retrain.py --hours 24
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
import requests

# 添加 scripts 目录到 path
sys.path.append(str(Path(__file__).parent))
from phoenix_model import PhoenixModel

# 配置
REDIS_STREAM_URL = os.getenv("REDIS_URL", "")
API_ENDPOINT = os.getenv("API_ENDPOINT", "http://localhost:5000")
MODELS_DIR = Path(__file__).parent.parent / "models"
DATA_DIR = Path(__file__).parent.parent / "data"


def fetch_training_data(hours: int = 24) -> List[Dict[str, Any]]:
    """
    从后端 API 获取聚合的用户行为数据
    """
    print(f"[Fetch] Fetching training data from last {hours} hours...")
    
    end_time = datetime.now()
    start_time = end_time - timedelta(hours=hours)
    
    try:
        response = requests.get(
            f"{API_ENDPOINT}/api/analytics/events/export",
            params={
                "start": start_time.isoformat(),
                "end": end_time.isoformat(),
                "limit": 50000
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        print(f"[Fetch] Retrieved {data.get('count', 0)} aggregated events")
        return data.get("data", [])
    
    except requests.RequestException as e:
        print(f"[Fetch] Failed to fetch data: {e}")
        return []


def prepare_training_samples(events: List[Dict[str, Any]]) -> tuple:
    """
    将聚合事件转换为训练样本
    
    特征:
    - impressions, clicks, likes, replies, reposts, shares
    - totalDwell, maxScrollDepth
    
    标签:
    - engagement_score = weighted sum of actions
    """
    if not events:
        return None, None
    
    features = []
    labels = []
    
    for event in events:
        # 构建特征向量
        feat = [
            event.get("impressions", 0),
            event.get("clicks", 0),
            event.get("likes", 0),
            event.get("replies", 0),
            event.get("reposts", 0),
            event.get("shares", 0),
            event.get("totalDwell", 0) / 1000,  # 转换为秒
            event.get("maxScrollDepth", 0),
        ]
        features.append(feat)
        
        # 计算参与度分数 (加权)
        engagement = (
            event.get("clicks", 0) * 1.0 +
            event.get("likes", 0) * 2.0 +
            event.get("replies", 0) * 3.0 +
            event.get("reposts", 0) * 4.0 +
            event.get("shares", 0) * 5.0 +
            min(event.get("totalDwell", 0) / 10000, 5)  # 停留时间贡献上限 5
        )
        # 归一化到 0-1
        labels.append(min(engagement / 20.0, 1.0))
    
    X = np.array(features, dtype=np.float32)
    y = np.array(labels, dtype=np.float32)
    
    print(f"[Prepare] Created {len(X)} training samples")
    print(f"[Prepare] Label distribution: min={y.min():.3f}, max={y.max():.3f}, mean={y.mean():.3f}")
    
    return X, y


def load_latest_model() -> PhoenixModel:
    """
    加载最新的 Phoenix 模型
    """
    model_files = list(MODELS_DIR.glob("phoenix_epoch_*.pt"))
    
    if not model_files:
        print("[Load] No existing model found, creating new model")
        return PhoenixModel(input_dim=64, hidden_dim=128, output_dim=1)
    
    # 找最新的 epoch
    latest = max(model_files, key=lambda f: int(f.stem.split("_")[-1]))
    print(f"[Load] Loading model from {latest}")
    
    model = PhoenixModel(input_dim=64, hidden_dim=128, output_dim=1)
    model.load_state_dict(torch.load(latest, map_location="cpu"))
    
    return model


def fine_tune_model(
    model: PhoenixModel,
    X: np.ndarray,
    y: np.ndarray,
    epochs: int = 1,
    lr: float = 1e-5,  # 使用较小的学习率进行微调
    batch_size: int = 64
) -> PhoenixModel:
    """
    微调 Phoenix 模型
    """
    print(f"[Train] Fine-tuning for {epochs} epoch(s) with lr={lr}")
    
    # 适配特征维度
    # Phoenix 模型期望 64 维输入，但我们只有 8 个特征
    # 使用简单的特征扩展
    X_expanded = np.zeros((len(X), 64), dtype=np.float32)
    X_expanded[:, :8] = X
    # 添加一些派生特征
    X_expanded[:, 8] = X[:, 1] / (X[:, 0] + 1)  # CTR
    X_expanded[:, 9] = (X[:, 2] + X[:, 3] + X[:, 4]) / (X[:, 1] + 1)  # 参与率
    
    # 创建数据加载器
    dataset = TensorDataset(
        torch.from_numpy(X_expanded),
        torch.from_numpy(y.reshape(-1, 1))
    )
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    
    # 训练配置
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.MSELoss()
    
    model.train()
    total_loss = 0.0
    
    for epoch in range(epochs):
        epoch_loss = 0.0
        for batch_X, batch_y in loader:
            batch_X = batch_X.to(device)
            batch_y = batch_y.to(device)
            
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            
            epoch_loss += loss.item()
        
        avg_loss = epoch_loss / len(loader)
        total_loss += avg_loss
        print(f"[Train] Epoch {epoch + 1}/{epochs}, Loss: {avg_loss:.6f}")
    
    return model.cpu()


def save_model(model: PhoenixModel, tag: str = None):
    """
    保存微调后的模型
    """
    if tag is None:
        tag = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 找当前最大 epoch
    existing = list(MODELS_DIR.glob("phoenix_epoch_*.pt"))
    if existing:
        max_epoch = max(int(f.stem.split("_")[-1]) for f in existing)
        new_epoch = max_epoch + 1
    else:
        new_epoch = 1
    
    save_path = MODELS_DIR / f"phoenix_epoch_{new_epoch}.pt"
    torch.save(model.state_dict(), save_path)
    print(f"[Save] Model saved to {save_path}")
    
    # 同时保存到带时间戳的备份
    backup_path = MODELS_DIR / f"phoenix_finetune_{tag}.pt"
    torch.save(model.state_dict(), backup_path)
    print(f"[Save] Backup saved to {backup_path}")
    
    return save_path


def notify_model_update(model_path: Path):
    """
    通知服务重新加载模型 (可选)
    """
    try:
        response = requests.post(
            f"{API_ENDPOINT}/api/analytics/model/reload",
            json={"path": str(model_path)},
            timeout=10
        )
        if response.ok:
            print("[Notify] Model reload notification sent")
    except:
        print("[Notify] Could not notify service (optional)")


def main():
    parser = argparse.ArgumentParser(description="Auto-retrain Phoenix model")
    parser.add_argument("--hours", type=int, default=24, help="Hours of data to fetch")
    parser.add_argument("--epochs", type=int, default=1, help="Fine-tuning epochs")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--min-samples", type=int, default=100, help="Minimum samples required")
    parser.add_argument("--dry-run", action="store_true", help="Don't save model")
    args = parser.parse_args()
    
    print("=" * 60)
    print(f"[Start] Auto-retrain at {datetime.now().isoformat()}")
    print("=" * 60)
    
    # 1. 获取数据
    events = fetch_training_data(args.hours)
    
    if len(events) < args.min_samples:
        print(f"[Skip] Not enough data ({len(events)} < {args.min_samples}), skipping retrain")
        return
    
    # 2. 准备训练样本
    X, y = prepare_training_samples(events)
    
    if X is None:
        print("[Skip] No valid training samples")
        return
    
    # 3. 加载模型
    model = load_latest_model()
    
    # 4. 微调
    model = fine_tune_model(model, X, y, epochs=args.epochs, lr=args.lr)
    
    # 5. 保存
    if not args.dry_run:
        model_path = save_model(model)
        notify_model_update(model_path)
    else:
        print("[DryRun] Model not saved")
    
    print("=" * 60)
    print(f"[Done] Auto-retrain completed at {datetime.now().isoformat()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
