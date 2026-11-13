"""Pytest 钩子配置：在 macOS 上收敛 OpenMP 线程数以避免第三方轮子底层库竞争。"""

from __future__ import annotations

import os
import sys


def pytest_configure(config) -> None:  # noqa: ARG001
    if sys.platform == "darwin":
        os.environ.setdefault("OMP_NUM_THREADS", "1")
        os.environ.setdefault("MKL_NUM_THREADS", "1")
        os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
