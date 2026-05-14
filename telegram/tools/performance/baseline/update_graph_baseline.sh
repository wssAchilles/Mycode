#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GRAPH_DIR="$ROOT_DIR/telegram-cpp-graph-service"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$GRAPH_DIR/build}"
BASELINE_JSON="${GRAPH_BENCH_JSON_BASELINE_FILE:-$GRAPH_DIR/benchmarks/graph_store_baseline.json}"
SAMPLE_COUNT="${GRAPH_BENCH_BASELINE_SAMPLE_COUNT:-10}"

mkdir -p "$(dirname "$BASELINE_JSON")"
cmake --build "$BUILD_DIR" --target graph-store-bench

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for sample in $(seq 1 "$SAMPLE_COUNT"); do
  "$BUILD_DIR/graph-store-bench" --json > "$TMP_DIR/sample-$sample.json"
done

python3 - "$BASELINE_JSON" "$TMP_DIR" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
sample_dir = Path(sys.argv[2])
merged: dict[str, dict] = {}

for path in sorted(sample_dir.glob("sample-*.json")):
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    for item in payload:
        name = item["name"]
        current = merged.setdefault(name, dict(item))
        for field in ("p50_us", "p95_us", "p99_us", "memory_estimate_bytes"):
            current[field] = max(current.get(field, 0) or 0, item.get(field, 0) or 0)
        current["throughput_qps"] = min(
            current.get("throughput_qps", item.get("throughput_qps", 0)) or 0,
            item.get("throughput_qps", 0) or 0,
        )
        for field in ("available", "candidates", "visited", "iterations"):
            current[field] = max(current.get(field, 0) or 0, item.get(field, 0) or 0)
        current["budget_exhausted"] = bool(current.get("budget_exhausted")) or bool(item.get("budget_exhausted"))

out.write_text(
    json.dumps([merged[name] for name in sorted(merged)], indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

python3 -m json.tool "$BASELINE_JSON" >/dev/null

echo "Updated graph benchmark baseline: $BASELINE_JSON"
