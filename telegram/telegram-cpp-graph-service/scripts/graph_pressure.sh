#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${GRAPH_PRESSURE_BASE_URL:-http://127.0.0.1:4300}"
DURATION_SECS="${GRAPH_PRESSURE_DURATION_SECS:-60}"
CONCURRENCY_LIST="${GRAPH_PRESSURE_CONCURRENCY:-1 10 100}"
BODY='{"userId":"u-root","limit":40}'

for concurrency in $CONCURRENCY_LIST; do
  end_at=$((SECONDS + DURATION_SECS))
  completed=0
  failed=0
  while (( SECONDS < end_at )); do
    pids=()
    for ((i = 0; i < concurrency; i++)); do
      (
        curl -fsS \
          -H 'Content-Type: application/json' \
          -d "$BODY" \
          "$BASE_URL/graph/neighbors" >/dev/null
      ) &
      pids+=("$!")
    done
    for pid in "${pids[@]}"; do
      if wait "$pid"; then
        completed=$((completed + 1))
      else
        failed=$((failed + 1))
      fi
    done
  done
  echo "PRESSURE concurrency=$concurrency duration_secs=$DURATION_SECS completed=$completed failed=$failed"
done
