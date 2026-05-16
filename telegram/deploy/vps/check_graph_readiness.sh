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
ownership = data.get("ownership") or {}
graph_owner = (ownership.get("graph") or {}).get("owner") or "unknown"
rust_ops = data.get("rustRecommendation") or {}
graph_kernel = data.get("graphKernel") or {}
runtime = rust_ops.get("runtime") or {}
summary = rust_ops.get("summary") or {}
graph_kernel_requests = graph_kernel.get("requests") or {}
graph_kernel_summary = graph_kernel.get("summary") or {}
rust_total_requests = int(summary.get("totalRequests") or 0)
rust_graph_candidates = summary.get("lastGraphPerKernelCandidateCounts") or {}
rust_graph_limits = summary.get("lastGraphPerKernelRequestedLimits") or {}
cpp_request_total = int(graph_kernel_requests.get("total") or graph_kernel_summary.get("requestTotal") or 0)
has_graph_traffic = rust_total_requests > 0 or bool(rust_graph_candidates) or cpp_request_total > 0

current_blocker = "none"
recommended_action = "graph_ready"
readiness_state = "ready"

if graph_owner != "cpp":
    current_blocker = "graph_owner_drift"
    recommended_action = "verify_cpp_graph_kernel_owner_summary"
elif not bool(graph_kernel.get("available")):
    current_blocker = "graph_kernel_unavailable"
    recommended_action = "check_graph_kernel_container_and_internal_ops_route"
elif not (graph_kernel_requests.get("kernelLatency") or {}):
    current_blocker = "graph_kernel_latency_missing"
    recommended_action = "verify_graph_kernel_ops_payload"
elif not (graph_kernel_requests.get("kernelBudget") or {}):
    current_blocker = "graph_kernel_budget_missing"
    recommended_action = "verify_graph_kernel_budget_contract"
elif not has_graph_traffic:
    current_blocker = "waiting_for_traffic"
    recommended_action = "run_recommendation_or_space_feed_probe"
    readiness_state = "waiting_for_traffic"
elif not rust_graph_candidates:
    current_blocker = "rust_graph_summary_missing"
    recommended_action = "verify_rust_graph_summary_contract"
elif not rust_graph_limits:
    current_blocker = "rust_graph_budget_missing"
    recommended_action = "verify_rust_graph_budget_summary_contract"

if current_blocker not in ("none", "waiting_for_traffic"):
    readiness_state = "blocked"

result = {
    "capability": "graph",
    "owner": graph_owner,
    "currentBlocker": current_blocker,
    "recommendedAction": recommended_action,
    "readinessState": readiness_state,
    "runtimeMode": {
        "graphProviderMode": runtime.get("graphProviderMode"),
        "pipelineVersion": runtime.get("pipelineVersion"),
        "graphKernelUrl": runtime.get("graphKernelUrl"),
        "snapshotVersion": ((graph_kernel.get("snapshot") or {}).get("snapshotVersion")),
    },
    "capabilityMetrics": {
        "rustTotalRequests": rust_total_requests,
        "rustLastGraphKernelCandidates": summary.get("lastGraphKernelCandidates"),
        "rustLastGraphFallbackUsed": summary.get("lastGraphFallbackUsed"),
        "rustPerKernelCandidateCounts": rust_graph_candidates,
        "rustPerKernelRequestedLimits": rust_graph_limits,
        "rustPerKernelAvailableCounts": summary.get("lastGraphPerKernelAvailableCounts") or {},
        "rustPerKernelReturnedCounts": summary.get("lastGraphPerKernelReturnedCounts") or {},
        "rustPerKernelTruncatedCounts": summary.get("lastGraphPerKernelTruncatedCounts") or {},
        "rustPerKernelLatencyMs": summary.get("lastGraphPerKernelLatencyMs") or {},
        "rustPerKernelEmptyReasons": summary.get("lastGraphPerKernelEmptyReasons") or {},
        "rustPerKernelErrors": summary.get("lastGraphPerKernelErrors") or {},
        "rustBudgetExhaustedKernels": summary.get("lastGraphBudgetExhaustedKernels") or [],
        "rustGraphEmptyReason": summary.get("lastGraphEmptyReason"),
        "cppKernelLatency": graph_kernel_requests.get("kernelLatency") or {},
        "cppKernelBudget": graph_kernel_requests.get("kernelBudget") or {},
        "cppKernelRouteSummary": graph_kernel_requests.get("kernelRouteSummary") or graph_kernel_summary.get("kernelRouteSummary") or {},
        "cppRouteSummary": graph_kernel_requests.get("routeSummary") or graph_kernel_summary.get("routeSummary") or {},
        "cppEmptyReasonCounts": graph_kernel_requests.get("emptyReasonCounts") or {},
        "cppKernelQueryCounts": graph_kernel_requests.get("kernelQueryCounts") or {},
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
