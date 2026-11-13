#!/usr/bin/env python3
"""兼容入口：训练 SocialPhoenix 线性侧车、RealGraph GBT 与 Platt 校准器。"""

from pathlib import Path
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.training.calibration_and_sidecars import main, run_sidecar_training  # noqa: E402,F401


if __name__ == "__main__":
    main()
