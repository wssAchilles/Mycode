#!/usr/bin/env python3
"""兼容入口：转发至 recsys.data.pit_export。"""

from pathlib import Path
import sys

_ML_SERVICES_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_SERVICES_ROOT))

from recsys.data.pit_export import (  # noqa: E402,F401
    DEFAULT_SYNTHETIC_PREFIXES,
    build_post_metadata_map,
    build_training_samples,
    build_vocabs,
    compute_time_bucket,
    connect_mongo,
    download_gcs_archive_files,
    export_user_actions_from_mongo,
    is_synthetic_record,
    load_actions_from_jsonl_files,
    load_synthetic_user_ids_from_db,
    main,
    merge_and_group_user_actions,
    parse_args,
)


if __name__ == "__main__":
    main()
