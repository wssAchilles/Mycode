#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${GRAPH_BENCH_BUILD_DIR:-$ROOT_DIR/build}"
BASELINE_FILE="${GRAPH_BENCH_BASELINE_FILE:-${1:-}}"
REPORT_FILE="${GRAPH_BENCH_REPORT_FILE:-}"
MAX_REGRESSION_PERCENT="${GRAPH_BENCH_MAX_REGRESSION_PERCENT:-20}"
ABSOLUTE_LATENCY_TOLERANCE_US="${GRAPH_BENCH_ABSOLUTE_LATENCY_TOLERANCE_US:-25}"
THROUGHPUT_REGRESSION_PERCENT="${GRAPH_BENCH_THROUGHPUT_REGRESSION_PERCENT:-${MAX_REGRESSION_PERCENT}}"
MEMORY_REGRESSION_PERCENT="${GRAPH_BENCH_MEMORY_REGRESSION_PERCENT:-50}"
FAILURE_MODE="${GRAPH_BENCH_FAILURE_MODE:-warn}"
BENCH_RUNS="${GRAPH_BENCH_RUNS:-3}"

if ! [[ "$BENCH_RUNS" =~ ^[0-9]+$ ]] || [[ "$BENCH_RUNS" -lt 1 ]]; then
  BENCH_RUNS=1
fi

cmake --build "$BUILD_DIR" --target graph-store-bench
RUN_DIR="$(mktemp -d)"
CURRENT_FILE="$(mktemp)"
cleanup() {
  rm -rf "$RUN_DIR"
  rm -f "$CURRENT_FILE"
}
trap cleanup EXIT

run_index=1
while [[ "$run_index" -le "$BENCH_RUNS" ]]; do
  "$BUILD_DIR/graph-store-bench" --json > "$RUN_DIR/run-${run_index}.json"
  run_index=$((run_index + 1))
done

OUTPUT="$(python3 "$ROOT_DIR/scripts/perf/lib/select_graph_bench_payload.py" "$RUN_DIR"/*.json)"
printf '%s\n' "$OUTPUT" > "$CURRENT_FILE"

if [[ -n "$REPORT_FILE" ]]; then
  mkdir -p "$(dirname "$REPORT_FILE")"
  cp "$CURRENT_FILE" "$REPORT_FILE"
fi

printf '%s\n' "$OUTPUT"

if [[ -z "$BASELINE_FILE" ]]; then
  exit 0
fi

python3 - "$BASELINE_FILE" "$CURRENT_FILE" "$MAX_REGRESSION_PERCENT" "$ABSOLUTE_LATENCY_TOLERANCE_US" "$THROUGHPUT_REGRESSION_PERCENT" "$MEMORY_REGRESSION_PERCENT" "$FAILURE_MODE" <<'PY'
import json
import sys
from pathlib import Path

baseline_path = Path(sys.argv[1])
current_path = Path(sys.argv[2])
max_latency_regression = float(sys.argv[3]) / 100.0
absolute_latency_tolerance_us = float(sys.argv[4])
max_throughput_regression = float(sys.argv[5]) / 100.0
max_memory_regression = float(sys.argv[6]) / 100.0
failure_mode = sys.argv[7]

def load_payload(raw: str):
    payload = json.loads(raw)
    if isinstance(payload, list):
        return {"results": payload}
    if isinstance(payload, dict):
        return payload
    raise ValueError("benchmark payload must be a JSON object or array")

def result_map(payload):
    results = payload.get("results") if isinstance(payload, dict) else payload
    if not isinstance(results, list):
        raise ValueError("benchmark payload missing results list")
    return {
        str(item.get("name")): item
        for item in results
        if isinstance(item, dict) and item.get("name")
    }

current = result_map(load_payload(current_path.read_text()))
baseline = result_map(load_payload(baseline_path.read_text()))
failures = []

def number(item, key):
    try:
        return float(item.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0

for name, current_item in current.items():
    baseline_item = baseline.get(name)
    if not baseline_item:
        continue
    for key in ("p50_us", "p95_us", "p99_us"):
        base_value = number(baseline_item, key)
        current_value = number(current_item, key)
        absolute_delta = current_value - base_value
        if (
            base_value > 0
            and current_value > base_value * (1.0 + max_latency_regression)
            and absolute_delta > absolute_latency_tolerance_us
        ):
            failures.append(
                f"{name} {key} regressed current={current_value:.0f} baseline={base_value:.0f}"
            )
    base_throughput = number(baseline_item, "throughput_qps")
    current_throughput = number(current_item, "throughput_qps")
    if base_throughput > 0 and current_throughput < base_throughput * (1.0 - max_throughput_regression):
        failures.append(
            f"{name} throughput_qps regressed current={current_throughput:.2f} baseline={base_throughput:.2f}"
        )
    base_memory = number(baseline_item, "memory_estimate_bytes")
    current_memory = number(current_item, "memory_estimate_bytes")
    if base_memory > 0 and current_memory > base_memory * (1.0 + max_memory_regression):
        failures.append(
            f"{name} memory_estimate_bytes regressed current={current_memory:.0f} baseline={base_memory:.0f}"
        )

if failures:
    for failure in failures:
        print(f"benchmark regression: {failure}", file=sys.stderr)
    if failure_mode == "block":
        sys.exit(1)
PY
