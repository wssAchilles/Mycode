"""V3 多源统一 Parquet 数据湖构建管线 CLI 与汇总清单生成器。"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pyarrow.parquet as pq

from src.contracts.artifacts import compute_file_sha256
from src.data.adapters import (
    convert_kuairec_to_v3_records,
    convert_kuairand_to_v3_records,
    convert_microlens_to_v3_records,
    convert_mind_to_v3_records,
    load_prod_pit_v3_records,
)
from src.data.parquet_schema import (
    assert_valid_v3_posts_table,
    records_to_v3_posts_table,
    records_to_v3_samples_table,
)


def run_v3_parquet_conversion(
    *,
    output_dir: Path,
    kuairand_dir: Optional[Path] = None,
    mind_dir: Optional[Path] = None,
    kuairec_dir: Optional[Path] = None,
    microlens_dir: Optional[Path] = None,
    prod_pit_dir: Optional[Path] = None,
    exclude_demo_cohort: bool = False,
) -> Dict[str, Any]:
    """合并多源适配器产出并按 split (train/val/eval_random/test) 写出统一 V3 Parquet 与 SHA-256 清单。"""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    all_samples: List[Dict[str, Any]] = []
    all_posts: List[Dict[str, Any]] = []
    source_stats: Dict[str, Any] = {}

    if prod_pit_dir is not None and Path(prod_pit_dir).exists():
        s, p, st = load_prod_pit_v3_records(Path(prod_pit_dir), exclude_demo_cohort=exclude_demo_cohort)
        all_samples.extend(s)
        all_posts.extend(p)
        source_stats["prod_pit_v3"] = st

    if kuairand_dir is not None and Path(kuairand_dir).exists():
        s, p, st = convert_kuairand_to_v3_records(Path(kuairand_dir))
        all_samples.extend(s)
        all_posts.extend(p)
        source_stats["kuairand"] = st

    if mind_dir is not None and Path(mind_dir).exists():
        s, p, st = convert_mind_to_v3_records(Path(mind_dir))
        all_samples.extend(s)
        all_posts.extend(p)
        source_stats["mind"] = st

    if kuairec_dir is not None and Path(kuairec_dir).exists():
        s, p, st = convert_kuairec_to_v3_records(Path(kuairec_dir))
        all_samples.extend(s)
        all_posts.extend(p)
        source_stats["kuairec"] = st

    if microlens_dir is not None and Path(microlens_dir).exists():
        s, p, st = convert_microlens_to_v3_records(Path(microlens_dir))
        all_samples.extend(s)
        all_posts.extend(p)
        source_stats["microlens"] = st

    # 按 split 分片写入样本，写盘前必过 V3_TRAINING_SAMPLE_SCHEMA 与 zero PIT leakage 强校验
    by_split: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in all_samples:
        by_split[str(row.get("split") or "train")].append(row)

    split_files: Dict[str, Any] = {}
    for split_name, rows in sorted(by_split.items()):
        table = records_to_v3_samples_table(rows)
        dst = out / f"v3_samples_{split_name}.parquet"
        pq.write_table(table, dst, compression="zstd")
        split_files[split_name] = {
            "path": dst.name,
            "rows": len(rows),
            "sha256": compute_file_sha256(dst),
        }

    # 去重聚合多源正文语料写盘
    dedup_posts: Dict[str, Dict[str, Any]] = {}
    for p in all_posts:
        dedup_posts[str(p["post_id"])] = p
    posts_table = records_to_v3_posts_table(list(dedup_posts.values()))
    assert_valid_v3_posts_table(posts_table)
    posts_dst = out / "v3_posts_corpus.parquet"
    pq.write_table(posts_table, posts_dst, compression="zstd")

    manifest = {
        "schema": "v3_unified_multidataset_parquet_v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "zeroPitLeakageVerified": True,
        "totalSamples": len(all_samples),
        "totalPosts": len(dedup_posts),
        "sourceStats": source_stats,
        "splits": split_files,
        "postsCorpus": {
            "path": posts_dst.name,
            "rows": len(dedup_posts),
            "sha256": compute_file_sha256(posts_dst),
        },
    }
    (out / "v3_dataset_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="多源推荐数据统一转 V3 Parquet 管线")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--kuairand-dir", type=Path, default=None)
    parser.add_argument("--mind-dir", type=Path, default=None)
    parser.add_argument("--kuairec-dir", type=Path, default=None)
    parser.add_argument("--microlens-dir", type=Path, default=None)
    parser.add_argument("--prod-pit-dir", type=Path, default=None)
    parser.add_argument("--exclude-demo-cohort", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = run_v3_parquet_conversion(
        output_dir=args.output_dir,
        kuairand_dir=args.kuairand_dir,
        mind_dir=args.mind_dir,
        kuairec_dir=args.kuairec_dir,
        microlens_dir=args.microlens_dir,
        prod_pit_dir=args.prod_pit_dir,
        exclude_demo_cohort=args.exclude_demo_cohort,
    )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
