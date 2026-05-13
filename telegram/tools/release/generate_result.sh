#!/usr/bin/env bash
set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${RELEASE_RESULT_OUT_DIR:-$ROOT_DIR/reports/release}"
OUT_FILE="${RELEASE_RESULT_FILE:-$OUT_DIR/result.json}"

mkdir -p "$OUT_DIR"

run_stage() {
  local name="$1"
  shift
  local log_file="$OUT_DIR/$name.log"
  if "$@" >"$log_file" 2>&1; then
    printf 'pass'
    return 0
  fi
  printf 'fail'
  return 1
}

COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
CPP_STATUS="$(run_stage cpp bash "$ROOT_DIR/tools/release/verify_cpp.sh")"
GO_STATUS="$(run_stage go bash "$ROOT_DIR/tools/release/verify_go.sh")"
PERF_STATUS="$(run_stage performance bash "$ROOT_DIR/tools/release/verify_performance.sh")"
DIFF_STATUS="$(run_stage diff git -C "$ROOT_DIR" diff --check)"

OVERALL="pass"
if [[ "$CPP_STATUS" != "pass" || "$GO_STATUS" != "pass" || "$PERF_STATUS" != "pass" || "$DIFF_STATUS" != "pass" ]]; then
  OVERALL="fail"
fi

cat >"$OUT_FILE" <<JSON
{
  "commit": "$COMMIT",
  "overall": "$OVERALL",
  "cpp": {
    "verification": "$CPP_STATUS",
    "log": "$OUT_DIR/cpp.log"
  },
  "go": {
    "verification": "$GO_STATUS",
    "log": "$OUT_DIR/go.log"
  },
  "performance": {
    "verification": "$PERF_STATUS",
    "log": "$OUT_DIR/performance.log"
  },
  "diff": {
    "check": "$DIFF_STATUS",
    "log": "$OUT_DIR/diff.log"
  }
}
JSON

echo "Wrote release result to $OUT_FILE"
[[ "$OVERALL" == "pass" ]]
