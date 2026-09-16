#!/usr/bin/env bash
# Realtime capability readiness.
# Usage: check_realtime_readiness.sh <ops_realtime_url> [ops_token]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/vps/lib/ops_readiness.sh
source "${SCRIPT_DIR}/lib/ops_readiness.sh"

OPS_URL="${1:?ops realtime url is required}"
OPS_TOKEN="${2-}"

if ! RAW="$(fetch_ops_json "${OPS_URL}" "${OPS_TOKEN}")"; then
  emit_fetch_failure "realtime" "${OPS_URL}" "curl_failed"
  exit 1
fi

DATA="$(printf '%s' "${RAW}" | unwrap_ops_data)"
if [[ "${DATA}" == *'"__error"'* ]]; then
  emit_fetch_failure "realtime" "${OPS_URL}" "${DATA}"
  exit 1
fi

python3 - "${DATA}" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
ownership = data.get("ownership") or {}
runtime = data.get("runtime") or {}
transport = data.get("transport") or {}
event_bus = data.get("eventBus") or {}
delivery_bus = data.get("deliveryBus") or {}
ops = data.get("ops") or {}
registry = data.get("registry") or {}

protocol_version = data.get("protocolVersion")
rollout_stage = str(runtime.get("rolloutStage") or "")
fanout_owner = str(runtime.get("fanoutOwner") or runtime.get("realtimeOwner") or ownership.get("owner") or "")
socket_terminator = str(runtime.get("socketTerminator") or "")
owner = str(ownership.get("owner") or fanout_owner)

blockers = []
if protocol_version is None:
    blockers.append("realtime_protocol_version_missing")
if not rollout_stage:
    blockers.append("realtime_rollout_stage_missing")
elif rollout_stage not in {"shadow", "compat_primary", "rust_edge_primary"}:
    blockers.append(f"realtime_rollout_stage_unknown:{rollout_stage}")
if not fanout_owner:
    blockers.append("realtime_fanout_owner_missing")
if not socket_terminator:
    blockers.append("realtime_socket_terminator_missing")

# Bus summaries may expose availability/errors depending on Redis state.
for label, bus in (("eventBus", event_bus), ("deliveryBus", delivery_bus)):
    if isinstance(bus, dict):
        available = bus.get("available")
        if available is False:
            error = bus.get("error") or "unknown"
            blockers.append(f"realtime_{label.lower()}_unavailable:{error}")

if blockers:
    blocker = blockers[0]
    action = ";".join(blockers)
    state = "blocked"
else:
    blocker = "none"
    action = "realtime_ready"
    state = "ready"

metrics = {
    "protocolVersion": protocol_version,
    "rolloutStage": rollout_stage,
    "fanoutOwner": fanout_owner,
    "socketTerminator": socket_terminator,
    "realtimeOwner": runtime.get("realtimeOwner"),
    "compatFallbackOwner": runtime.get("compatFallbackOwner"),
    "fallbackMode": ownership.get("fallbackMode"),
    "primarySurface": ownership.get("primarySurface"),
    "transport": {
        "preferred": transport.get("preferred"),
        "fallback": transport.get("fallback"),
        "available": transport.get("available"),
        "socketIoCompat": transport.get("socketIoCompat"),
        "syncLongPoll": transport.get("syncLongPoll"),
    },
    "eventBus": event_bus,
    "deliveryBus": delivery_bus,
    "ops": ops,
    "registry": registry,
    "blockers": blockers,
}

runtime_mode = f"{rollout_stage or 'unknown'};socketTerminator={socket_terminator or 'unknown'};fanoutOwner={fanout_owner or 'unknown'}"

payload = {
    "capability": "realtime",
    "owner": owner,
    "currentBlocker": blocker,
    "recommendedAction": action,
    "runtimeMode": runtime_mode,
    "capabilityMetrics": metrics,
    "readinessState": state,
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
