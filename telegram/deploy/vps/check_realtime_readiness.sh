#!/usr/bin/env bash
set -euo pipefail

OPS_URL="${1:-${OPS_URL:-http://127.0.0.1:4000/api/ops/realtime}}"
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
runtime = data.get("runtime") or {}
transport = data.get("transport") or {}
registry = data.get("registry") or {}
ops = data.get("ops") or {}
event_bus = data.get("eventBus") or {}
delivery_bus = data.get("deliveryBus") or {}

current_blocker = "none"
recommended_action = "realtime_ready"

if (ownership.get("owner") or "unknown") != "rust":
    current_blocker = "realtime_owner_drift"
    recommended_action = "verify_realtime_capability_owner_and_gateway_rollout_stage"
elif (runtime.get("rolloutStage") or "unknown") != "rust_edge_primary":
    current_blocker = "realtime_rollout_stage_drift"
    recommended_action = "verify_gateway_realtime_rollout_stage"
elif not bool(runtime.get("deliveryPrimaryEnabled")):
    current_blocker = "delivery_primary_disabled"
    recommended_action = "verify_rust_delivery_bus_primary_enablement"
else:
    socket_terminator = runtime.get("socketTerminator") or "node"
    expected_preferred = "rust_socket_io_compat" if socket_terminator == "rust" else "node_socket_io_compat"
    if (transport.get("preferred") or "unknown") != expected_preferred:
        current_blocker = "preferred_transport_drift"
        recommended_action = "verify_bootstrap_transport_catalog"
    elif (runtime.get("fanoutOwner") or "unknown") != "rust":
        current_blocker = "fanout_owner_drift"
        recommended_action = "verify_realtime_fanout_owner"
    elif socket_terminator not in {"node", "rust"}:
        current_blocker = "socket_terminator_drift"
        recommended_action = "verify_realtime_socket_terminator"

result = {
    "capability": "realtime",
    "owner": ownership.get("owner") or "unknown",
    "currentBlocker": current_blocker,
    "recommendedAction": recommended_action,
    "runtimeMode": {
        "rolloutStage": runtime.get("rolloutStage"),
        "fanoutOwner": runtime.get("fanoutOwner"),
        "socketTerminator": runtime.get("socketTerminator"),
        "preferredTransport": transport.get("preferred"),
        "fallbackTransport": transport.get("fallback"),
        "realtimeOwner": runtime.get("realtimeOwner"),
        "compatFallbackOwner": runtime.get("compatFallbackOwner"),
    },
    "capabilityMetrics": {
        "connectedSockets": ((registry.get("totals") or {}).get("connectedSockets")),
        "authenticatedSockets": ((registry.get("totals") or {}).get("authenticatedSockets")),
        "roomSubscriptions": ((registry.get("totals") or {}).get("roomSubscriptions")),
        "realtimeEmitted": ((ops.get("counters") or {}).get("realtimeEmitted")),
        "compatFallbackEmitted": ((ops.get("counters") or {}).get("compatFallbackEmitted")),
        "eventBusLag": ((event_bus.get("consumerGroups") or [{}])[0].get("lag") if event_bus.get("consumerGroups") else None),
        "deliveryBusLag": ((delivery_bus.get("consumerGroups") or [{}])[0].get("lag") if delivery_bus.get("consumerGroups") else None),
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
