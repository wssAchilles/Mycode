"""Muon + AdamW 混合分区优化器（5步 Newton-Schulz + QKV分块正交 + RMS自适应）、ModelEMA 与 V3 早停评测器。

对标 x-algorithm `optimizers/optim.py` 的参数分区与 Moonlight/Muon 收敛工程规范：
- 2D+ 隐藏线性矩阵采用 Muon (Nesterov Momentum + 5 步 Newton-Schulz 正交化 + `0.2*sqrt(max(m,n))`)；
- 1D bias / RMSNorm / Embedding 查找表参数保持 AdamW 更新；
- 早停主指标严格锁定为 `0.7 * unbiased_macro_roc_auc + 0.3 * negative_auc`。
"""

from __future__ import annotations

from contextlib import contextmanager
import math
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple

import numpy as np
from sklearn.metrics import roc_auc_score
import torch
import torch.nn as nn

from src.contracts.actions import NEGATIVE_ACTIONS, POSITIVE_ACTIONS, V3_PREDICTION_HEADS


def zeropower_via_newtonschulz5(
    grad: torch.Tensor,
    *,
    steps: int = 5,
    eps: float = 1e-7,
) -> torch.Tensor:
    """5 步 Newton-Schulz 迭代近似计算矩阵极因子最邻近正交阵 (G / ||G|| -> U V^T)。"""
    if grad.ndim < 2:
        raise ValueError(f"Newton-Schulz requires ndim >= 2, got {grad.shape}")

    a, b, c = 3.4445, -4.7750, 2.0315
    mat = grad if grad.ndim == 2 else grad.view(grad.shape[0], -1)
    transposed = False
    if mat.shape[0] > mat.shape[1]:
        mat = mat.t()
        transposed = True

    work_dtype = torch.bfloat16 if mat.device.type == "cuda" else torch.float32
    x = mat.to(dtype=work_dtype)
    norm = torch.norm(x)
    x = x / (norm + eps)

    for _ in range(max(1, int(steps))):
        gram = x @ x.t()
        poly = b * gram + c * (gram @ gram)
        x = a * x + poly @ x

    if transposed:
        x = x.t()
    out = x.to(dtype=grad.dtype)
    return out.view_as(grad) if grad.ndim > 2 else out


def orthogonalize_muon_update(
    grad: torch.Tensor,
    *,
    is_fused_qkv: bool = False,
    ns_steps: int = 5,
    rms_scale: float = 0.2,
) -> torch.Tensor:
    """按参数结构执行普通或 QKV 三分块独立正交化，并乘以 Moonlight consistent RMS 系数。"""
    if grad.ndim != 2:
        ortho = zeropower_via_newtonschulz5(grad, steps=ns_steps)
        m, n = grad.shape[0], int(grad[0].numel())
        scale = rms_scale * math.sqrt(float(max(m, n)))
        return ortho * scale

    rows, cols = grad.shape
    if is_fused_qkv and rows % 3 == 0:
        chunk_rows = rows // 3
        chunks = torch.split(grad, chunk_rows, dim=0)
        ortho_chunks = []
        scale = rms_scale * math.sqrt(float(max(chunk_rows, cols)))
        for ch in chunks:
            ortho_chunks.append(zeropower_via_newtonschulz5(ch, steps=ns_steps) * scale)
        return torch.cat(ortho_chunks, dim=0)

    ortho = zeropower_via_newtonschulz5(grad, steps=ns_steps)
    scale = rms_scale * math.sqrt(float(max(rows, cols)))
    return ortho * scale


