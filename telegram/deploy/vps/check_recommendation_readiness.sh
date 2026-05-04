#!/usr/bin/env bash
set -euo pipefail

OPS_URL="${1:-${OPS_URL:-http://127.0.0.1:4000/api/ops/recommendation}}"
OPS_TOKEN="${2:-${OPS_METRICS_TOKEN:-}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTATIONS_FILE="${RECOMMENDATION_RUNTIME_EXPECTATIONS_FILE:-${SCRIPT_DIR}/recommendation_runtime_contract.env}"

if [[ ! -f "${EXPECTATIONS_FILE}" ]]; then
  echo "missing recommendation runtime expectations file: ${EXPECTATIONS_FILE}" >&2
  exit 2
fi

set -a
# shellcheck source=/dev/null
source "${EXPECTATIONS_FILE}"
set +a

tmp_response="$(mktemp)"
cleanup() {
  rm -f "${tmp_response}"
}
trap cleanup EXIT

curl_args=(
  --silent
  --show-error
  --fail
  "${OPS_URL}"
)

if [[ -n "${OPS_TOKEN}" ]]; then
  curl_args=(
    --silent
    --show-error
    --fail
    -H "x-ops-token: ${OPS_TOKEN}"
    "${OPS_URL}"
  )
fi

curl "${curl_args[@]}" > "${tmp_response}"

python3 - "${tmp_response}" <<'PY'
import json
import os
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
data = payload.get("data") or {}
rust_ops = data.get("rustRecommendation") or {}
runtime = rust_ops.get("runtime") or {}
summary = rust_ops.get("summary") or {}
stage_latency = summary.get("stageLatency") or {}

def expected(name, default):
    return os.environ.get(name, default)

query_mode = runtime.get("queryHydratorExecutionMode") or "unknown"
source_mode = runtime.get("sourceExecutionMode") or "unknown"
candidate_hydrator_mode = runtime.get("candidateHydratorExecutionMode") or "unknown"
post_selection_hydrator_mode = runtime.get("postSelectionHydratorExecutionMode") or "unknown"
query_transport_mode = runtime.get("queryHydratorTransportMode") or "unknown"
source_transport_mode = runtime.get("sourceTransportMode") or "unknown"
candidate_hydrator_transport_mode = runtime.get("candidateHydratorTransportMode") or "unknown"
post_selection_hydrator_transport_mode = runtime.get("postSelectionHydratorTransportMode") or "unknown"
provider_latency_mode = runtime.get("providerLatencyMode") or "unknown"
graph_materializer_cache_mode = runtime.get("graphMaterializerCacheMode") or "unknown"
pipeline_version = runtime.get("pipelineVersion") or "unknown"
runtime_contract_version = runtime.get("runtimeContractVersion") or "unknown"
component_order_hash = runtime.get("componentOrderHash") or ""
pipeline_stage_manifest = runtime.get("pipelineStageManifest") or []
serving_version = runtime.get("servingVersion") or "unknown"
cursor_mode = runtime.get("cursorMode") or "unknown"
cache_key_mode = runtime.get("serveCacheKeyMode") or "unknown"
cache_policy_mode = runtime.get("serveCachePolicyMode") or "unknown"
async_side_effect_mode = runtime.get("asyncSideEffectMode") or "unknown"
selected_count = int(summary.get("lastSelectedCount") or 0)
retrieved_count = int(summary.get("lastRetrievedCount") or 0)
degraded_reasons = summary.get("degradedReasons") or []
expected_degraded_reasons = {
    "graph_source:all_kernels_empty",
    "graph_source:authors_materialized_empty",
    "graph_source:authors_materialized_empty_after_retry",
    "graph_source:legacy_fallback",
    "underfilled_selection",
}
unexpected_degraded_reasons = [
    reason for reason in degraded_reasons if reason not in expected_degraded_reasons
]
phase36_blocking_reasons = {
    "empty_retrieval",
    "selection:self_post_rescue_applied",
    "graph_source:authors_materialized_empty_after_retry",
}
active_phase36_blockers = [
    reason for reason in degraded_reasons if reason in phase36_blocking_reasons
]

current_blocker = "none"
recommended_action = "recommendation_ready"

if not bool(rust_ops.get("available")):
    current_blocker = "recommendation_ops_unavailable"
    recommended_action = "check_recommendation_container_and_internal_ops_route"
elif (runtime.get("owner") or "unknown") != expected("EXPECTED_RECOMMENDATION_OWNER", "rust"):
    current_blocker = "recommendation_owner_drift"
    recommended_action = "verify_capability_owner_summary_and_rust_runtime"
