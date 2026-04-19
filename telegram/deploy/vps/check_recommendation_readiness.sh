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
elif pipeline_version != "xalgo_candidate_pipeline_v5":
    current_blocker = "recommendation_pipeline_version_drift"
    recommended_action = "verify_recommendation_release_version"
elif int(summary.get("timeoutCount") or 0) > 0:
    current_blocker = "recommendation_timeout_detected"
    recommended_action = "inspect_provider_timeout_reasons_before_promoting"
elif int(summary.get("partialDegradeCount") or 0) > 0:
    current_blocker = "recommendation_partial_degrade_active"
    recommended_action = "inspect_last_degraded_reasons_and_accept_only_expected_paths"

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
        "fallbackMode": runtime.get("fallbackMode"),
        "graphProviderMode": runtime.get("graphProviderMode"),
    },
    "capabilityMetrics": {
        "queryHydrators": stage_latency.get("queryHydrators") or {},
        "sources": stage_latency.get("sources") or {},
        "lastRetrievedCount": summary.get("lastRetrievedCount"),
        "lastSelectedCount": summary.get("lastSelectedCount"),
        "partialDegradeCount": summary.get("partialDegradeCount"),
        "timeoutCount": summary.get("timeoutCount"),
        "lastDegradedReasons": summary.get("degradedReasons") or [],
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
