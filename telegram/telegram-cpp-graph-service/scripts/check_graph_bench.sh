#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$ROOT_DIR/build}"
BASELINE_FILE="${GRAPH_BENCH_BASELINE_FILE:-}"

cmake --build "$BUILD_DIR" --target graph-store-bench
OUTPUT="$("$BUILD_DIR/graph-store-bench")"
printf '%s\n' "$OUTPUT"

if [[ -z "$BASELINE_FILE" ]]; then
  exit 0
fi

awk '
  FNR == NR {
    for (i = 1; i <= NF; i++) {
      split($i, kv, "=")
      if (kv[1] == "name") name = kv[2]
      if (kv[1] == "p95_us") p95 = kv[2]
    }
    if (name != "" && p95 != "") baseline[name] = p95
    name = ""; p95 = ""
    next
  }
  {
    for (i = 1; i <= NF; i++) {
      split($i, kv, "=")
      if (kv[1] == "name") name = kv[2]
      if (kv[1] == "p95_us") p95 = kv[2]
    }
    if (name in baseline && p95 > baseline[name] * 1.2) {
      printf("benchmark regression: %s p95_us=%s baseline=%s\n", name, p95, baseline[name]) > "/dev/stderr"
      failed = 1
    }
    name = ""; p95 = ""
  }
  END { exit failed }
' "$BASELINE_FILE" <(printf '%s\n' "$OUTPUT")
