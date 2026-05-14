#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GRAPH_DIR="$ROOT_DIR/telegram-cpp-graph-service"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$GRAPH_DIR/build}"
OUT_DIR="${PERFORMANCE_VERIFY_OUT_DIR:-$ROOT_DIR/reports/perf/latest}"
CURRENT_JSON="$OUT_DIR/graph-store-bench.json"
BASELINE_JSON="${GRAPH_BENCH_JSON_BASELINE_FILE:-$GRAPH_DIR/benchmarks/graph_store_baseline.json}"

mkdir -p "$OUT_DIR"
cmake --build "$BUILD_DIR" --target graph-store-bench
"$BUILD_DIR/graph-store-bench" --json > "$CURRENT_JSON"
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
  --throughput-factor "${GRAPH_BENCH_THROUGHPUT_REGRESSION_FACTOR:-0.85}" \
  --memory-factor "${GRAPH_BENCH_MEMORY_REGRESSION_FACTOR:-1.5}"
