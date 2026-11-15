"""线上 prod_pit_v3 导出快照标准化加载适配器。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

import pyarrow.parquet as pq

from src.data.parquet_schema import assert_valid_v3_samples_records


def load_prod_pit_v3_records(
    prod_pit_dir: Path,
    *,
    exclude_demo_cohort: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, int]]:
    """读取本地导出的 prod_pit_v3 Parquet 快照并检验 13 路全开掩码与 zero PIT leakage。"""
    base = Path(prod_pit_dir)
    samples_path = base / "prod_pit_samples_v3.parquet"
    posts_path = base / "prod_posts_corpus_v3.parquet"
    if not samples_path.exists():
        raise FileNotFoundError(f"prod_pit_samples_v3.parquet not found in {base}")

    samples = pq.read_table(samples_path).to_pylist()
    if exclude_demo_cohort:
        samples = [s for s in samples if not bool(s.get("is_demo_cohort"))]
    assert_valid_v3_samples_records(samples)

    posts = pq.read_table(posts_path).to_pylist() if posts_path.exists() else []
    stats = {
        "samples_loaded": len(samples),
        "posts_loaded": len(posts),
        "cohort_samples": sum(1 for s in samples if bool(s.get("is_demo_cohort"))),
    }
    return samples, posts, stats
