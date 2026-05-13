#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${GRAPH_BUILD_DIR:-$ROOT_DIR/build}"

cmake --build "$BUILD_DIR"
ctest --test-dir "$BUILD_DIR" --output-on-failure
cmake --build "$BUILD_DIR" --target graph-store-bench

BASELINE_FILE="${GRAPH_BENCH_BASELINE:-$ROOT_DIR/benchmarks/graph_store_baseline.txt}"
if [[ -f "$BASELINE_FILE" ]]; then
  GRAPH_BENCH_BASELINE_FILE="$BASELINE_FILE" bash "$ROOT_DIR/scripts/perf/check_graph_bench.sh"
else
  echo "No benchmark baseline found at $BASELINE_FILE; running bench without regression gate."
  "$BUILD_DIR/graph-store-bench"
fi
