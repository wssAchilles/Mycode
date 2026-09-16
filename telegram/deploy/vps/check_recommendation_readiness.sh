#!/usr/bin/env bash
# Recommendation capability readiness.
# Usage: check_recommendation_readiness.sh <ops_recommendation_url> [ops_token]
# Contract: machine-readable JSON on stdout for release_gate_report.py.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/vps/lib/ops_readiness.sh
source "${SCRIPT_DIR}/lib/ops_readiness.sh"

OPS_URL="${1:?ops recommendation url is required}"
OPS_TOKEN="${2-}"

if ! RAW="$(fetch_ops_json "${OPS_URL}" "${OPS_TOKEN}")"; then
  emit_fetch_failure "recommendation" "${OPS_URL}" "curl_failed"
  exit 1
fi

DATA="$(printf '%s' "${RAW}" | unwrap_ops_data)"
if [[ "${DATA}" == *'"__error"'* ]]; then
  emit_fetch_failure "recommendation" "${OPS_URL}" "${DATA}"
  exit 1
fi

# Parse readiness payload into the gate contract fields.
python3 - "${DATA}" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
readiness = data.get("readiness") or {}
ownership = (data.get("ownership") or {}).get("recommendation") or {}
config = data.get("config") or {}
runtime = data.get("runtime") or {}
rust = data.get("rustRecommendation") or {}
rollout = data.get("rolloutEvidence") or {}
probes = readiness.get("probes") or {}

blockers = [str(b) for b in (readiness.get("blockers") or []) if b]
mode = str(readiness.get("mode") or config.get("mode") or runtime.get("mode") or "")
owner = str(ownership.get("owner") or config.get("mode") or "")

# Map first blocker (joined) to a stable primary blocker token.
if not blockers:
    blocker = "none"
    action = "recommendation_ready"
    state = "ready"
else:
    blocker = blockers[0]
    action = ";".join(blockers)
    if any("waiting_for_traffic" in b for b in blockers):
        blocker = "waiting_for_traffic"
        state = "waiting_for_traffic"
        action = "allow_traffic_or_extend_rollout_window"
    else:
        state = "blocked"
        if blocker.startswith("rust_provider_unavailable"):
            action = "check_rust_recommendation_service_and_RUST_RECOMMENDATION_URL"
        elif blocker.startswith("node_recommendation_adapter_unavailable"):
            action = "check_backend_internal_recommendation_health"
        elif blocker.startswith("embedding_contract"):
            action = "resolve_embedding_contract_remediation_before_promote"
        elif blocker.startswith("graph_"):
            action = "inspect_graph_kernel_readiness_via_check_graph_readiness"
        elif "rollout" in blocker:
            action = "inspect_recommendation_rollout_evidence_and_policy"
        elif "replay_logging" in blocker:
            action = "fix_recommendation_trace_replay_logging_fields"

metrics = {
    "mode": mode,
    "owner": ownership.get("owner"),
    "canonicalAlgorithmOwner": ownership.get("canonicalAlgorithmOwner"),
    "configuredServingOwner": ownership.get("configuredServingOwner"),
    "fallbackMode": ownership.get("fallbackMode"),
    "blockers": blockers,
    "readinessStatus": readiness.get("status"),
    "probes": {
        "rustRecommendation": probes.get("rustRecommendation"),
        "nodeAdapter": probes.get("nodeAdapter"),
        "graphKernel": {
            "available": (probes.get("graphKernel") or {}).get("available"),
            "error": (probes.get("graphKernel") or {}).get("error"),
        },
    },
    "rolloutEvidence": {
        "status": rollout.get("status"),
        "primarySamples": rollout.get("primarySamples"),
        "validPrimarySamples": rollout.get("validPrimarySamples"),
        "fallbackRatio": rollout.get("fallbackRatio"),
        "blockers": rollout.get("blockers"),
    },
    "evidence": readiness.get("evidence"),
    "rustAvailable": rust.get("available"),
    "url": config.get("url"),
}

payload = {
    "capability": "recommendation",
    "owner": owner,
    "currentBlocker": blocker,
    "recommendedAction": action,
    "runtimeMode": mode,
    "capabilityMetrics": metrics,
    "readinessState": state,
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
