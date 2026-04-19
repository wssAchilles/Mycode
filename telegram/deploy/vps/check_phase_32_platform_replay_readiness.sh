#!/usr/bin/env bash
set -euo pipefail

OPS_URL="${1:-${OPS_URL:-http://127.0.0.1:4000/api/ops/platform-bus}}"
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
owner = ownership.get("owner") or "unknown"
consumer = data.get("consumer") or {}
replay = data.get("replay") or {}
replay_summary = replay.get("summary") or {}
replay_runtime = replay_summary.get("runtime") or {}
replay_totals = replay_summary.get("totals") or {}
topics = replay_summary.get("topics") or {}
runtime = data.get("runtime") or {}

current_blocker = "none"
recommended_action = "phase_32_ready_for_release"

if owner != "go":
    current_blocker = "platform_owner_drift"
    recommended_action = "verify_go_platform_bus_runtime_and_node_capability_summary"
elif not replay.get("available"):
    current_blocker = "platform_replay_operator_unavailable"
    recommended_action = "check_go_replay_operator_endpoint_and_internal_fetch_path"
elif int(replay_runtime.get("singleTopicDrainConcurrency") or 0) != 1:
    current_blocker = "single_topic_replay_concurrency_drift"
    recommended_action = "verify_phase_32_single_topic_drain_runtime"
elif int(replay_runtime.get("crossTopicDrainConcurrency") or 0) != 3:
    current_blocker = "cross_topic_replay_concurrency_drift"
    recommended_action = "verify_phase_32_cross_topic_drain_runtime"
elif int(replay_totals.get("backlog") or 0) > 0:
    current_blocker = "platform_replay_backlog_active"
    recommended_action = "inspect_topic_status_counts_and_run_targeted_drain_if_expected"

result = {
    "phase": "phase_32_go_topic_first_replay_operator_lane",
    "owner": owner,
    "currentBlocker": current_blocker,
    "recommendedAction": recommended_action,
    "runtimeMode": {
        "syncWakeExecutionMode": runtime.get("syncWakeExecutionMode"),
        "platformPresenceExecutionMode": runtime.get("platformPresenceExecutionMode"),
        "platformNotificationExecutionMode": runtime.get("platformNotificationExecutionMode"),
        "platformReplayStreamKey": runtime.get("platformReplayStreamKey"),
        "platformReplayCompletedKey": runtime.get("platformReplayCompletedKey"),
        "singleTopicDrainConcurrency": replay_runtime.get("singleTopicDrainConcurrency"),
        "crossTopicDrainConcurrency": replay_runtime.get("crossTopicDrainConcurrency"),
    },
    "phasePerfMetrics": {
        "replayBacklog": replay_totals.get("backlog"),
        "replayStatusCounts": replay_totals.get("statusCounts") or {},
        "completedKeys": replay_totals.get("completedKeys"),
        "topics": topics,
        "platformFailed": (consumer.get("summary") or {}).get("platformFailed"),
        "platformFallbacks": (consumer.get("summary") or {}).get("platformFallbacks"),
        "platformReplayed": (consumer.get("summary") or {}).get("platformReplayed"),
    },
}

print(json.dumps(result, indent=2, sort_keys=True))
PY
