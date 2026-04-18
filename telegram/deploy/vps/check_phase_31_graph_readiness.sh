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
graph_summary = summary.get("lastGraphPerKernelCandidateCounts") or {}
graph_latency = summary.get("lastGraphPerKernelLatencyMs") or {}
graph_empty_reasons = summary.get("lastGraphPerKernelEmptyReasons") or {}
graph_errors = summary.get("lastGraphPerKernelErrors") or {}
graph_kernel_requests = graph_kernel.get("requests") or {}
kernel_latency = graph_kernel_requests.get("kernelLatency") or {}
empty_reason_counts = graph_kernel_requests.get("emptyReasonCounts") or {}

current_blocker = "none"
recommended_action = "phase_31_ready_for_release"

if graph_owner != "cpp":
    current_blocker = "graph_owner_drift"
    recommended_action = "verify_cpp_graph_kernel_runtime_and_node_capability_summary"
elif not graph_kernel.get("available"):
    current_blocker = "cpp_graph_kernel_unavailable"
    recommended_action = "check_cpp_graph_kernel_container_and_internal_ops_route"
elif not kernel_latency:
    current_blocker = "kernel_latency_missing"
    recommended_action = "verify_phase_31_cpp_ops_payload_and_kernel_metrics"
elif not graph_summary or not graph_latency:
    current_blocker = "rust_graph_summary_missing"
    recommended_action = "verify_phase_31_rust_graph_summary_contract"
elif summary.get("lastGraphEmptyReason") == "legacy_fallback_used":
    current_blocker = "legacy_graph_fallback_active"
    recommended_action = "inspect_per_kernel_empty_reasons_and_materializer_path"

result = {
    "phase": "phase_31_graph_kernel_diagnostics_lane",
    "owner": graph_owner,
    "currentBlocker": current_blocker,
    "recommendedAction": recommended_action,
    "runtimeMode": {
        "graphProviderMode": runtime.get("graphProviderMode"),
        "pipelineVersion": runtime.get("pipelineVersion"),
        "stageExecutionMode": runtime.get("stageExecutionMode"),
    },
    "phasePerfMetrics": {
        "rustPerKernelCandidateCounts": graph_summary,
        "rustPerKernelLatencyMs": graph_latency,
        "rustPerKernelEmptyReasons": graph_empty_reasons,
        "rustPerKernelErrors": graph_errors,
        "rustDominantKernelSource": summary.get("lastGraphDominantSource"),
        "rustDominanceShare": summary.get("lastGraphDominanceShare"),
        "rustGraphEmptyReason": summary.get("lastGraphEmptyReason"),
        "cppKernelLatency": kernel_latency,
        "cppEmptyReasonCounts": empty_reason_counts,
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