elif query_mode != expected("EXPECTED_RECOMMENDATION_QUERY_MODE", "parallel_bounded") or source_mode != expected("EXPECTED_RECOMMENDATION_SOURCE_MODE", "parallel_bounded"):
    current_blocker = "recommendation_execution_mode_drift"
    recommended_action = "verify_query_and_source_parallel_runtime"
elif candidate_hydrator_mode != expected("EXPECTED_RECOMMENDATION_CANDIDATE_HYDRATOR_MODE", "parallel_bounded"):
    current_blocker = "recommendation_candidate_hydrator_mode_drift"
    recommended_action = "verify_node_candidate_hydrator_parallel_runtime"
elif post_selection_hydrator_mode != expected("EXPECTED_RECOMMENDATION_POST_SELECTION_HYDRATOR_MODE", "parallel_bounded"):
    current_blocker = "recommendation_post_selection_hydrator_mode_drift"
    recommended_action = "verify_node_post_selection_hydrator_parallel_runtime"
elif query_transport_mode != expected("EXPECTED_RECOMMENDATION_QUERY_TRANSPORT_MODE", "batch_http_v1"):
    current_blocker = "recommendation_query_transport_mode_drift"
    recommended_action = "verify_batched_query_hydrator_provider_lane"
elif source_transport_mode != expected("EXPECTED_RECOMMENDATION_SOURCE_TRANSPORT_MODE", "batch_http_v1_with_graph_branch"):
    current_blocker = "recommendation_source_transport_mode_drift"
    recommended_action = "verify_batched_source_provider_lane_and_graph_branch"
elif candidate_hydrator_transport_mode != expected("EXPECTED_RECOMMENDATION_CANDIDATE_HYDRATOR_TRANSPORT_MODE", "http_provider_stage_v1"):
    current_blocker = "recommendation_candidate_hydrator_transport_mode_drift"
    recommended_action = "verify_candidate_hydrator_provider_stage_contract"
elif post_selection_hydrator_transport_mode != expected("EXPECTED_RECOMMENDATION_POST_SELECTION_HYDRATOR_TRANSPORT_MODE", "http_provider_stage_v1"):
    current_blocker = "recommendation_post_selection_hydrator_transport_mode_drift"
    recommended_action = "verify_post_selection_hydrator_provider_stage_contract"
elif provider_latency_mode != expected("EXPECTED_RECOMMENDATION_PROVIDER_LATENCY_MODE", "http_path_v1"):
    current_blocker = "recommendation_provider_latency_mode_drift"
    recommended_action = "verify_provider_http_latency_attribution_contract"
elif graph_materializer_cache_mode != expected("EXPECTED_RECOMMENDATION_GRAPH_MATERIALIZER_CACHE_MODE", "rust_short_ttl_with_node_provider_cache_v1"):
    current_blocker = "recommendation_graph_materializer_cache_mode_drift"
    recommended_action = "verify_rust_and_node_graph_materializer_cache_lane"
elif pipeline_version != expected("EXPECTED_RECOMMENDATION_PIPELINE_VERSION", "xalgo_candidate_pipeline_v7"):
    current_blocker = "recommendation_pipeline_version_drift"
    recommended_action = "verify_recommendation_release_version"
elif runtime_contract_version != expected("EXPECTED_RECOMMENDATION_RUNTIME_CONTRACT_VERSION", "recommendation_runtime_contract_v6"):
    current_blocker = "recommendation_runtime_contract_version_drift"
    recommended_action = "verify_recommendation_runtime_contract_release_version"
elif not component_order_hash:
    current_blocker = "recommendation_component_order_hash_missing"
    recommended_action = "verify_canonical_pipeline_definition_manifest"
elif not pipeline_stage_manifest:
    current_blocker = "recommendation_pipeline_stage_manifest_missing"
    recommended_action = "verify_canonical_pipeline_manifest_export"
elif serving_version != expected("EXPECTED_RECOMMENDATION_SERVING_VERSION", "rust_serving_v1"):
    current_blocker = "recommendation_serving_version_drift"
    recommended_action = "verify_rust_serving_lane_release_version"
elif cursor_mode != expected("EXPECTED_RECOMMENDATION_CURSOR_MODE", "created_at_desc_v1"):
    current_blocker = "recommendation_cursor_mode_drift"
    recommended_action = "verify_rust_serving_cursor_contract"
elif cache_key_mode != expected("EXPECTED_RECOMMENDATION_CACHE_KEY_MODE", "normalized_query_v2"):
    current_blocker = "recommendation_cache_key_mode_drift"
    recommended_action = "verify_rust_serve_cache_key_normalization_contract"
elif cache_policy_mode != expected("EXPECTED_RECOMMENDATION_CACHE_POLICY_MODE", "bounded_short_ttl_v1"):
    current_blocker = "recommendation_cache_policy_mode_drift"
    recommended_action = "verify_rust_serve_cache_policy_contract"