class MuonAdamW(torch.optim.Optimizer):
    """混合分区优化器：隐藏线性权重走 Muon 正交动量，Embedding/1D 规范化走 AdamW。"""

    def __init__(
        self,
        params: Iterable[Any],
        *,
        lr: float = 3e-4,
        muon_lr_multiplier: float = 10.0,
        momentum: float = 0.95,
        nesterov: bool = True,
        ns_steps: int = 5,
        betas: Tuple[float, float] = (0.9, 0.95),
        eps: float = 1e-8,
        weight_decay: float = 0.01,
    ) -> None:
        defaults = dict(
            lr=lr,
            muon_lr_multiplier=muon_lr_multiplier,
            momentum=momentum,
            nesterov=nesterov,
            ns_steps=ns_steps,
            betas=betas,
            eps=eps,
            weight_decay=weight_decay,
            use_muon=False,
            is_qkv=False,
        )
        super().__init__(params, defaults)

    @classmethod
    def from_model(
        cls,
        model: nn.Module,
        *,
        lr: float = 3e-4,
        muon_lr_multiplier: float = 10.0,
        weight_decay: float = 0.01,
        backbone_lr_scale: float = 1.0,
    ) -> "MuonAdamW":
        """自动扫描模型命名与层级，把 2D 非 Embedding/Norm 矩阵路由进 Muon 参数组。"""
        emb_weight_ids = {id(m.weight) for m in model.modules() if isinstance(m, nn.Embedding)}
        muon_qkv_params: List[nn.Parameter] = []
        muon_other_params: List[nn.Parameter] = []
        adamw_decay_params: List[nn.Parameter] = []
        adamw_nodecay_params: List[nn.Parameter] = []

        for name, param in model.named_parameters():
            if not param.requires_grad:
                continue
            lname = name.lower()
            is_emb = id(param) in emb_weight_ids or "emb" in lname or "frozen" in lname
            if param.ndim >= 2 and not is_emb and "norm" not in lname:
                if "qkv" in lname:
                    muon_qkv_params.append(param)
                else:
                    muon_other_params.append(param)
            elif param.ndim >= 2 and "norm" not in lname:
                adamw_decay_params.append(param)
            else:
                adamw_nodecay_params.append(param)

        groups: List[Dict[str, Any]] = []
        if muon_other_params:
            groups.append(
                {
                    "params": muon_other_params,
                    "use_muon": True,
                    "is_qkv": False,
                    "lr": lr * backbone_lr_scale,
                    "muon_lr_multiplier": muon_lr_multiplier,
                    "weight_decay": weight_decay,
                }
            )
        if muon_qkv_params:
            groups.append(
                {
                    "params": muon_qkv_params,
                    "use_muon": True,
                    "is_qkv": True,
                    "lr": lr * backbone_lr_scale,
                    "muon_lr_multiplier": muon_lr_multiplier,
                    "weight_decay": weight_decay,
                }
            )
        if adamw_decay_params:
            groups.append({"params": adamw_decay_params, "use_muon": False, "lr": lr, "weight_decay": weight_decay})
        if adamw_nodecay_params:
            groups.append({"params": adamw_nodecay_params, "use_muon": False, "lr": lr, "weight_decay": 0.0})

        return cls(groups, lr=lr, muon_lr_multiplier=muon_lr_multiplier, weight_decay=weight_decay)

    @torch.no_grad()
    def step(self, closure: Optional[Any] = None) -> Optional[torch.Tensor]:
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()

        for group in self.param_groups:
            use_muon = bool(group.get("use_muon", False))
            lr = float(group["lr"])
            wd = float(group["weight_decay"])

            if use_muon:
                momentum = float(group.get("momentum", 0.95))
                nesterov = bool(group.get("nesterov", True))
                ns_steps = int(group.get("ns_steps", 5))
                is_qkv = bool(group.get("is_qkv", False))
                eff_lr = lr * float(group.get("muon_lr_multiplier", 10.0))

                for p in group["params"]:
                    if p.grad is None:
                        continue
                    g = p.grad
                    state = self.state[p]
                    if "momentum_buffer" not in state:
                        state["momentum_buffer"] = torch.zeros_like(g)
                    buf = state["momentum_buffer"]
                    buf.mul_(momentum).add_(g)
                    update_in = g.add(buf, alpha=momentum) if nesterov else buf
                    update_ortho = orthogonalize_muon_update(update_in, is_fused_qkv=is_qkv, ns_steps=ns_steps)
                    if wd > 0.0:
                        p.mul_(1.0 - eff_lr * wd)
                    p.add_(update_ortho, alpha=-eff_lr)
            else:
                beta1, beta2 = group.get("betas", (0.9, 0.95))
                eps = float(group.get("eps", 1e-8))
                for p in group["params"]:
                    if p.grad is None:
                        continue
                    g = p.grad
                    state = self.state[p]
                    if len(state) == 0:
                        state["step"] = 0
                        state["exp_avg"] = torch.zeros_like(p)
                        state["exp_avg_sq"] = torch.zeros_like(p)
                    state["step"] += 1
                    step_t = state["step"]
                    m, v = state["exp_avg"], state["exp_avg_sq"]
                    m.mul_(beta1).add_(g, alpha=1.0 - beta1)
                    v.mul_(beta2).addcmul_(g, g, value=1.0 - beta2)
                    bias_c1 = 1.0 - (beta1 ** step_t)
                    bias_c2 = 1.0 - (beta2 ** step_t)
                    denom = (v.sqrt() / math.sqrt(bias_c2)).add_(eps)
                    if wd > 0.0:
                        p.mul_(1.0 - lr * wd)
                    p.addcdiv_(m / bias_c1, denom, value=-lr)

        return loss


def clip_grad_norm_partitioned(
    optimizer: torch.optim.Optimizer,
    max_norm: float = 1.0,
) -> Dict[str, float]:
    """分别裁剪 Muon 与 AdamW 分区的全局梯度范数（参照 x-algorithm `clip_by_global_norm_partitioned`）。"""
    muon_params: List[torch.Tensor] = []
    adam_params: List[torch.Tensor] = []
    for group in optimizer.param_groups:
        target = muon_params if group.get("use_muon", False) else adam_params
        for p in group["params"]:
            if p.grad is not None:
                target.append(p)

    stats: Dict[str, float] = {}
    if muon_params:
        stats["muon_grad_norm"] = float(torch.nn.utils.clip_grad_norm_(muon_params, max_norm=max_norm).item())
    if adam_params:
        stats["adamw_grad_norm"] = float(torch.nn.utils.clip_grad_norm_(adam_params, max_norm=max_norm).item())
    return stats


