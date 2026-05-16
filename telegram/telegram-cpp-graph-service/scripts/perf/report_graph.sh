#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${GRAPH_BUILD_DIR:-$ROOT_DIR/build}"
OUT_DIR="${GRAPH_REPORT_OUT_DIR:-$ROOT_DIR/reports/perf/$(date +%Y%m%d-%H%M%S)}"
REPORT_FILE="$OUT_DIR/graph.md"

mkdir -p "$OUT_DIR"

cmake --build "$BUILD_DIR" --target graph-store-bench >/dev/null
BENCH_OUTPUT="$("$BUILD_DIR/graph-store-bench" --json)"

{
  echo "# Graph Service Performance Report"
  echo
  echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- gitCommit: $(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  echo
  echo "## Benchmark"
  echo
  echo '```json'
  printf '%s\n' "$BENCH_OUTPUT"
  echo '```'
  echo
  echo "## Pressure"
  echo
  echo "Run scripts/perf/graph_pressure.sh against a local graph service to capture HTTP pressure results."
} > "$REPORT_FILE"

echo "Wrote graph service report to $REPORT_FILE"
