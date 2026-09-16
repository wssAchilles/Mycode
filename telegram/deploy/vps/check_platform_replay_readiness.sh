#!/usr/bin/env bash
# Platform replay capability readiness.
# Usage: check_platform_replay_readiness.sh <ops_platform_bus_url> [ops_token]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/vps/lib/ops_readiness.sh
source "${SCRIPT_DIR}/lib/ops_readiness.sh"

OPS_URL="${1:?ops platform-bus url is required}"
OPS_TOKEN="${2-}"

if ! RAW="$(fetch_ops_json "${OPS_URL}" "${OPS_TOKEN}")"; then
  emit_fetch_failure "platform_replay" "${OPS_URL}" "curl_failed"
  exit 1
fi

DATA="$(printf '%s' "${RAW}" | unwrap_ops_data)"
if [[ "${DATA}" == *'"__error"'* ]]; then
  emit_fetch_failure "platform_replay" "${OPS_URL}" "${DATA}"
  exit 1
fi

python3 - "${DATA}" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
ownership = data.get("ownership") or {}
consumer = data.get("consumer") or {}
replay = data.get("replay") or {}
runtime = data.get("runtime") or {}
event_bus = data.get("eventBus") or {}

consumer_available = bool(consumer.get("available"))
consumer_error = consumer.get("error")
replay_available = replay.get("available")
if replay_available is None:
    replay_available = bool((replay.get("summary") or {})) or consumer_available

sync_wake = str(runtime.get("syncWakeExecutionMode") or "")
presence = str(runtime.get("platformPresenceExecutionMode") or "")
notification = str(runtime.get("platformNotificationExecutionMode") or "")
owner = str(ownership.get("owner") or "")

blockers = []
if not consumer_available:
    error = consumer_error or "unknown"
    blockers.append(f"delivery_consumer_unavailable:{error}")
if replay_available is False:
    error = replay.get("error") or "unknown"
    blockers.append(f"platform_replay_summary_unavailable:{error}")

# Primary platform path expects publish modes; shadow is transitional, not hard-block.
handler_modes = {
    "syncWake": sync_wake,
    "presence": presence,
    "notification": notification,
}
non_publish = [name for name, mode in handler_modes.items() if mode and mode != "publish"]
if non_publish and owner == "go":
    # Not a hard blocker for release; surface as metric and soft action.
    pass

if isinstance(event_bus, dict) and event_bus.get("available") is False:
    error = event_bus.get("error") or "unknown"
    blockers.append(f"platform_event_bus_unavailable:{error}")

if blockers:
    blocker = blockers[0]
    action = ";".join(blockers)
    state = "blocked"
else:
    blocker = "none"
    if non_publish:
        action = "platform_replay_ready_handlers_in_shadow:" + ",".join(non_publish)
    else:
        action = "platform_replay_ready"
    state = "ready"

consumer_summary = consumer.get("summary") or {}
replay_summary = replay.get("summary") or {}

metrics = {
    "owner": ownership.get("owner"),
    "fallbackMode": ownership.get("fallbackMode"),
    "consumer": {
        "available": consumer_available,
        "url": consumer.get("url"),
        "error": consumer_error,
        "summary": consumer_summary,
        "runtime": consumer.get("runtime"),
    },
    "replay": {
        "available": replay_available,
        "url": replay.get("url"),
        "error": replay.get("error"),
        "summary": replay_summary,
    },
    "handlerModes": handler_modes,
    "nonPublishHandlers": non_publish,
    "runtime": {
        "platformReplayStreamKey": runtime.get("platformReplayStreamKey"),
        "platformReplayCompletedKey": runtime.get("platformReplayCompletedKey"),
        "syncWakeExecutionMode": sync_wake,
        "platformPresenceExecutionMode": presence,
        "platformNotificationExecutionMode": notification,
        "notificationDispatchExecutionMode": runtime.get("notificationDispatchExecutionMode"),
    },
    "eventBus": event_bus,
    "blockers": blockers,
}

runtime_mode = f"owner={owner or 'unknown'};syncWake={sync_wake or 'unknown'};presence={presence or 'unknown'};notification={notification or 'unknown'}"

payload = {
    "capability": "platform_replay",
    "owner": owner,
    "currentBlocker": blocker,
    "recommendedAction": action,
    "runtimeMode": runtime_mode,
    "capabilityMetrics": metrics,
    "readinessState": state,
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
