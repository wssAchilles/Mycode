#!/usr/bin/env python3
"""兼容入口：转发至 recsys.training.phoenix_v2_trainer。"""

from pathlib import Path
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.training.phoenix_v2_trainer import (  # noqa: E402,F401
    PhoenixV2Dataset,
    PhoenixV2TrainConfig,
    collate_phoenix_v2_batch,
    main,
    parse_args,
    train_phoenix_v2,
)


if __name__ == "__main__":
    main()