elif async_side_effect_mode != expected("EXPECTED_RECOMMENDATION_ASYNC_SIDE_EFFECT_MODE", "post_response_background_v1"):
    current_blocker = "recommendation_side_effect_mode_drift"
    recommended_action = "verify_post_response_side_effect_dispatch_lane"
elif not (summary.get("lastGraphPerKernelRequestedLimits") or {}):
    current_blocker = "recommendation_graph_budget_missing"
    recommended_action = "verify_rust_graph_budget_summary_contract"
elif retrieved_count <= 0:
    current_blocker = "recommendation_primary_retrieval_empty"
    recommended_action = "verify_popular_graph_and_cold_start_primary_sources_before_promoting"
elif active_phase36_blockers:
    current_blocker = "recommendation_quality_recovery_incomplete"
    recommended_action = "clear_empty_retrieval_self_rescue_and_materializer_retry_before_promoting"
elif int(summary.get("timeoutCount") or 0) > 0:
    current_blocker = "recommendation_timeout_detected"
    recommended_action = "inspect_provider_timeout_reasons_before_promoting"
elif int(summary.get("sourceBatchTimeoutCount") or 0) > 0:
    current_blocker = "recommendation_source_batch_timeout_detected"
    recommended_action = "inspect_source_batch_timeout_reasons_before_promoting"
elif int(summary.get("partialDegradeCount") or 0) > 0 and (
    selected_count <= 0 or unexpected_degraded_reasons
):
    current_blocker = "recommendation_partial_degrade_active"
    recommended_action = "inspect_unexpected_degraded_reasons_before_promoting"

