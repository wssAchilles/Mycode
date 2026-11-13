#!/usr/bin/env python3
"""近线用户特征向量刷新脚本入口，转发至 recsys.serving.feature_refresh。"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from recsys.serving.feature_refresh import run_refresh_features_job  # noqa: E402,F401


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh user features without retraining")
    parser.add_argument("--days", type=int, default=1, help="Lookback days for user actions")
    parser.add_argument("--max-users", type=int, default=None, help="Limit number of users")
    parser.add_argument("--max-history", type=int, default=50, help="Max history length")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size")
    parser.add_argument("--rebuild-faiss", action="store_true", help="Rebuild FAISS index")
    parser.add_argument("--filter-users-from-postgres", action="store_true", help="Filter users by Postgres")
    args = parser.parse_args()

    stats = run_refresh_features_job(
        days=args.days,
        max_users=args.max_users,
        max_history=args.max_history,
        batch_size=args.batch_size,
        rebuild_faiss=args.rebuild_faiss,
        filter_users_from_postgres=args.filter_users_from_postgres,
    )
    print(f"✅ Refresh completed: {stats}")


if __name__ == "__main__":
    main()
