#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$ROOT_DIR/build}"
BASELINE_FILE="${1:-$ROOT_DIR/benchmarks/graph_store_baseline.json}"
BENCH_RUNS="${GRAPH_BENCH_RUNS:-3}"

if ! [[ "$BENCH_RUNS" =~ ^[0-9]+$ ]] || [[ "$BENCH_RUNS" -lt 1 ]]; then
  BENCH_RUNS=1
fi

cmake --build "$BUILD_DIR" --target graph-store-bench

mkdir -p "$(dirname "$BASELINE_FILE")"
RUN_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT

run_index=1
while [[ "$run_index" -le "$BENCH_RUNS" ]]; do
  "$BUILD_DIR/graph-store-bench" --json > "$RUN_DIR/run-${run_index}.json"
  run_index=$((run_index + 1))
done

python3 "$ROOT_DIR/scripts/perf/lib/select_graph_bench_payload.py" "$RUN_DIR"/*.json > "$BASELINE_FILE"

echo "Updated graph benchmark baseline: $BASELINE_FILE"
