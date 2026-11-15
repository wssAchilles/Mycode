"""训练期原子化断点管理（本地 + Drive/GCS 同步）与 OOM 自动缩容梯度累积控制器。

安全隔离约束：`.pt` 检查点仅用于训练/断点续跑目录（严禁拷入 Cloud Run 在线推理 `models/` 目录）。
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any, Callable, Dict, List, Optional, Tuple

import torch
import torch.nn as nn


def is_cuda_oom_error(exc: BaseException) -> bool:
    """准确识别 CUDA/MPS/内存 OOM 异常，避免吞掉常规逻辑 Bug。"""
    msg = str(exc).lower()
    return "out of memory" in msg or isinstance(exc, getattr(torch.cuda, "OutOfMemoryError", MemoryError))


class OomSafeBatchController:
    """自适应 Micro-Batch 缩容与梯度累积维持器：遇到 OOM 时批大小减半、累积步数翻倍。"""

    def __init__(
        self,
        initial_batch_size: int = 128,
        *,
        min_batch_size: int = 4,
        initial_grad_accum: int = 1,
        max_grad_accum: int = 64,
    ) -> None:
        self.micro_batch_size = max(int(min_batch_size), int(initial_batch_size))
        self.min_batch_size = max(1, int(min_batch_size))
        self.grad_accum_steps = max(1, int(initial_grad_accum))
        self.max_grad_accum = max(1, int(max_grad_accum))
        self.oom_events: int = 0

    @property
    def effective_batch_size(self) -> int:
        return self.micro_batch_size * self.grad_accum_steps

    def handle_oom(self) -> bool:
        """响应一次 OOM：释放缓存并减半 micro_batch_size；若已无法再缩返回 False。"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if self.micro_batch_size <= self.min_batch_size:
            return False
        next_bs = max(self.min_batch_size, self.micro_batch_size // 2)
        scale_factor = max(1, self.micro_batch_size // max(1, next_bs))
        self.micro_batch_size = next_bs
        self.grad_accum_steps = min(self.max_grad_accum, self.grad_accum_steps * scale_factor)
        self.oom_events += 1
        return True

    def run_step_with_backoff(self, step_fn: Callable[[int, int], Any]) -> Any:
        """执行接收 `(micro_batch_size, grad_accum_steps)` 的训练函数，OOM 时自动降档重试。"""
        while True:
            try:
                return step_fn(self.micro_batch_size, self.grad_accum_steps)
            except RuntimeError as exc:
                if not is_cuda_oom_error(exc):
                    raise
                if not self.handle_oom():
                    raise RuntimeError(
                        f"CUDA/RAM OOM cannot back off further (min_batch_size={self.min_batch_size})"
                    ) from exc


@dataclass(frozen=True)
class CheckpointSaveResult:
    """单次原子化断点保存的返回摘要。"""

    local_path: Path
    best_path: Optional[Path]
    drive_synced_path: Optional[Path]
    gcs_synced_uri: Optional[str]


class CheckpointManager:
    """多级训练检查点管理器：支持原子落盘、滚动淘汰与 Colab Drive / GCS 异步回写。"""

    def __init__(
        self,
        local_dir: Path,
        *,
        drive_dir: Optional[Path] = None,
        gcs_uri: Optional[str] = None,
        max_keep: int = 3,
        prefix: str = "ckpt",
    ) -> None:
        self.local_dir = Path(local_dir)
        self.local_dir.mkdir(parents=True, exist_ok=True)
        self.drive_dir = Path(drive_dir) if drive_dir is not None else None
        self.gcs_uri = str(gcs_uri).rstrip("/") if gcs_uri else None
        self.max_keep = max(1, int(max_keep))
        self.prefix = str(prefix)
        self.meta_path = self.local_dir / f"{self.prefix}_state.json"

    def _atomic_torch_save(self, payload: Dict[str, Any], target: Path) -> None:
        tmp_path = target.with_suffix(".pt.tmp")
        torch.save(payload, str(tmp_path))
        os.replace(str(tmp_path), str(target))

    def _prune_old(self) -> None:
        rolling = sorted(
            [p for p in self.local_dir.glob(f"{self.prefix}_step_*.pt") if p.is_file()],
            key=lambda p: p.stat().st_mtime,
        )
        while len(rolling) > self.max_keep:
            victim = rolling.pop(0)
            victim.unlink(missing_ok=True)

    def _sync_to_drive(self, src: Path, name: Optional[str] = None) -> Optional[Path]:
        if self.drive_dir is None:
            return None
        try:
            self.drive_dir.mkdir(parents=True, exist_ok=True)
            dst = self.drive_dir / (name or src.name)
            tmp_dst = dst.with_suffix(".pt.tmp")
            shutil.copy2(src, tmp_dst)
            os.replace(str(tmp_dst), str(dst))
            return dst
        except Exception:
            return None

    def _sync_to_gcs(self, src: Path, remote_name: Optional[str] = None) -> Optional[str]:
        if not self.gcs_uri:
            return None
        target_uri = f"{self.gcs_uri}/{remote_name or src.name}"
        try:
            res = subprocess.run(
                ["gcloud", "storage", "cp", str(src), target_uri],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if res.returncode == 0:
                return target_uri
        except Exception:
            return None
        return None

    def save(
        self,
        *,
        step: int,
        epoch: int,
        model: nn.Module,
        optimizer: Optional[torch.optim.Optimizer] = None,
        ema: Optional[Any] = None,
        metric_value: Optional[float] = None,
        is_best: bool = False,
        extra: Optional[Dict[str, Any]] = None,
    ) -> CheckpointSaveResult:
        """原子写入最新滚动检查点；当 is_best=True 时额外保存 best.pt 并同步 Drive/GCS。"""
        payload: Dict[str, Any] = {
            "step": int(step),
            "epoch": int(epoch),
            "metric_value": float(metric_value) if metric_value is not None else None,
            "model_state": model.state_dict(),
            "extra": dict(extra or {}),
        }
        if optimizer is not None:
            payload["optimizer_state"] = optimizer.state_dict()
        if ema is not None and hasattr(ema, "state_dict"):
            payload["ema_state"] = ema.state_dict()

        step_path = self.local_dir / f"{self.prefix}_step_{step:08d}.pt"
        self._atomic_torch_save(payload, step_path)

        latest_path = self.local_dir / f"{self.prefix}_latest.pt"
        shutil.copy2(step_path, latest_path)
        self._prune_old()

        best_path: Optional[Path] = None
        if is_best:
            best_path = self.local_dir / f"{self.prefix}_best.pt"
            shutil.copy2(step_path, best_path)

        drive_synced = self._sync_to_drive(latest_path)
        if is_best and best_path is not None:
            self._sync_to_drive(best_path)

        gcs_synced = self._sync_to_gcs(latest_path)
        if is_best and best_path is not None:
            self._sync_to_gcs(best_path)

        meta = {
            "step": int(step),
            "epoch": int(epoch),
            "metric_value": float(metric_value) if metric_value is not None else None,
            "latest_path": str(latest_path),
            "best_path": str(best_path) if best_path else None,
        }
        self.meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        return CheckpointSaveResult(
            local_path=latest_path,
            best_path=best_path,
            drive_synced_path=drive_synced,
            gcs_synced_uri=gcs_synced,
        )

    def _find_latest_checkpoint_file(self, prefer_best: bool = False) -> Optional[Path]:
        candidates: List[Path] = []
        target_names = (
            [f"{self.prefix}_best.pt", f"{self.prefix}_latest.pt"]
            if prefer_best
            else [f"{self.prefix}_latest.pt", f"{self.prefix}_best.pt"]
        )
        for root in [self.local_dir, self.drive_dir]:
            if root is None or not root.exists():
                continue
            for name in target_names:
                p = root / name
                if p.exists() and p.is_file():
                    candidates.append(p)
            if candidates:
                return candidates[0]
            rolling = sorted(
                [p for p in root.glob(f"{self.prefix}_step_*.pt") if p.is_file()],
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if rolling:
                return rolling[0]
        return None

    def resume_latest(
        self,
        model: nn.Module,
        *,
        optimizer: Optional[torch.optim.Optimizer] = None,
        ema: Optional[Any] = None,
        prefer_best: bool = False,
        map_location: str | torch.device = "cpu",
    ) -> Optional[Dict[str, Any]]:
        """自动从 Local / Drive 检查点恢复模型权重与优化器进度；无断点时返回 None。"""
        ckpt_path = self._find_latest_checkpoint_file(prefer_best=prefer_best)
        if ckpt_path is None:
            return None

        payload = torch.load(str(ckpt_path), map_location=map_location, weights_only=False)
        model.load_state_dict(payload["model_state"])
        if optimizer is not None and "optimizer_state" in payload:
            optimizer.load_state_dict(payload["optimizer_state"])
        if ema is not None and "ema_state" in payload and hasattr(ema, "load_state_dict"):
            ema.load_state_dict(payload["ema_state"])
        return {
            "resumed_from": str(ckpt_path),
            "step": int(payload.get("step", 0)),
            "epoch": int(payload.get("epoch", 0)),
            "metric_value": payload.get("metric_value"),
            "extra": payload.get("extra", {}),
        }
