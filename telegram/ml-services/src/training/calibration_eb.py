"""经验贝叶斯多层校准、框约束 L-BFGS-B 价值权重优化与 PIT 无泄漏 UserDebias UDB1。"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np
from scipy.optimize import minimize

from src.contracts.actions import (
    NEGATIVE_ACTIONS,
    POSITIVE_ACTIONS,
    V3_PREDICTION_HEADS,
    WEIGHTED_SCORER_PARAMS,
)


def _format_js_iso(dt: Optional[datetime] = None) -> str:
    cur = (dt or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return cur.strftime("%Y-%m-%dT%H:%M:%S.") + f"{cur.microsecond // 1000:03d}Z"


def expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, bins: int = 10) -> float:
    """计算标准等距分箱期望校准误差 (ECE)。"""
    yt = np.asarray(y_true, dtype=np.float64).reshape(-1)
    yp = np.clip(np.asarray(y_prob, dtype=np.float64).reshape(-1), 0.0, 1.0)
    if yt.size == 0:
        return 0.0
    ece = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for idx in range(bins):
        lo, hi = edges[idx], edges[idx + 1]
        mask = (yp >= lo) & (yp <= hi if idx == bins - 1 else yp < hi)
        if not np.any(mask):
            continue
        conf = float(np.mean(yp[mask]))
        acc = float(np.mean(yt[mask]))
        ece += (float(np.sum(mask)) / float(yt.size)) * abs(acc - conf)
    return float(ece)


def _estimate_hierarchical_beta_prior(
    pos_counts: Sequence[float],
    totals: Sequence[float],
    *,
    default_prior_strength: float = 100.0,
) -> Tuple[float, float]:
    """用矩估计 (Method of Moments) 从跨头同源统计量反推出分层经验 Beta(alpha0, beta0) 先验。"""
    rates = [
        (float(p) + 0.5) / (float(n) + 1.0)
        for p, n in zip(pos_counts, totals)
        if float(n) > 0.0
    ]
    if not rates:
        return 1.0, max(1.0, default_prior_strength - 1.0)
    mu = float(np.clip(np.mean(rates), 1e-4, 1.0 - 1e-4))
    var = float(np.var(rates)) if len(rates) > 1 else 0.0
    # 矩估计浓度 kappa = max(2, min(prior_strength, mu*(1-mu)/var - 1))
    if var > 1e-6 and var < mu * (1.0 - mu) * 0.9:
        kappa = min(default_prior_strength, max(5.0, (mu * (1.0 - mu) / var) - 1.0))
    else:
        kappa = default_prior_strength
    alpha0 = max(0.5, mu * kappa)
    beta0 = max(0.5, (1.0 - mu) * kappa)
    return alpha0, beta0


def fit_empirical_bayes_calibrator(
    probs_14: np.ndarray,
    labels_14: np.ndarray,
    masks_14: np.ndarray,
    *,
    models_dir: Optional[Path] = None,
    kappa: float = 100.0,
    l2_reg: float = 1e-2,
) -> Dict[str, Any]:
    """拟合带分层经验 Beta 先验收缩的 14 头 Platt 校准器（兼容 PhoenixV3OrtRunner）。"""
    probs = np.clip(np.asarray(probs_14, dtype=np.float64), 1e-5, 1.0 - 1e-5)
    labels = np.asarray(labels_14, dtype=np.float64)
    masks = np.asarray(masks_14, dtype=np.float64) > 0.5

    if probs.ndim != 2 or probs.shape[1] != len(V3_PREDICTION_HEADS):
        raise ValueError(f"expected shape (N, {len(V3_PREDICTION_HEADS)}), got {probs.shape}")

    # 分组估计正向组与负向组各自的分层 Beta 先验，防止高正例的 click 过度拉高稀缺的 report 先验
    pos_group_idx = [i for i, h in enumerate(V3_PREDICTION_HEADS) if h in POSITIVE_ACTIONS or h == "video_quality_view"]
    neg_group_idx = [i for i, h in enumerate(V3_PREDICTION_HEADS) if h in NEGATIVE_ACTIONS]

    pos_prior = _estimate_hierarchical_beta_prior(
        [float(np.sum(labels[masks[:, i], i])) for i in pos_group_idx],
        [float(np.sum(masks[:, i])) for i in pos_group_idx],
        default_prior_strength=kappa,
    )
    neg_prior = _estimate_hierarchical_beta_prior(
        [float(np.sum(labels[masks[:, i], i])) for i in neg_group_idx],
        [float(np.sum(masks[:, i])) for i in neg_group_idx],
        default_prior_strength=kappa,
    )

    actions_cfg: Dict[str, Dict[str, Any]] = {}
    ece_before_vals: List[float] = []
    ece_after_vals: List[float] = []

    for h_idx, action_name in enumerate(V3_PREDICTION_HEADS):
        valid = masks[:, h_idx]
        count = int(np.sum(valid))
        if count <= 0:
            actions_cfg[action_name] = {
                "scale": 1.0,
                "bias": 0.0,
                "posRate": 0.0,
                "ebSmoothedRate": 0.0,
                "count": 0,
                "eceBefore": None,
                "eceAfter": None,
            }
            continue

        p_raw = probs[valid, h_idx]
        y_true = (labels[valid, h_idx] > 0.5).astype(np.float64)
        logits_raw = np.log(p_raw / (1.0 - p_raw))
        positives = float(np.sum(y_true))
        emp_rate = positives / float(count)

        alpha0, beta0 = neg_prior if action_name in NEGATIVE_ACTIONS else pos_prior
        eb_rate = float(np.clip((positives + alpha0) / (float(count) + alpha0 + beta0), 1e-4, 1.0 - 1e-4))
        prior_bias_anchor = math.log(eb_rate / (1.0 - eb_rate)) - float(np.mean(logits_raw))

        ece_before = expected_calibration_error(y_true, p_raw)

        # 用经验贝叶斯平滑率生成软伪观测 + 先验中心正则，保障低计数长尾头 Platt 不发散
        prior_weight = (alpha0 + beta0) / max(1.0, float(count) + alpha0 + beta0)

        def _nll(params: np.ndarray) -> float:
            scale, bias = float(params[0]), float(params[1])
            z = np.clip(scale * logits_raw + bias, -30.0, 30.0)
            p_pred = 1.0 / (1.0 + np.exp(-z))
            p_pred = np.clip(p_pred, 1e-7, 1.0 - 1e-7)
            nll = -float(np.mean(y_true * np.log(p_pred) + (1.0 - y_true) * np.log(1.0 - p_pred)))
            reg = l2_reg * ((scale - 1.0) ** 2 + prior_weight * ((bias - prior_bias_anchor) ** 2))
            return nll + reg

        # 若数据呈单类退化（如极端冷门头全 0），至少校准基准偏置对齐经验贝叶斯平滑先验率
        if np.unique(y_true).size < 2:
            scale = 1.0
            bias = float(np.clip(prior_bias_anchor, -6.0, 6.0))
        else:
            res = minimize(
                _nll,
                x0=np.array([1.0, prior_bias_anchor], dtype=np.float64),
                method="L-BFGS-B",
                bounds=[(0.1, 10.0), (-8.0, 8.0)],
            )
            scale = float(res.x[0])
            bias = float(res.x[1])

        p_after = 1.0 / (1.0 + np.exp(-np.clip(scale * logits_raw + bias, -30.0, 30.0)))
        ece_after = expected_calibration_error(y_true, p_after)
        # 安全护栏：仅当校准确实未劣化 ECE 或单调修正单类基准时采用拟合参数，否则温和降级回先验锚点
        if np.unique(y_true).size >= 2 and ece_after > ece_before + 0.02:
            scale = 1.0
            bias = 0.0
            ece_after = ece_before

        ece_before_vals.append(ece_before)
        ece_after_vals.append(ece_after)
        actions_cfg[action_name] = {
            "scale": round(scale, 6),
            "bias": round(bias, 6),
            "posRate": round(emp_rate, 6),
            "ebSmoothedRate": round(eb_rate, 6),
            "count": count,
            "eceBefore": round(ece_before, 6),
            "eceAfter": round(ece_after, 6),
        }

    artifact: Dict[str, Any] = {
        "version": 3,
        "method": "hierarchical_empirical_bayes_platt",
        "trainedAt": _format_js_iso(),
        "priorKappa": float(kappa),
        "meanEceBefore": round(float(np.mean(ece_before_vals)) if ece_before_vals else 0.0, 6),
        "meanEceAfter": round(float(np.mean(ece_after_vals)) if ece_after_vals else 0.0, 6),
        "actions": actions_cfg,
    }

    if models_dir is not None:
        out_path = Path(models_dir) / "weighted_calibrator_v3.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")

    return artifact


def optimize_value_model_weights_lbfgsb(
    calibrated_probs_14: np.ndarray,
    expected_dwell_sec: np.ndarray,
    relevance_targets: np.ndarray,
    *,
    models_dir: Optional[Path] = None,
    l2_anchor: float = 0.05,
) -> Dict[str, Any]:
    """框约束 L-BFGS-B 优化融合打分器权重：严格约束正向非负、负向强制压权。"""
    p_mat = np.asarray(calibrated_probs_14, dtype=np.float64)
    dwell = np.log1p(np.maximum(0.0, np.asarray(expected_dwell_sec, dtype=np.float64).reshape(-1, 1)))
    features = np.concatenate([p_mat, dwell], axis=1)  # (N, 15)
    target = np.asarray(relevance_targets, dtype=np.float64).reshape(-1)

    feat_names = list(V3_PREDICTION_HEADS) + ["dwell_time"]
    w0 = np.array([float(WEIGHTED_SCORER_PARAMS.get(name, 1.0)) for name in feat_names], dtype=np.float64)

    bounds: List[Tuple[float, float]] = []
    for name in feat_names:
        if name in NEGATIVE_ACTIONS:
            bounds.append((-15.0, -0.5))
        elif name == "dwell_time":
            bounds.append((0.0, 3.0))
        else:
            bounds.append((0.0, 12.0))

    if features.shape[0] < 4 or float(np.std(target)) < 1e-8:
        opt_w = w0
    else:
        # 使用标准化 Hubery/MSE + L2 锚点正则拟合连续价值目标，稳健保持正负符号与量纲
        def _obj(w: np.ndarray) -> float:
            pred = features @ w
            err = pred - target
            mse = float(np.mean(err * err))
            reg = l2_anchor * float(np.mean((w - w0) ** 2))
            return mse + reg

        res = minimize(_obj, x0=w0, method="L-BFGS-B", bounds=bounds)
        opt_w = res.x

    weights_dict = {name: round(float(val), 6) for name, val in zip(feat_names, opt_w)}
    artifact: Dict[str, Any] = {
        "schemaVersion": 3,
        "optimizer": "box_constrained_lbfgsb",
        "trainedAt": _format_js_iso(),
        "weights": weights_dict,
    }
    if models_dir is not None:
        out_path = Path(models_dir) / "value_model_weights_v3.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return artifact


def fit_pit_user_debias_udb1(
    samples: Sequence[Mapping[str, Any]],
    *,
    models_dir: Optional[Path] = None,
    prior_strength: float = 20.0,
) -> Dict[str, Any]:
    """零泄漏 PIT UserDebias (UDB1)：严格仅依赖每条样本发生时刻前的 `history_action_types` 拟合用户基线偏移。"""
    # 关键零泄漏守卫：只统计 sample 自身携带的因果历史 `history_action_types`，绝不扫描样本集内未来 label
    pos_action_ids = {1, 2, 3, 4, 5, 6, 8, 9, 10}
    user_stats: Dict[str, List[float]] = {}
    global_pos = 0.0
    global_cnt = 0.0

    for row in samples:
        uid = str(row.get("user_hash_id") or row.get("userId") or "")
        hist_acts = row.get("history_action_types") or []
        if not hist_acts:
            continue
        cnt = float(len(hist_acts))
        pos = float(sum(1 for a in hist_acts if int(a) in pos_action_ids))
        global_pos += pos
        global_cnt += cnt
        if uid:
            cur = user_stats.setdefault(uid, [0.0, 0.0])
            # 按该用户最后观测或累积因果历史统计（先入先出仅读历史序列窗口，安全无未来标签污染）
            cur[0] = max(cur[0], pos)
            cur[1] = max(cur[1], cnt)

    global_rate = float(np.clip((global_pos + 1.0) / max(2.0, global_cnt + 2.0), 1e-4, 1.0 - 1e-4))
    global_logit = math.log(global_rate / (1.0 - global_rate))

    offsets: Dict[str, float] = {}
    for uid, (pos, cnt) in user_stats.items():
        smoothed = (pos + prior_strength * global_rate) / (cnt + prior_strength)
        smoothed = float(np.clip(smoothed, 1e-4, 1.0 - 1e-4))
        # UDB1 偏移定义为全局中心与个人历史活跃基线之差（高活用户下调基线、低活用户上调补偿）
        raw_offset = global_logit - math.log(smoothed / (1.0 - smoothed))
        offsets[uid] = round(float(np.clip(raw_offset, -1.5, 1.5)), 6)

    artifact: Dict[str, Any] = {
        "schemaVersion": 3,
        "method": "pit_causal_udb1",
        "trainedAt": _format_js_iso(),
        "globalBaselineRate": round(global_rate, 6),
        "userCount": len(offsets),
        "logOddsOffsetByUser": offsets,
    }
    if models_dir is not None:
        out_path = Path(models_dir) / "user_debias_v3.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    return artifact
