"""ONNX Runtime 会话管理与 4 vCPU 优化线程池。"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import threading
from typing import Dict, List, Mapping, Optional

import numpy as np
import onnxruntime as ort


@dataclass(frozen=True)
class OnnxSessionConfig:
    """面向 Cloud Run 4 vCPU 的 ONNX Runtime 线程与图优化配置。"""

    intra_op_num_threads: int = int(os.getenv("ONNX_INTRA_OP_THREADS", "4"))
    inter_op_num_threads: int = int(os.getenv("ONNX_INTER_OP_THREADS", "1"))
    enable_mem_pattern: bool = True
    enable_cpu_mem_arena: bool = True
    providers: tuple[str, ...] = ("CPUExecutionProvider",)


def create_ort_session_options(cfg: Optional[OnnxSessionConfig] = None) -> ort.SessionOptions:
    """构造开启全图优化并绑定线程数的 ORT SessionOptions。"""
    active = cfg or OnnxSessionConfig()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, int(active.intra_op_num_threads))
    opts.inter_op_num_threads = max(1, int(active.inter_op_num_threads))
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.enable_mem_pattern = bool(active.enable_mem_pattern)
    opts.enable_cpu_mem_arena = bool(active.enable_cpu_mem_arena)
    return opts


class OnnxSessionPool:
    """统一管理已加载的多个命名 ONNX 推理会话及其只读并发调用。"""

    def __init__(self, config: Optional[OnnxSessionConfig] = None) -> None:
        self._config = config or OnnxSessionConfig()
        self._sessions: Dict[str, ort.InferenceSession] = {}
        self._lock = threading.RLock()

    @property
    def config(self) -> OnnxSessionConfig:
        return self._config

    def load_session(self, name: str, model_path: Path) -> ort.InferenceSession:
        """从本地 .onnx 文件安全加载或替换推理会话。"""
        resolved = Path(model_path)
        if not resolved.exists() or not resolved.is_file():
            raise FileNotFoundError(f"ONNX model file not found: {resolved}")
        opts = create_ort_session_options(self._config)
        session = ort.InferenceSession(
            str(resolved),
            sess_options=opts,
            providers=list(self._config.providers),
        )
        with self._lock:
            self._sessions[name] = session
        return session

    def get(self, name: str) -> Optional[ort.InferenceSession]:
        with self._lock:
            return self._sessions.get(name)

    def loaded_names(self) -> List[str]:
        with self._lock:
            return sorted(self._sessions.keys())

    def run(
        self,
        name: str,
        feeds: Mapping[str, np.ndarray],
        output_names: Optional[List[str]] = None,
    ) -> List[np.ndarray]:
        """按模型输入签名自动过滤多余键并执行推理。"""
        session = self.get(name)
        if session is None:
            raise RuntimeError(f"ONNX session not loaded: {name}")
        accepted_inputs = {inp.name for inp in session.get_inputs()}
        filtered_feeds = {k: v for k, v in feeds.items() if k in accepted_inputs}
        missing = [inp.name for inp in session.get_inputs() if inp.name not in filtered_feeds]
        if missing:
            raise ValueError(f"missing ONNX inputs for {name}: {missing}")
        return session.run(output_names, filtered_feeds)
