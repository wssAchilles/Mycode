"""V3 训练损失契约：Masked Multi-Task BCE（严格以 action_mask 屏蔽未采集头梯度）与统计口径。"""

from __future__ import annotations

import numpy as np


def compute_masked_bce_loss_numpy(
    logits: np.ndarray,
    labels: np.ndarray,
    action_mask: np.ndarray,
    head_weights: np.ndarray | None = None,
) -> float:
    """
    验证 V3 掩码损失核心语义：action_mask==0 的头对损失和梯度贡献严格为 0。
    返回有效掩码样本上的加权平均 BCE 标量。
    """
    x = np.asarray(logits, dtype=np.float64)
    y = np.asarray(labels, dtype=np.float64)
    m = (np.asarray(action_mask, dtype=np.float64) > 0.0).astype(np.float64)
    if x.shape != y.shape or x.shape != m.shape:
        raise ValueError(f"shape mismatch: logits={x.shape}, labels={y.shape}, mask={m.shape}")

    # 数值稳定二元交叉熵 max(x,0) - x*y + log(1 + exp(-|x|))
    bce = np.maximum(x, 0.0) - x * y + np.log1p(np.exp(-np.abs(x)))
    if head_weights is not None:
        w = np.asarray(head_weights, dtype=np.float64)
        bce = bce * w
        m = m * w

    denom = float(np.sum(m))
    if denom <= 0.0:
        return 0.0
    return float(np.sum(bce * m) / denom)
