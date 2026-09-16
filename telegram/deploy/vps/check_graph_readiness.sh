#!/usr/bin/env bash
# Graph capability readiness.
# Usage: check_graph_readiness.sh <ops_recommendation_url> [ops_token]
# Graph ownership is exposed on the Node recommendation ops payload
# (ownership.graph + graphKernel + config.graphKernelEnabled).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/vps/lib/ops_readiness.sh
source "${SCRIPT_DIR}/lib/ops_readiness.sh"

OPS_URL="${1:?ops recommendation url is required}"
OPS_TOKEN="${2-}"

if ! RAW="$(fetch_ops_json "${OPS_URL}" "${OPS_TOKEN}")"; then
  emit_fetch_failure "graph" "${OPS_URL}" "curl_failed"
  exit 1
fi

DATA="$(printf '%s' "${RAW}" | unwrap_ops_data)"
if [[ "${DATA}" == *'"__error"'* ]]; then
  emit_fetch_failure "graph" "${OPS_URL}" "${DATA}"
  exit 1
fi

python3 - "${DATA}" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
ownership = (data.get("ownership") or {}).get("graph") or {}
config = data.get("config") or {}
graph_kernel = data.get("graphKernel") or {}
readiness = data.get("readiness") or {}
probes = readiness.get("probes") or {}
graph_probe = probes.get("graphKernel") or {}
graph_kernel_config = config.get("graphKernelConfig") or graph_probe.get("config") or {}

enabled = bool(config.get("graphKernelEnabled", graph_kernel_config.get("enabled", False)))
available = graph_kernel.get("available")
if available is None:
    available = graph_probe.get("available")

owner = str(ownership.get("owner") or ("cpp" if enabled else "node"))
fallback_mode = str(ownership.get("fallbackMode") or "")

blockers = []
# recommendation readiness may already flag graph issues
for item in readiness.get("blockers") or []:
    text = str(item)
    if text.startswith("graph_") or "graph_kernel" in text:
        blockers.append(text)

if not enabled:
    # Intentionally node-primary graph path — ready, not blocked.
    blocker = "none"
    action = "graph_kernel_disabled_node_primary"
    state = "ready"
elif available is False:
    blocker = "graph_kernel_unavailable"
    error = graph_kernel.get("error") or graph_probe.get("error") or "unknown"
    action = f"check_cpp_graph_service_health:{error}"
    state = "blocked"
    blockers.append(f"graph_kernel_unavailable:{error}")
elif graph_kernel_config.get("valid") is False:
    blocker = "graph_kernel_config_invalid"
    action = "fix_CPP_GRAPH_KERNEL_*_and_snapshot_config"
    state = "blocked"
    blockers.append("graph_kernel_config_invalid")
elif blockers:
    blocker = blockers[0]
    action = ";".join(blockers)
    state = "blocked"
else:
    blocker = "none"
    action = "graph_ready"
    state = "ready"

metrics = {
    "enabled": enabled,
    "available": available,
    "owner": ownership.get("owner"),
    "fallbackMode": fallback_mode,
    "nodeRole": ownership.get("nodeRole"),
    "url": graph_kernel.get("url") or config.get("graphKernelUrl"),
    "error": graph_kernel.get("error") or graph_probe.get("error"),
    "configValid": graph_kernel_config.get("valid"),
    "blockers": blockers,
    "primarySurface": ownership.get("primarySurface"),
}

payload = {
    "capability": "graph",
    "owner": owner,
    "currentBlocker": blocker,
    "recommendedAction": action,
    "runtimeMode": fallback_mode or ("cpp_primary" if enabled else "node_primary"),
    "capabilityMetrics": metrics,
    "readinessState": state,
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