result = {
    "capability": "recommendation",
    "owner": runtime.get("owner") or "unknown",
    "currentBlocker": current_blocker,
    "recommendedAction": recommended_action,
    "runtimeMode": {
        "stageExecutionMode": runtime.get("stageExecutionMode"),
        "queryHydratorExecutionMode": query_mode,
        "sourceExecutionMode": source_mode,
        "candidateHydratorExecutionMode": candidate_hydrator_mode,
        "postSelectionHydratorExecutionMode": post_selection_hydrator_mode,
        "queryHydratorTransportMode": query_transport_mode,
        "sourceTransportMode": source_transport_mode,
        "candidateHydratorTransportMode": candidate_hydrator_transport_mode,
        "postSelectionHydratorTransportMode": post_selection_hydrator_transport_mode,
        "providerLatencyMode": provider_latency_mode,
        "providerLatencyBudgetMs": runtime.get("providerLatencyBudgetMs"),
        "graphMaterializerCacheMode": graph_materializer_cache_mode,
        "sourceBatchComponentTimeoutMs": runtime.get("sourceBatchComponentTimeoutMs"),
        "queryHydratorConcurrency": runtime.get("queryHydratorConcurrency"),
        "sourceConcurrency": runtime.get("sourceConcurrency"),
        "candidateHydratorConcurrency": runtime.get("candidateHydratorConcurrency"),
        "postSelectionHydratorConcurrency": runtime.get("postSelectionHydratorConcurrency"),
        "pipelineVersion": pipeline_version,
        "runtimeContractVersion": runtime_contract_version,
        "componentOrderHash": component_order_hash,
        "pipelineStageManifestCount": len(pipeline_stage_manifest),
        "pipelineStageManifest": pipeline_stage_manifest,
        "servingVersion": serving_version,
        "cursorMode": cursor_mode,
        "serveCacheKeyMode": cache_key_mode,
        "serveCachePolicyMode": cache_policy_mode,
        "asyncSideEffectMode": async_side_effect_mode,
        "fallbackMode": runtime.get("fallbackMode"),
        "graphProviderMode": runtime.get("graphProviderMode"),
    },
    "capabilityMetrics": {
        "queryHydrators": stage_latency.get("queryHydrators") or {},
        "sources": stage_latency.get("sources") or {},
        "lastPrimarySourceCandidates": summary.get("lastRetrievedCount"),
        "lastRetrievedCount": summary.get("lastRetrievedCount"),
        "lastSelectedCount": summary.get("lastSelectedCount"),
        "lastHasMore": summary.get("lastHasMore"),
        "lastNextCursor": summary.get("lastNextCursor"),
        "lastServingVersion": summary.get("lastServingVersion"),
        "lastCursorMode": summary.get("lastCursorMode"),
        "lastServedStateVersion": summary.get("lastServedStateVersion"),
        "lastStableOrderKey": summary.get("lastStableOrderKey"),
        "lastDuplicateSuppressedCount": summary.get("lastDuplicateSuppressedCount"),
        "lastCrossPageDuplicateCount": summary.get("lastCrossPageDuplicateCount"),
        "lastServeCacheHit": summary.get("lastServeCacheHit"),
        "serveCacheHitRate": summary.get("serveCacheHitRate"),
        "lastCachePolicyReason": summary.get("lastCachePolicyReason"),
        "serveCacheHitCount": summary.get("serveCacheHitCount"),
        "serveCacheMissCount": summary.get("serveCacheMissCount"),
        "stableOrderDriftCount": summary.get("stableOrderDriftCount"),
        "lastPageRemainingCount": summary.get("lastPageRemainingCount"),
        "lastPageUnderfilled": summary.get("lastPageUnderfilled"),
        "lastPageUnderfillReason": summary.get("lastPageUnderfillReason"),
        "pageUnderfillCount": summary.get("pageUnderfillCount"),
        "pageUnderfillRate": summary.get("pageUnderfillRate"),
        "lastSuppressionReasons": summary.get("lastSuppressionReasons") or {},
        "suppressionReasonCounts": summary.get("suppressionReasonCounts") or {},
        "underfillReasonCounts": summary.get("underfillReasonCounts") or {},
        "lastRescueSelectedCount": summary.get("lastRescueSelectedCount"),
        "selfPostRescueAttemptCount": summary.get("selfPostRescueAttemptCount"),
        "selfPostRescueHitCount": summary.get("selfPostRescueHitCount"),
        "selfPostRescueHitRate": summary.get("selfPostRescueHitRate"),
        "sideEffectDispatchCount": summary.get("sideEffectDispatchCount"),
        "sideEffectCompleteCount": summary.get("sideEffectCompleteCount"),
        "sideEffectFailureCount": summary.get("sideEffectFailureCount"),
        "lastSideEffectError": summary.get("lastSideEffectError"),
        "lastSideEffectNames": summary.get("lastSideEffectNames") or [],
        "lastGraphPerKernelRequestedLimits": summary.get("lastGraphPerKernelRequestedLimits") or {},
        "lastGraphPerKernelAvailableCounts": summary.get("lastGraphPerKernelAvailableCounts") or {},
        "lastGraphPerKernelReturnedCounts": summary.get("lastGraphPerKernelReturnedCounts") or {},
        "lastGraphPerKernelTruncatedCounts": summary.get("lastGraphPerKernelTruncatedCounts") or {},
        "lastGraphBudgetExhaustedKernels": summary.get("lastGraphBudgetExhaustedKernels") or [],
        "lastGraphMaterializerQueryDurationMs": summary.get("lastGraphMaterializerQueryDurationMs"),
        "lastGraphMaterializerProviderLatencyMs": summary.get("lastGraphMaterializerProviderLatencyMs"),
        "lastGraphMaterializerCacheHit": summary.get("lastGraphMaterializerCacheHit"),
        "lastGraphMaterializerCacheKeyMode": summary.get("lastGraphMaterializerCacheKeyMode"),
        "lastGraphMaterializerCacheTtlMs": summary.get("lastGraphMaterializerCacheTtlMs"),
        "lastGraphMaterializerCacheEntryCount": summary.get("lastGraphMaterializerCacheEntryCount"),
        "lastGraphMaterializerCacheEvictionCount": summary.get("lastGraphMaterializerCacheEvictionCount"),
        "graphMaterializerCacheHitCount": summary.get("graphMaterializerCacheHitCount"),
        "graphMaterializerCacheMissCount": summary.get("graphMaterializerCacheMissCount"),
        "graphMaterializerCacheHitRate": summary.get("graphMaterializerCacheHitRate"),
        "lastProviderLatencyMs": summary.get("lastProviderLatencyMs") or {},
        "lastSlowProvider": summary.get("lastSlowProvider"),
        "lastSlowProviderMs": summary.get("lastSlowProviderMs"),
        "providerLatencyBudgetExceededCount": summary.get("providerLatencyBudgetExceededCount"),
        "providerLatencyBudgetMs": summary.get("providerLatencyBudgetMs"),
        "sourceBatchTimeoutCount": summary.get("sourceBatchTimeoutCount"),
        "lastSourceBatchTimedOutSources": summary.get("lastSourceBatchTimedOutSources") or [],
        "sourceBatchComponentTimeoutMs": summary.get("sourceBatchComponentTimeoutMs"),
        "partialDegradeCount": summary.get("partialDegradeCount"),
        "timeoutCount": summary.get("timeoutCount"),
        "lastDegradedReasons": degraded_reasons,
        "unexpectedDegradedReasons": unexpected_degraded_reasons,
        "activePhase36Blockers": active_phase36_blockers,
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
