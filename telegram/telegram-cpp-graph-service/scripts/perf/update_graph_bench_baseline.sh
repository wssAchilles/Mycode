#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$ROOT_DIR/build}"
BASELINE_FILE="${1:-$ROOT_DIR/benchmarks/graph_store_baseline.txt}"

cmake --build "$BUILD_DIR" --target graph-store-bench

mkdir -p "$(dirname "$BASELINE_FILE")"
"$BUILD_DIR/graph-store-bench" > "$BASELINE_FILE"

echo "Updated graph benchmark baseline: $BASELINE_FILE"
