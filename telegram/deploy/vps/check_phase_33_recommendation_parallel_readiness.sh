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
available = bool(rust_ops.get("available"))

query_mode = runtime.get("queryHydratorExecutionMode") or "unknown"
source_mode = runtime.get("sourceExecutionMode") or "unknown"
pipeline_version = runtime.get("pipelineVersion") or "unknown"
last_degraded = summary.get("degradedReasons") or []

current_blocker = "none"
recommended_action = "phase_33_ready_for_release"

if not available:
    current_blocker = "rust_recommendation_ops_unavailable"
    recommended_action = "check_recommendation_container_and_internal_ops_route"
elif query_mode != "parallel_bounded" or source_mode != "parallel_bounded":
    current_blocker = "phase_33_runtime_mode_drift"
    recommended_action = "verify_parallel_query_runtime_definition_and_rollout_env"
elif pipeline_version != "xalgo_candidate_pipeline_v5":
    current_blocker = "phase_33_pipeline_version_drift"
    recommended_action = "verify_phase_33_pipeline_definition_and_release_version"
elif int(summary.get("timeoutCount") or 0) > 0:
    current_blocker = "query_or_source_timeout_detected"
    recommended_action = "inspect_timeout_related_degraded_reasons_before_promoting_phase_33"
elif int(summary.get("partialDegradeCount") or 0) > 0:
    current_blocker = "source_partial_degrade_active"
    recommended_action = "inspect_last_degraded_reasons_and_accept_only_expected_fail_open_paths"

result = {
    "phase": "phase_33_rust_recommendation_parallel_query_lane",
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
        "fallbackMode": runtime.get("fallbackMode"),
    },
    "phasePerfMetrics": {
        "queryHydrators": stage_latency.get("queryHydrators") or {},
        "sources": stage_latency.get("sources") or {},
        "partialDegradeCount": summary.get("partialDegradeCount"),
        "timeoutCount": summary.get("timeoutCount"),
        "lastRetrievedCount": summary.get("lastRetrievedCount"),
        "lastSelectedCount": summary.get("lastSelectedCount"),
        "lastProviderCalls": summary.get("lastProviderCalls") or {},
        "lastDegradedReasons": last_degraded,
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
