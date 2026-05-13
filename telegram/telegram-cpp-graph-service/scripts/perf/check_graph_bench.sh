#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$ROOT_DIR/build}"
BASELINE_FILE="${GRAPH_BENCH_BASELINE_FILE:-${1:-}}"
LATENCY_FACTOR="${GRAPH_BENCH_LATENCY_REGRESSION_FACTOR:-1.2}"
THROUGHPUT_FACTOR="${GRAPH_BENCH_THROUGHPUT_REGRESSION_FACTOR:-0.85}"
MEMORY_FACTOR="${GRAPH_BENCH_MEMORY_REGRESSION_FACTOR:-1.5}"

cmake --build "$BUILD_DIR" --target graph-store-bench
OUTPUT="$("$BUILD_DIR/graph-store-bench")"
printf '%s\n' "$OUTPUT"

if [[ -z "$BASELINE_FILE" ]]; then
  exit 0
fi

awk -v latency_factor="$LATENCY_FACTOR" -v throughput_factor="$THROUGHPUT_FACTOR" -v memory_factor="$MEMORY_FACTOR" '
  FNR == NR {
    for (i = 1; i <= NF; i++) {
      split($i, kv, "=")
      if (kv[1] == "name") name = kv[2]
      if (kv[1] == "p50_us") p50 = kv[2]
      if (kv[1] == "p95_us") p95 = kv[2]
      if (kv[1] == "p99_us") p99 = kv[2]
      if (kv[1] == "throughput_qps") throughput = kv[2]
      if (kv[1] == "memory_estimate_bytes") memory = kv[2]
    }
    if (name != "") {
      baseline_p50[name] = p50
      baseline_p95[name] = p95
      baseline_p99[name] = p99
      baseline_throughput[name] = throughput
      baseline_memory[name] = memory
    }
    name = ""; p50 = ""; p95 = ""; p99 = ""; throughput = ""; memory = ""
    next
  }
  {
    for (i = 1; i <= NF; i++) {
      split($i, kv, "=")
      if (kv[1] == "name") name = kv[2]
      if (kv[1] == "p50_us") p50 = kv[2]
      if (kv[1] == "p95_us") p95 = kv[2]
      if (kv[1] == "p99_us") p99 = kv[2]
      if (kv[1] == "throughput_qps") throughput = kv[2]
      if (kv[1] == "memory_estimate_bytes") memory = kv[2]
    }
    if (name in baseline_p50 && baseline_p50[name] > 0 && p50 > baseline_p50[name] * latency_factor) {
      printf("benchmark regression: %s p50_us=%s baseline=%s\n", name, p50, baseline_p50[name]) > "/dev/stderr"
      failed = 1
    }
    if (name in baseline_p95 && baseline_p95[name] > 0 && p95 > baseline_p95[name] * latency_factor) {
      printf("benchmark regression: %s p95_us=%s baseline=%s\n", name, p95, baseline_p95[name]) > "/dev/stderr"
      failed = 1
    }
    if (name in baseline_p99 && baseline_p99[name] > 0 && p99 > baseline_p99[name] * latency_factor) {
      printf("benchmark regression: %s p99_us=%s baseline=%s\n", name, p99, baseline_p99[name]) > "/dev/stderr"
      failed = 1
    }
    if (name in baseline_throughput && baseline_throughput[name] > 0 && throughput < baseline_throughput[name] * throughput_factor) {
      printf("benchmark regression: %s throughput_qps=%s baseline=%s\n", name, throughput, baseline_throughput[name]) > "/dev/stderr"
      failed = 1
    }
    if (name in baseline_memory && baseline_memory[name] > 0 && memory > baseline_memory[name] * memory_factor) {
      printf("benchmark regression: %s memory_estimate_bytes=%s baseline=%s\n", name, memory, baseline_memory[name]) > "/dev/stderr"
      failed = 1
    }
    name = ""; p50 = ""; p95 = ""; p99 = ""; throughput = ""; memory = ""
  }
  END { exit failed }
' "$BASELINE_FILE" <(printf '%s\n' "$OUTPUT")
