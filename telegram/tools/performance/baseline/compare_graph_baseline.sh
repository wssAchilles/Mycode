#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GRAPH_DIR="$ROOT_DIR/telegram-cpp-graph-service"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$GRAPH_DIR/build}"
OUT_DIR="${PERFORMANCE_VERIFY_OUT_DIR:-$ROOT_DIR/reports/perf/latest}"
CURRENT_JSON="$OUT_DIR/graph-store-bench.json"
BASELINE_JSON="${GRAPH_BENCH_JSON_BASELINE_FILE:-$GRAPH_DIR/benchmarks/graph_store_baseline.json}"
SAMPLE_COUNT="${GRAPH_BENCH_VERIFY_SAMPLE_COUNT:-3}"

mkdir -p "$OUT_DIR"
cmake --build "$BUILD_DIR" --target graph-store-bench

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
for sample in $(seq 1 "$SAMPLE_COUNT"); do
  "$BUILD_DIR/graph-store-bench" --json > "$TMP_DIR/current-$sample.json"
done

python3 - "$CURRENT_JSON" "$TMP_DIR" <<'PY'
import json
import statistics
import sys
from pathlib import Path

out = Path(sys.argv[1])
sample_dir = Path(sys.argv[2])
samples: dict[str, list[dict]] = {}
for path in sorted(sample_dir.glob("current-*.json")):
    with path.open("r", encoding="utf-8") as handle:
        for item in json.load(handle):
            samples.setdefault(item["name"], []).append(item)

merged = []
for name in sorted(samples):
    items = samples[name]
    current = dict(items[0])
    for field in ("p50_us", "p95_us", "p99_us", "throughput_qps"):
        current[field] = statistics.median(float(item.get(field, 0) or 0) for item in items)
    current["memory_estimate_bytes"] = max(item.get("memory_estimate_bytes", 0) or 0 for item in items)
    for field in ("available", "candidates", "visited", "iterations"):
        current[field] = max(item.get(field, 0) or 0 for item in items)
    current["budget_exhausted"] = any(bool(item.get("budget_exhausted")) for item in items)
    merged.append(current)

out.write_text(json.dumps(merged, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

python3 -m json.tool "$CURRENT_JSON" >/dev/null

echo "Graph benchmark current: $CURRENT_JSON"
echo "Graph benchmark baseline: $BASELINE_JSON"

if [[ ! -f "$BASELINE_JSON" ]]; then
  echo "No JSON benchmark baseline found; skipping regression gate."
  exit 0
fi

python3 "$ROOT_DIR/tools/performance/gates/check_graph_bench_json.py" \
  --current "$CURRENT_JSON" \
  --baseline "$BASELINE_JSON" \
  --latency-factor "${GRAPH_BENCH_LATENCY_REGRESSION_FACTOR:-1.2}" \
  --tail-latency-factor "${GRAPH_BENCH_TAIL_LATENCY_REGRESSION_FACTOR:-2.0}" \
  --throughput-factor "${GRAPH_BENCH_THROUGHPUT_REGRESSION_FACTOR:-0.85}" \
  --memory-factor "${GRAPH_BENCH_MEMORY_REGRESSION_FACTOR:-1.5}"
