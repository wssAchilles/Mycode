"""Pytest 钩子配置：统一解析 ml-services 与 src 模块路径，并在 macOS 上收敛 OpenMP 线程数避免底层库竞争。"""

from __future__ import annotations

import os
from pathlib import Path
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
_SRC_ROOT = _ML_SERVICES_ROOT / "src"
for _candidate in (_SRC_ROOT, _ML_SERVICES_ROOT):
    _candidate_str = str(_candidate)
    if _candidate_str not in sys.path:
        sys.path.insert(0, _candidate_str)


def pytest_configure(config) -> None:  # noqa: ARG001
    if sys.platform == "darwin":
        os.environ.setdefault("OMP_NUM_THREADS", "1")
        os.environ.setdefault("MKL_NUM_THREADS", "1")
        os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
