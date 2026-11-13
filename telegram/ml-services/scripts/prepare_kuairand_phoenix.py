#!/usr/bin/env python3
"""KuaiRand-27K -> Phoenix V2 PIT 流式预处理脚本入口（核心实现位于 recsys.data.kuairand_phoenix）。"""

from pathlib import Path
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.data.kuairand_phoenix import (  # noqa: E402,F401
    KuaiRandConvertConfig,
    KuaiRandConvertStats,
    convert_kuairand_to_phoenix_v2,
    discover_kuairand_files,
    load_needed_video_metadata,
    main,
    map_kuairand_row_to_labels,
    parse_args,
)


if __name__ == "__main__":
    main()
