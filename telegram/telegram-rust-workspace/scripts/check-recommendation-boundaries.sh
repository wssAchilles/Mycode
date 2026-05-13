#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SERVICE_SRC="${PROJECT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/src"

fail() {
  printf 'recommendation boundary check failed: %s\n' "$1" >&2
  exit 1
}

if rg -n 'SELECTOR_DETAIL_|selector_detail_contract_violations|insert_selector_policy_snapshot_detail|selector_count_map_json|selector_string_array_json|build_selector_stage_detail|fn build_selector_stage|struct SelectorStageInput' \
  "${SERVICE_SRC}/pipeline/executor" \
  "${SERVICE_SRC}/replay/evaluator.rs" >/tmp/telegram_selector_detail_drift.txt; then
  cat /tmp/telegram_selector_detail_drift.txt >&2
  fail "selector detail and stage payload construction must stay inside selectors/top_k/"
fi

if rg -n 'RANKING_CANDIDATE_FIELD_WRITES_FIELD|annotate_ranking_stage_detail|annotate_stage_contract_detail' \
  "${SERVICE_SRC}/pipeline/local/scorers/runner.rs" >/tmp/telegram_ranking_detail_drift.txt; then
  cat /tmp/telegram_ranking_detail_drift.txt >&2
  fail "ranking stage detail construction must stay inside scorers/stage_detail.rs"
fi

if rg -n 'SERVING_PAGE_BUILD|SERVING_STAGE_|SERVING_SCORE_INPUT|serving_page_build_detail_contract_violations|serving_stage_detail_contract_violations|SELF_POST_RESCUE_DETAIL_|SELF_POST_RESCUE_MODE|SELF_POST_RESCUE_PROVIDER_NAME' \
  "${SERVICE_SRC}/pipeline/executor" \
  "${SERVICE_SRC}/replay/evaluator.rs" >/tmp/telegram_serving_detail_drift.txt; then
  cat /tmp/telegram_serving_detail_drift.txt >&2
  fail "serving detail construction must stay inside serving/stage_detail.rs"
fi

if [[ -e "${SERVICE_SRC}/pipeline/executor/stages.rs" ]]; then
  fail "generic executor stages.rs must stay deleted; use domain-specific executor modules"
fi

if rg -n 'fn build_(self_post_rescue|serve_cache|serving)_stage|struct ServingStageInput' \
  "${SERVICE_SRC}/pipeline/executor" >/tmp/telegram_serving_payload_drift.txt; then
  cat /tmp/telegram_serving_payload_drift.txt >&2
  fail "serving stage payload construction must stay inside serving/stage_payload.rs"
fi

if rg -n 'build_serve_cache_stage|SERVE_CACHE_LATENCY_KEY' \
  "${SERVICE_SRC}/pipeline/executor/mod.rs" >/tmp/telegram_serve_cache_main_drift.txt; then
  cat /tmp/telegram_serve_cache_main_drift.txt >&2
  fail "serve-cache stage recording must stay inside pipeline/executor/cache_replay.rs"
fi

if sed '/#\[cfg(test)\]/,$d' "${SERVICE_SRC}/pipeline/executor/mod.rs" \
  | rg -n 'Recommendation(Summary|Selector|ServingSummary)Payload|build_online_eval|build_recommendation_trace|PAGE_BUILD_LATENCY_KEY' >/tmp/telegram_executor_response_builder_drift.txt; then
  cat /tmp/telegram_executor_response_builder_drift.txt >&2
  fail "live response and summary construction must stay inside pipeline/executor/response.rs"
fi

if sed '/#\[cfg(test)\]/,$d' "${SERVICE_SRC}/pipeline/executor/mod.rs" \
  | rg -n 'evaluate_store_policy|dispatch_post_response_side_effects' >/tmp/telegram_executor_completion_drift.txt; then
  cat /tmp/telegram_executor_completion_drift.txt >&2
  fail "post-response cache policy and side-effect dispatch must stay inside pipeline/executor/completion.rs"
fi

if rg -n 'fn (build_query_error_stage|apply_query_patch)' \
  "${SERVICE_SRC}/pipeline/executor" >/tmp/telegram_query_hydrator_payload_drift.txt; then
  cat /tmp/telegram_query_hydrator_payload_drift.txt >&2
  fail "query hydrator stage payload and patch rules must stay inside query_hydrators/"
fi

if rg -n 'PIPELINE_STAGE_DETAIL_ERROR(_CLASS)?_FIELD|stage\.detail\.get_or_insert_with' \
  "${SERVICE_SRC}/pipeline/executor/query_hydration.rs" >/tmp/telegram_query_hydrator_detail_drift.txt; then
  cat /tmp/telegram_query_hydrator_detail_drift.txt >&2
  fail "query hydrator error detail field operations must stay inside query_hydrators/stage_payload.rs"
fi

if rg -n 'RECENT_HOT_DETAIL_FIELD|fn build_recent_hot_stage' \
  "${SERVICE_SRC}/pipeline/executor" >/tmp/telegram_recent_hot_source_payload_drift.txt; then
  cat /tmp/telegram_recent_hot_source_payload_drift.txt >&2
  fail "recent-hot source stage payload must stay inside sources/recent_hot.rs"
fi

if rg -n '\.(weighted_score|phoenix_scores|action_scores|ranking_signals|score_contract_version|score_breakdown_version)\s*=\s*Some' \
  "${SERVICE_SRC}/sources" >/tmp/telegram_source_score_write_drift.txt; then
  cat /tmp/telegram_source_score_write_drift.txt >&2
  fail "source modules must not write ranking-owned score contract fields"
fi

if rg -n --glob '!tests.rs' '\.(weighted_score|score|pipeline_score|phoenix_scores|action_scores|ranking_signals|score_contract_version|score_breakdown_version)\s*=' \
  "${SERVICE_SRC}/pipeline/local/filters" >/tmp/telegram_filter_score_write_drift.txt; then
  cat /tmp/telegram_filter_score_write_drift.txt >&2
  fail "filter modules must not mutate ranking or model score fields"
fi

if rg -n 'JoinSet|Semaphore|\.(hydrate_query_patch|hydrate_query_patches_batch)\(|apply_query_patch|merge_query_hydrator_results' \
  "${SERVICE_SRC}/pipeline/executor/query_hydration.rs" >/tmp/telegram_query_executor_orchestration_drift.txt; then
  cat /tmp/telegram_query_executor_orchestration_drift.txt >&2
  fail "query hydrator execution, fallback, and merge logic must stay inside query_hydrators/"
fi

if rg -n 'UserActionProfile::from_query' \
  "${SERVICE_SRC}" \
  --glob '*.rs' \
  --glob '!**/pipeline/local/signals/user_actions.rs' \
  --glob '!**/pipeline/local/scorers/runner.rs' \
  --glob '!**/pipeline/local/scorers/tests.rs' \
  --glob '!**/selectors/top_k/mod.rs' >/tmp/telegram_user_action_profile_drift.txt; then
  cat /tmp/telegram_user_action_profile_drift.txt >&2
  fail "UserActionProfile request parsing must stay centralized in scorer runner or selector entry"
fi

printf 'recommendation boundary check passed\n'
