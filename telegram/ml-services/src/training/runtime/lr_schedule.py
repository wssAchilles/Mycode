"""Warmup-Cosine 学习率调度器与轻量级 CPU 最佳权重回滚跟踪器。"""

from __future__ import annotations

import math
from typing import Dict, List, Optional

import torch
import torch.nn as nn


class WarmupCosineLR:
    """支持 Muon+AdamW 多参数组的线性 Warmup + 余弦退火学习率调度器。"""

    def __init__(
        self,
        optimizer: torch.optim.Optimizer,
        *,
        total_steps: int,
        warmup_ratio: float = 0.08,
        min_lr_ratio: float = 0.02,
    ) -> None:
        self._optimizer = optimizer
        self._total_steps = max(1, int(total_steps))
        self._warmup_steps = int(round(self._total_steps * max(0.0, min(0.5, float(warmup_ratio)))))
        self._min_lr_ratio = max(0.0, min(1.0, float(min_lr_ratio)))
        self._base_lrs: List[float] = [float(pg["lr"]) for pg in optimizer.param_groups]

    def scale_for_step(self, step: int) -> float:
        """计算给定更新步对应的相对学习率倍率。"""
        s = max(0, int(step))
        if self._warmup_steps > 0 and s < self._warmup_steps:
            return float(s + 1) / float(self._warmup_steps)
        denom = max(1, self._total_steps - self._warmup_steps)
        progress = min(1.0, max(0.0, float(s - self._warmup_steps) / float(denom)))
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return self._min_lr_ratio + (1.0 - self._min_lr_ratio) * cosine

    def step(self, step: int) -> float:
        """按相对倍率同步刷新全部优化器参数组学习率，并返回首组当前 lr。"""
        scale = self.scale_for_step(step)
        for pg, base_lr in zip(self._optimizer.param_groups, self._base_lrs):
            pg["lr"] = base_lr * scale
        return float(self._optimizer.param_groups[0]["lr"]) if self._optimizer.param_groups else 0.0

    @classmethod
    def maybe_create(
        cls,
        optimizer: torch.optim.Optimizer,
        *,
        lr_schedule: str,
        n_train: int,
        batch_size: int,
        epochs: int,
        warmup_ratio: float = 0.08,
        min_lr_ratio: float = 0.02,
        start_step: int = 0,
    ) -> Optional["WarmupCosineLR"]:
        """按策略名称可选构造调度器，并在续训时将学习率步进对齐至 `start_step`。"""
        if lr_schedule != "cosine":
            return None
        steps_per_ep = max(1, math.ceil(max(1, int(n_train)) / max(1, int(batch_size))))
        sched = cls(
            optimizer,
            total_steps=steps_per_ep * max(1, int(epochs)),
            warmup_ratio=warmup_ratio,
            min_lr_ratio=min_lr_ratio,
        )
        if start_step > 0:
            sched.step(start_step)
        return sched


class BestStateTracker:
    """在 CPU 内存中保存验证集最佳 Epoch 权重快照，避免末期过拟合污染上线模型。"""

    def __init__(self) -> None:
        self.best_metric: Optional[float] = None
        self.best_epoch: int = 0
        self._best_state_cpu: Optional[Dict[str, torch.Tensor]] = None

    def update(self, model: nn.Module, *, metric: float, epoch: int, is_best: bool) -> None:
        """仅当 `is_best` 成立时在 CPU 克隆模型状态，零额外 GPU 显存开销。"""
        if not is_best and self._best_state_cpu is not None:
            return
        if is_best or self._best_state_cpu is None:
            self.best_metric = float(metric)
            self.best_epoch = int(epoch)
            self._best_state_cpu = {
                k: v.detach().cpu().clone() for k, v in model.state_dict().items()
            }

    def restore(self, model: nn.Module, *, device: Optional[torch.device] = None) -> bool:
        """将保存的最佳权重回滚至目标模型，若未曾保存则返回 False。"""
        if self._best_state_cpu is None:
            return False
        target_dev = device or next(model.parameters()).device
        restored = {k: v.to(target_dev) for k, v in self._best_state_cpu.items()}
        model.load_state_dict(restored, strict=True)
        return True
