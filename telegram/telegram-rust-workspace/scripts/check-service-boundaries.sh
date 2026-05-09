#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SERVICE_SRC="${PROJECT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/src"
EXECUTOR_DIR="${SERVICE_SRC}/pipeline/executor"

fail() {
  printf 'service boundary check failed: %s\n' "$1" >&2
  exit 1
}

require_file() {
  local file="$1"
  [[ -f "${file}" ]] || fail "missing ${file#${PROJECT_DIR}/}"
}

require_absent() {
  local file="$1"
  [[ ! -e "${file}" ]] || fail "${file#${PROJECT_DIR}/} must not exist"
}

require_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq -- "${needle}" "${file}" || fail "${file#${PROJECT_DIR}/} does not contain ${needle}"
}

require_absent "${EXECUTOR_DIR}/flow.rs"

for stage_file in \
  telemetry.rs \
  query_stage.rs \
  retrieval_stage.rs \
  ranking_stage.rs \
  selection_stage.rs \
  post_selection_stage.rs \
  rescue_stage.rs \
  serving_stage.rs \
  recent_hot_topup.rs; do
  require_file "${EXECUTOR_DIR}/${stage_file}"
  require_contains "${EXECUTOR_DIR}/mod.rs" "mod ${stage_file%.rs};"
done

main_lines="$(wc -l < "${SERVICE_SRC}/main.rs" | tr -d ' ')"
if [[ "${main_lines}" -gt 80 ]]; then
  fail "main.rs has ${main_lines} lines; service bootstrap must stay thin"
fi

if command -v rg >/dev/null 2>&1; then
  executor_impl_matches() {
    rg -n 'fn execute_(query|retrieval|ranking|selector|post_selection|serving)_stage|fn rescue_empty_selection|fn append_recent_hot_candidates' "$@"
  }
else
  executor_impl_matches() {
    grep -En 'fn execute_(query|retrieval|ranking|selector|post_selection|serving)_stage|fn rescue_empty_selection|fn append_recent_hot_candidates' "$@"
  }
fi

if executor_impl_matches "${EXECUTOR_DIR}/mod.rs" >/tmp/telegram_executor_impl_drift.txt; then
  cat /tmp/telegram_executor_impl_drift.txt >&2
  fail "executor/mod.rs should keep orchestration entrypoints only"
fi

printf 'service boundary check passed\n'
