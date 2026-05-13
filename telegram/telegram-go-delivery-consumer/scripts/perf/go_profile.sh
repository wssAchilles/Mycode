#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PPROF_BASE_URL="${DELIVERY_CONSUMER_PPROF_URL:-http://127.0.0.1:6060}"
OUT_DIR="${DELIVERY_CONSUMER_PROFILE_OUT_DIR:-$ROOT_DIR/reports/perf/$(date +%Y%m%d-%H%M%S)/consumer}"
SECONDS_TO_PROFILE="${DELIVERY_CONSUMER_PROFILE_SECONDS:-30}"

mkdir -p "$OUT_DIR"

curl -fsS "$PPROF_BASE_URL/debug/pprof/profile?seconds=$SECONDS_TO_PROFILE" \
  -o "$OUT_DIR/cpu.pprof"
curl -fsS "$PPROF_BASE_URL/debug/pprof/heap" \
  -o "$OUT_DIR/heap.pprof"

echo "Wrote Go profiles to $OUT_DIR"
