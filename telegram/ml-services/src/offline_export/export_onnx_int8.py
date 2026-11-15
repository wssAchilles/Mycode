"""V3 ONNX FP32 导出、ORT 动态 INT8 量化与 Fail-Closed 数值等价门禁工具。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import tempfile

import numpy as np
import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process
import torch
import torch.nn as nn

from src.models.interfaces import V3PhoenixSpec, V3RQVaeSpec, V3TwoTowerSpec
from src.offline_export.validate_fp32_int8_parity import ParityCheckReport, validate_fp32_int8_parity


@dataclass(frozen=True)
class OnnxExportResult:
    """单个模型的 ONNX FP32 -> INT8 导出及数值一致性核验结果。"""

    fp32_path: Path
    int8_path: Path
    parity_reports: Tuple[ParityCheckReport, ...]
    fp32_size_bytes: int
    int8_size_bytes: int

    @property
    def passed(self) -> bool:
        return all(report.passed for report in self.parity_reports)


def _feeds_to_torch_tuple(
    sample_feeds: Mapping[str, np.ndarray],
    input_names: Sequence[str],
) -> Tuple[torch.Tensor, ...]:
    """按严格顺序将 NumPy 样本字典转为 CPU Torch 张量元组，匹配 ONNX forward 签名。"""
    tensors: List[torch.Tensor] = []
    for name in input_names:
        arr = np.asarray(sample_feeds[name])
        if np.issubdtype(arr.dtype, np.floating):
            t = torch.from_numpy(arr.astype(np.float32, copy=False))
        elif np.issubdtype(arr.dtype, np.integer) or arr.dtype == np.bool_:
            t = torch.from_numpy(arr.astype(np.int64, copy=False))
        else:
            t = torch.from_numpy(arr)
        tensors.append(t.cpu())
    return tuple(tensors)


def export_fp32_onnx(
    model: nn.Module,
    sample_feeds: Mapping[str, np.ndarray],
    out_path: Path,
    *,
    input_names: Sequence[str],
    output_names: Sequence[str],
    dynamic_axes: Mapping[str, Mapping[int, str]],
    opset_version: int = 17,
) -> Path:
    """将 PyTorch 模型以 FP32 opset=17 导出为经过完整性检查的 ONNX 图。

    注意：PyTorch 2.15+ 在无 onnxscript 环境默认 dynamo=True 会报错，故显式锁定 dynamo=False。
    """
    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)

    # 先拷贝或原地切换 CPU/eval，避免导出阶段改动训练卡显存状态
    orig_device = next((p.device for p in model.parameters()), torch.device("cpu"))
    was_training = model.training
    try:
        model.eval()
        model.to("cpu")
        example_args = _feeds_to_torch_tuple(sample_feeds, input_names)
        with torch.no_grad():
            torch.onnx.export(
                model,
                example_args,
                str(target),
                input_names=list(input_names),
                output_names=list(output_names),
                dynamic_axes={k: dict(v) for k, v in dynamic_axes.items()},
                opset_version=int(opset_version),
                do_constant_folding=True,
                dynamo=False,
            )
        checked = onnx.load(str(target))
        onnx.checker.check_model(checked)
    finally:
        model.to(orig_device)
        if was_training:
            model.train()

    return target


def quantize_onnx_dynamic_int8(
    fp32_path: Path,
    int8_path: Path,
    *,
    op_types_to_quantize: Optional[Sequence[str]] = ("MatMul", "Gemm"),
    per_channel: bool = True,
    preprocess: bool = True,
) -> Path:
    """使用 ONNX Runtime 将 FP32 ONNX 线性矩阵权重动态量化为 QInt8。

    默认先做 ORT 符号形状推断与图预处理并启用 `per_channel=True` 仅量化 `MatMul` / `Gemm`，
    以同时压低大型 Transformer logits 的量化 MAE 与消除离散查表 Embed 量化退化。
    """
    src = Path(fp32_path)
    dst = Path(int8_path)
    dst.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        quant_input = src
        if preprocess:
            pre_path = Path(tmp_dir) / f"{src.stem}_pre.onnx"
            try:
                quant_pre_process(str(src), str(pre_path), skip_symbolic_shape=False)
                if pre_path.exists() and pre_path.stat().st_size > 0:
                    quant_input = pre_path
            except Exception:
                # 若特定自定义符号维度预处理受限，安全回退原始 checked FP32 图
                quant_input = src

        kwargs: Dict[str, Any] = {
            "model_input": str(quant_input),
            "model_output": str(dst),
            "weight_type": QuantType.QInt8,
            "per_channel": bool(per_channel),
        }
        if op_types_to_quantize is not None:
            kwargs["op_types_to_quantize"] = list(op_types_to_quantize)

        quantize_dynamic(**kwargs)

    checked = onnx.load(str(dst))
    onnx.checker.check_model(checked)
    return dst


def export_and_quantize_with_parity(
    model: nn.Module,
    sample_feeds: Mapping[str, np.ndarray],
    fp32_path: Path,
    int8_path: Path,
    *,
    input_names: Sequence[str],
    output_names: Sequence[str],
    dynamic_axes: Mapping[str, Mapping[int, str]],
    min_cosine: float = 0.99,
    max_mae: float = 0.02,
    opset_version: int = 17,
    fail_on_parity: bool = True,
) -> OnnxExportResult:
    """串联完成 FP32 ONNX 导出 -> INT8 动态量化 -> 全输出槽位的 ORT Parity Gate 检验。"""
    exported_fp32 = export_fp32_onnx(
        model,
        sample_feeds,
        fp32_path,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=opset_version,
    )
    exported_int8 = quantize_onnx_dynamic_int8(exported_fp32, int8_path)

    reports: List[ParityCheckReport] = []
    for out_idx in range(len(output_names)):
        report = validate_fp32_int8_parity(
            exported_fp32,
            exported_int8,
            sample_feeds,
            min_cosine=min_cosine,
            max_mae=max_mae,
            output_index=out_idx,
        )
        reports.append(report)
        if fail_on_parity and not report.passed:
            raise RuntimeError(
                f"ONNX FP32 vs INT8 parity check failed on output[{out_idx}]={output_names[out_idx]}: {report.reasons}"
            )

    return OnnxExportResult(
        fp32_path=exported_fp32,
        int8_path=exported_int8,
        parity_reports=tuple(reports),
        fp32_size_bytes=int(exported_fp32.stat().st_size),
        int8_size_bytes=int(exported_int8.stat().st_size),
    )


def export_text_encoder_v3_onnx_int8(
    model: nn.Module,
    out_dir: Path,
    *,
    seq_len: int = 128,
    min_cosine: float = 0.99,
    max_mae: float = 0.02,
) -> OnnxExportResult:
    """导出并量化 `text_encoder_int8.onnx`（严格匹配 `TextEncoderOrtRunner` 输入契约）。"""
    rng = np.random.default_rng(7)
    sample_ids = rng.integers(101, 455, size=(2, seq_len), dtype=np.int64)
    sample_mask = np.ones((2, seq_len), dtype=np.int64)
    sample_feeds = {"input_ids": sample_ids, "attention_mask": sample_mask}
    dynamic_axes = {
        "input_ids": {0: "batch", 1: "seq"},
        "attention_mask": {0: "batch", 1: "seq"},
        "embedding": {0: "batch"},
    }
    return export_and_quantize_with_parity(
        model,
        sample_feeds,
        Path(out_dir) / "text_encoder_fp32.onnx",
        Path(out_dir) / "text_encoder_int8.onnx",
        input_names=("input_ids", "attention_mask"),
        output_names=("embedding",),
        dynamic_axes=dynamic_axes,
        min_cosine=min_cosine,
        max_mae=max_mae,
    )


def export_two_tower_user_v3_onnx_int8(
    user_tower: nn.Module,
    out_dir: Path,
    *,
    max_seq_len: int = 32,
    min_cosine: float = 0.99,
    max_mae: float = 0.02,
) -> OnnxExportResult:
    """导出并量化 `two_tower_user_int8.onnx`（7 个标准序列输入 -> `(B, K, D)` MoL 向量）。"""
    spec = V3TwoTowerSpec()
    rng = np.random.default_rng(11)
    bsz, seq = 2, max_seq_len
    sample_feeds: Dict[str, np.ndarray] = {
        "history_post_hashes": rng.integers(2, 1000, size=(bsz, seq), dtype=np.int64),
        "history_author_hashes": rng.integers(2, 500, size=(bsz, seq), dtype=np.int64),
        "history_action_types": rng.integers(0, 16, size=(bsz, seq), dtype=np.int64),
        "history_time_buckets": rng.integers(0, 16, size=(bsz, seq), dtype=np.int64),
        "history_sids": rng.integers(1, 257, size=(bsz, seq, 6), dtype=np.int64),
        "history_action_masks": np.ones((bsz, seq, 13), dtype=np.float32),
        "attention_mask": np.ones((bsz, seq), dtype=np.int64),
    }
    dynamic_axes: Dict[str, Dict[int, str]] = {
        name: {0: "batch", 1: "seq"} for name in spec.onnx_input_names
    }
    dynamic_axes["user_vecs"] = {0: "batch"}

    return export_and_quantize_with_parity(
        user_tower,
        sample_feeds,
        Path(out_dir) / "two_tower_user_fp32.onnx",
        Path(out_dir) / "two_tower_user_int8.onnx",
        input_names=spec.onnx_input_names,
        output_names=("user_vecs",),
        dynamic_axes=dynamic_axes,
        min_cosine=min_cosine,
        max_mae=max_mae,
    )


def export_phoenix_v3_student_onnx_int8(
    student_model: nn.Module,
    out_dir: Path,
    *,
    hist_len: int = 32,
    cand_len: int = 8,
    min_cosine: float = 0.99,
    max_mae: float = 0.05,
) -> OnnxExportResult:
    """导出并量化 `phoenix_v3_student_int8.onnx`（14 输入 -> `action_logits (B, C, 14)` + `cread_logits (B, C, 30)`）。"""
    spec = V3PhoenixSpec()
    rng = np.random.default_rng(19)
    bsz = 1
    sample_feeds: Dict[str, np.ndarray] = {
        "history_post_hashes": rng.integers(2, 1000, size=(bsz, hist_len), dtype=np.int64),
        "history_author_hashes": rng.integers(2, 500, size=(bsz, hist_len), dtype=np.int64),
        "history_action_types": rng.integers(0, 16, size=(bsz, hist_len), dtype=np.int64),
        "history_time_buckets": rng.integers(0, 16, size=(bsz, hist_len), dtype=np.int64),
        "history_sids": rng.integers(1, 257, size=(bsz, hist_len, 6), dtype=np.int64),
        "history_action_masks": np.ones((bsz, hist_len, 13), dtype=np.float32),
        "history_mask": np.ones((bsz, hist_len), dtype=np.int64),
        "cand_post_hashes": rng.integers(2, 1000, size=(bsz, cand_len), dtype=np.int64),
        "cand_author_hashes": rng.integers(2, 500, size=(bsz, cand_len), dtype=np.int64),
        "cand_sids": rng.integers(1, 257, size=(bsz, cand_len, 6), dtype=np.int64),
        "cand_in_network": rng.integers(0, 2, size=(bsz, cand_len), dtype=np.int64),
        "cand_has_video": rng.integers(0, 2, size=(bsz, cand_len), dtype=np.int64),
        "cand_served_position": np.arange(cand_len, dtype=np.int64).reshape(bsz, cand_len),
        "cand_mask": np.ones((bsz, cand_len), dtype=np.int64),
    }
    dynamic_axes: Dict[str, Dict[int, str]] = {}
    for name in spec.onnx_input_names:
        dim1 = "hist_len" if name.startswith("history_") else "cand_len"
        dynamic_axes[name] = {0: "batch", 1: dim1}
    dynamic_axes["action_logits"] = {0: "batch", 1: "cand_len"}
    dynamic_axes["cread_logits"] = {0: "batch", 1: "cand_len"}

    return export_and_quantize_with_parity(
        student_model,
        sample_feeds,
        Path(out_dir) / "phoenix_v3_student_fp32.onnx",
        Path(out_dir) / "phoenix_v3_student_int8.onnx",
        input_names=spec.onnx_input_names,
        output_names=spec.onnx_output_names,
        dynamic_axes=dynamic_axes,
        min_cosine=min_cosine,
        max_mae=max_mae,
    )
