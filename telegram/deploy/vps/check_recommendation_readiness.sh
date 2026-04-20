#!/usr/bin/env bash
set -euo pipefail

OPS_URL="${1:-${OPS_URL:-http://127.0.0.1:4000/api/ops/recommendation}}"
OPS_TOKEN="${2:-${OPS_METRICS_TOKEN:-}}"

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
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
data = payload.get("data") or {}
rust_ops = data.get("rustRecommendation") or {}
runtime = rust_ops.get("runtime") or {}
summary = rust_ops.get("summary") or {}
stage_latency = summary.get("stageLatency") or {}

query_mode = runtime.get("queryHydratorExecutionMode") or "unknown"
source_mode = runtime.get("sourceExecutionMode") or "unknown"
pipeline_version = runtime.get("pipelineVersion") or "unknown"
serving_version = runtime.get("servingVersion") or "unknown"
cursor_mode = runtime.get("cursorMode") or "unknown"
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
elif (runtime.get("owner") or "unknown") != "rust":
    current_blocker = "recommendation_owner_drift"
    recommended_action = "verify_capability_owner_summary_and_rust_runtime"
elif query_mode != "parallel_bounded" or source_mode != "parallel_bounded":
    current_blocker = "recommendation_execution_mode_drift"
    recommended_action = "verify_query_and_source_parallel_runtime"
elif pipeline_version != "xalgo_candidate_pipeline_v6":
    current_blocker = "recommendation_pipeline_version_drift"
    recommended_action = "verify_recommendation_release_version"
elif serving_version != "rust_serving_v1":
    current_blocker = "recommendation_serving_version_drift"
    recommended_action = "verify_rust_serving_lane_release_version"
elif cursor_mode != "created_at_desc_v1":
    current_blocker = "recommendation_cursor_mode_drift"
    recommended_action = "verify_rust_serving_cursor_contract"
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
        "queryHydratorConcurrency": runtime.get("queryHydratorConcurrency"),
        "sourceConcurrency": runtime.get("sourceConcurrency"),
        "pipelineVersion": pipeline_version,
        "servingVersion": serving_version,
        "cursorMode": cursor_mode,
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
        "serveCacheHitCount": summary.get("serveCacheHitCount"),
        "serveCacheMissCount": summary.get("serveCacheMissCount"),
        "stableOrderDriftCount": summary.get("stableOrderDriftCount"),
        "lastRescueSelectedCount": summary.get("lastRescueSelectedCount"),
        "selfPostRescueAttemptCount": summary.get("selfPostRescueAttemptCount"),
        "selfPostRescueHitCount": summary.get("selfPostRescueHitCount"),
        "selfPostRescueHitRate": summary.get("selfPostRescueHitRate"),
        "lastGraphPerKernelRequestedLimits": summary.get("lastGraphPerKernelRequestedLimits") or {},
        "lastGraphPerKernelAvailableCounts": summary.get("lastGraphPerKernelAvailableCounts") or {},
        "lastGraphPerKernelReturnedCounts": summary.get("lastGraphPerKernelReturnedCounts") or {},
        "lastGraphPerKernelTruncatedCounts": summary.get("lastGraphPerKernelTruncatedCounts") or {},
        "lastGraphBudgetExhaustedKernels": summary.get("lastGraphBudgetExhaustedKernels") or [],
        "partialDegradeCount": summary.get("partialDegradeCount"),
        "timeoutCount": summary.get("timeoutCount"),
        "lastDegradedReasons": degraded_reasons,
        "unexpectedDegradedReasons": unexpected_degraded_reasons,
        "activePhase36Blockers": active_phase36_blockers,
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
