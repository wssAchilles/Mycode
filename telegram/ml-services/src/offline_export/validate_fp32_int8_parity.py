"""V3 ONNX FP32 vs INT8 量化等价性与数值漂移校验门禁。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Mapping, Optional

import numpy as np
import onnxruntime as ort

from src.onnx_runtime.session_pool import create_ort_session_options


@dataclass(frozen=True)
class ParityCheckReport:
    """FP32 与 INT8 ONNX 模型对比验证报告。"""

    passed: bool
    mean_cosine_similarity: float
    max_abs_diff: float
    mae: float
    reasons: List[str]


def validate_fp32_int8_parity(
    fp32_onnx_path: Path,
    int8_onnx_path: Path,
    sample_feeds: Mapping[str, np.ndarray],
    *,
    min_cosine: float = 0.99,
    max_mae: float = 0.02,
    output_index: int = 0,
) -> ParityCheckReport:
    """使用真实 ORT 会话分别跑同一批 sample_feeds，核查余弦相似度与 MAE 是否在阈值内。"""
    opts = create_ort_session_options()
    sess_fp32 = ort.InferenceSession(str(fp32_onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])
    sess_int8 = ort.InferenceSession(str(int8_onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])

    feeds_fp32 = {inp.name: sample_feeds[inp.name] for inp in sess_fp32.get_inputs()}
    feeds_int8 = {inp.name: sample_feeds[inp.name] for inp in sess_int8.get_inputs()}

    out_fp32 = np.asarray(sess_fp32.run(None, feeds_fp32)[output_index], dtype=np.float64).reshape(1, -1)
    out_int8 = np.asarray(sess_int8.run(None, feeds_int8)[output_index], dtype=np.float64).reshape(1, -1)

    if out_fp32.shape != out_int8.shape:
        return ParityCheckReport(
            passed=False,
            mean_cosine_similarity=0.0,
            max_abs_diff=float("inf"),
            mae=float("inf"),
            reasons=[f"output_shape_mismatch:{out_fp32.shape}!={out_int8.shape}"],
        )

    diff = np.abs(out_fp32 - out_int8)
    max_abs = float(np.max(diff))
    mae = float(np.mean(diff))

    norm_a = np.linalg.norm(out_fp32, axis=1)
    norm_b = np.linalg.norm(out_int8, axis=1)
    denom = norm_a * norm_b
    cos = float(np.mean(np.sum(out_fp32 * out_int8, axis=1) / np.where(denom > 1e-12, denom, 1.0)))

    reasons: List[str] = []
    if cos < min_cosine:
        reasons.append(f"cosine_below_threshold:{cos:.6f}<{min_cosine:.6f}")
    if mae > max_mae:
        reasons.append(f"mae_above_threshold:{mae:.6f}>{max_mae:.6f}")

    return ParityCheckReport(
        passed=(len(reasons) == 0),
        mean_cosine_similarity=cos,
        max_abs_diff=max_abs,
        mae=mae,
        reasons=reasons,
    )
