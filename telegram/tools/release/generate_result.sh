#!/usr/bin/env bash
set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${RELEASE_RESULT_OUT_DIR:-$ROOT_DIR/reports/release}"
OUT_FILE="${RELEASE_RESULT_FILE:-$OUT_DIR/result.json}"
STAGE_FILE="$OUT_DIR/stages.tsv"

mkdir -p "$OUT_DIR"
: > "$STAGE_FILE"

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

run_stage() {
  local name="$1"
  shift
  local log_file="$OUT_DIR/$name.log"
  local start_ms
  local end_ms
  local duration_ms
  local status
  start_ms="$(now_ms)"
  if "$@" >"$log_file" 2>&1; then
    status="pass"
  else
    status="fail"
  fi
  end_ms="$(now_ms)"
  duration_ms=$((end_ms - start_ms))
  printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$duration_ms" "$log_file" >> "$STAGE_FILE"
  printf '%s' "$status"
  return 0
}

COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"
DIRTY="false"
if [[ -n "$(git -C "$ROOT_DIR" status --short 2>/dev/null || true)" ]]; then
  DIRTY="true"
fi
CPP_STATUS="$(run_stage cpp bash "$ROOT_DIR/tools/release/verify_cpp.sh")"
GO_STATUS="$(run_stage go bash "$ROOT_DIR/tools/release/verify_go.sh")"
PERF_STATUS="$(run_stage performance bash "$ROOT_DIR/tools/release/verify_performance.sh")"
DIFF_STATUS="$(run_stage diff git -C "$ROOT_DIR" diff --check)"

OVERALL="pass"
if [[ "$CPP_STATUS" != "pass" || "$GO_STATUS" != "pass" || "$PERF_STATUS" != "pass" || "$DIFF_STATUS" != "pass" ]]; then
  OVERALL="fail"
fi

export RELEASE_RESULT_OUT_FILE="$OUT_FILE"
export RELEASE_RESULT_STAGE_FILE="$STAGE_FILE"
export RELEASE_RESULT_COMMIT="$COMMIT"
export RELEASE_RESULT_BRANCH="$BRANCH"
export RELEASE_RESULT_DIRTY="$DIRTY"
export RELEASE_RESULT_OVERALL="$OVERALL"
export RELEASE_RESULT_CPP_STATUS="$CPP_STATUS"
export RELEASE_RESULT_GO_STATUS="$GO_STATUS"
export RELEASE_RESULT_PERF_STATUS="$PERF_STATUS"
export RELEASE_RESULT_DIFF_STATUS="$DIFF_STATUS"
export RELEASE_RESULT_OUT_DIR="$OUT_DIR"

python3 <<'PY'
import datetime as dt
import json
import os
from pathlib import Path

stage_file = Path(os.environ["RELEASE_RESULT_STAGE_FILE"])
stages = []
for line in stage_file.read_text(encoding="utf-8").splitlines():
    name, status, duration_ms, log = line.split("\t", 3)
    stages.append({
        "name": name,
        "status": status,
        "durationMs": int(duration_ms),
        "log": log,
    })

by_name = {stage["name"]: stage for stage in stages}
out_dir = os.environ["RELEASE_RESULT_OUT_DIR"]
payload = {
    "generatedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
    "commit": os.environ["RELEASE_RESULT_COMMIT"],
    "branch": os.environ["RELEASE_RESULT_BRANCH"],
    "dirty": os.environ["RELEASE_RESULT_DIRTY"] == "true",
    "overall": os.environ["RELEASE_RESULT_OVERALL"],
    "stages": stages,
    "cpp": {
        "verification": os.environ["RELEASE_RESULT_CPP_STATUS"],
        "log": by_name.get("cpp", {}).get("log", f"{out_dir}/cpp.log"),
    },
    "go": {
        "verification": os.environ["RELEASE_RESULT_GO_STATUS"],
        "log": by_name.get("go", {}).get("log", f"{out_dir}/go.log"),
    },
    "performance": {
        "verification": os.environ["RELEASE_RESULT_PERF_STATUS"],
        "log": by_name.get("performance", {}).get("log", f"{out_dir}/performance.log"),
    },
    "diff": {
        "check": os.environ["RELEASE_RESULT_DIFF_STATUS"],
        "log": by_name.get("diff", {}).get("log", f"{out_dir}/diff.log"),
    },
}
Path(os.environ["RELEASE_RESULT_OUT_FILE"]).write_text(
    json.dumps(payload, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

echo "Wrote release result to $OUT_FILE"
if [[ "$OVERALL" != "pass" ]]; then
  awk -F '\t' '$2 != "pass" { print "failed stage: " $1 " log=" $4 }' "$STAGE_FILE" >&2
fi
[[ "$OVERALL" == "pass" ]]
