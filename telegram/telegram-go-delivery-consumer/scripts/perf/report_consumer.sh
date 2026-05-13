#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${DELIVERY_CONSUMER_REPORT_OUT_DIR:-$ROOT_DIR/reports/perf/$(date +%Y%m%d-%H%M%S)}"
REPORT_FILE="$OUT_DIR/consumer.md"

mkdir -p "$OUT_DIR"

{
  echo "# Delivery Consumer Performance Report"
  echo
  echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- gitCommit: $(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  echo
  echo "## Default Verification"
  echo
  if bash "$ROOT_DIR/scripts/verify/go_default.sh"; then
    echo "- go test ./...: PASS"
  else
    echo "- go test ./...: FAIL"
    exit 1
  fi
  echo
  echo "## Profiling"
  echo
  echo "Set DELIVERY_CONSUMER_PPROF_BIND_ADDR=127.0.0.1:6060 and run scripts/perf/go_profile.sh to capture CPU/heap profiles."
} > "$REPORT_FILE"

echo "Wrote delivery consumer report to $REPORT_FILE"
