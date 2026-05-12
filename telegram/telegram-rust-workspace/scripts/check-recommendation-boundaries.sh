#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SERVICE_SRC="${PROJECT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/src"

fail() {
  printf 'recommendation boundary check failed: %s\n' "$1" >&2
  exit 1
}

if rg -n 'SELECTOR_DETAIL_|selector_detail_contract_violations|insert_selector_policy_snapshot_detail|selector_count_map_json|selector_string_array_json' \
  "${SERVICE_SRC}/pipeline/executor" \
  "${SERVICE_SRC}/replay/evaluator.rs" >/tmp/telegram_selector_detail_drift.txt; then
  cat /tmp/telegram_selector_detail_drift.txt >&2
  fail "selector detail construction must stay inside selectors/top_k/detail.rs"
fi

if rg -n 'RANKING_CANDIDATE_FIELD_WRITES_FIELD|annotate_ranking_stage_detail|annotate_stage_contract_detail' \
  "${SERVICE_SRC}/pipeline/local/scorers/runner.rs" >/tmp/telegram_ranking_detail_drift.txt; then
  cat /tmp/telegram_ranking_detail_drift.txt >&2
  fail "ranking stage detail construction must stay inside scorers/stage_detail.rs"
fi

if rg -n '\.(weighted_score|phoenix_scores|action_scores|ranking_signals|score_contract_version|score_breakdown_version)\s*=\s*Some' \
  "${SERVICE_SRC}/sources" >/tmp/telegram_source_score_write_drift.txt; then
  cat /tmp/telegram_source_score_write_drift.txt >&2
  fail "source modules must not write ranking-owned score contract fields"
fi

if sed '/#\[cfg(test)\]/,$d' "${SERVICE_SRC}/pipeline/local/filters.rs" \
  | rg -n '\.(weighted_score|score|pipeline_score|phoenix_scores|action_scores|ranking_signals|score_contract_version|score_breakdown_version)\s*=' >/tmp/telegram_filter_score_write_drift.txt; then
  cat /tmp/telegram_filter_score_write_drift.txt >&2
  fail "filter modules must not mutate ranking or model score fields"
fi

printf 'recommendation boundary check passed\n'