class ModelEMA:
    """滑动指数平均 (EMA) 权重快照：推理/蒸馏导出优先使用 EMA 稳定泛化参数。"""

    def __init__(self, model: nn.Module, decay: float = 0.995) -> None:
        self.decay = float(decay)
        self.shadow: Dict[str, torch.Tensor] = {
            name: param.detach().clone()
            for name, param in model.named_parameters()
            if param.requires_grad
        }
        self._backup: Dict[str, torch.Tensor] = {}

    @torch.no_grad()
    def update(self, model: nn.Module) -> None:
        for name, param in model.named_parameters():
            if not param.requires_grad or name not in self.shadow:
                continue
            self.shadow[name].mul_(self.decay).add_(param.detach(), alpha=1.0 - self.decay)

    @torch.no_grad()
    def apply_shadow(self, model: nn.Module) -> None:
        self._backup = {}
        for name, param in model.named_parameters():
            if name in self.shadow:
                self._backup[name] = param.detach().clone()
                param.copy_(self.shadow[name])

    @torch.no_grad()
    def restore(self, model: nn.Module) -> None:
        for name, param in model.named_parameters():
            if name in self._backup:
                param.copy_(self._backup[name])
        self._backup = {}

    @contextmanager
    def use_ema(self, model: nn.Module) -> Iterator[None]:
        self.apply_shadow(model)
        try:
            yield
        finally:
            self.restore(model)

    def state_dict(self) -> Dict[str, Any]:
        return {"decay": self.decay, "shadow": {k: v.cpu() for k, v in self.shadow.items()}}

    def load_state_dict(self, state: Mapping[str, Any]) -> None:
        self.decay = float(state.get("decay", self.decay))
        for k, v in dict(state.get("shadow", {})).items():
            if k in self.shadow:
                self.shadow[k].copy_(v.to(self.shadow[k].device))


def compute_v3_early_stop_metric(
    preds_14: np.ndarray,
    labels_14: np.ndarray,
    masks_14: np.ndarray,
    *,
    is_random_exposure: Optional[np.ndarray] = None,
) -> Dict[str, float]:
    """计算基于 `action_mask` 与无偏抽样的 V3 早停主指标：

    `early_stop_score = 0.7 * unbiased_macro_roc_auc + 0.3 * negative_auc`
    """
    probs = np.asarray(preds_14, dtype=np.float64)
    y_true = np.asarray(labels_14, dtype=np.float64)
    mask = np.asarray(masks_14, dtype=np.float64) > 0.5

    if probs.ndim != 2 or probs.shape[1] != len(V3_PREDICTION_HEADS):
        raise ValueError(f"expected shape (N, {len(V3_PREDICTION_HEADS)}), got {probs.shape}")

    def _safe_head_aucs(row_selector: np.ndarray) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for h_idx, h_name in enumerate(V3_PREDICTION_HEADS):
            valid = row_selector & mask[:, h_idx]
            if int(np.sum(valid)) < 2:
                continue
            yt = y_true[valid, h_idx]
            yp = probs[valid, h_idx]
            # 全正或全负无法定义单头 ROC-AUC，跳过并只汇总可定义头
            if np.unique(yt).size < 2:
                continue
            out[h_name] = float(roc_auc_score(yt, yp))
        return out

    all_rows = np.ones(probs.shape[0], dtype=bool)
    full_aucs = _safe_head_aucs(all_rows)

    if is_random_exposure is not None and int(np.sum(np.asarray(is_random_exposure) > 0)) >= 10:
        unbiased_aucs = _safe_head_aucs(np.asarray(is_random_exposure) > 0)
        unbiased_macro = (
            float(np.mean(list(unbiased_aucs.values())))
            if unbiased_aucs
            else (float(np.mean(list(full_aucs.values()))) if full_aucs else 0.5)
        )
    else:
        unbiased_macro = float(np.mean(list(full_aucs.values()))) if full_aucs else 0.5

    pos_names = set(POSITIVE_ACTIONS) | {"video_quality_view"}
    neg_names = set(NEGATIVE_ACTIONS)
    pos_vals = [v for k, v in full_aucs.items() if k in pos_names]
    neg_vals = [v for k, v in full_aucs.items() if k in neg_names]

    pos_auc = float(np.mean(pos_vals)) if pos_vals else 0.5
    # 若测试切片缺少负反馈样本，温和回退到全头均分而非直接置 0
    neg_auc = float(np.mean(neg_vals)) if neg_vals else unbiased_macro

    early_stop = 0.7 * unbiased_macro + 0.3 * neg_auc
    return {
        "unbiased_macro_roc_auc": unbiased_macro,
        "positive_auc": pos_auc,
        "negative_auc": neg_auc,
        "early_stop_score": early_stop,
        "evaluated_heads": float(len(full_aucs)),
    }
