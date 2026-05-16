#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_DIR="${ROOT_DIR}/deploy/vps"
WORK_DIR="${1:?work dir is required}"
OPS_BASE_URL="${2:?ops base url is required}"
OPS_TOKEN="${3:?ops token is required}"

mkdir -p "${WORK_DIR}"

json_error_file() {
  local file_path="${1}"
  local capability="${2}"
  local blocker="${3}"
  local message="${4}"
  python3 - "${file_path}" "${capability}" "${blocker}" "${message}" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "capability": sys.argv[2],
    "currentBlocker": sys.argv[3],
    "recommendedAction": sys.argv[4],
    "readinessState": "blocked",
}, indent=2, sort_keys=True) + "\n")
PY
}

OPS_RECOMMENDATION_URL="${OPS_BASE_URL%/}/api/ops/recommendation"
OPS_PLATFORM_URL="${OPS_BASE_URL%/}/api/ops/platform-bus"
OPS_PLATFORM_PROBE_URL="${OPS_BASE_URL%/}/api/ops/platform-bus/probe"
OPS_REALTIME_URL="${OPS_BASE_URL%/}/api/ops/realtime"

if ! bash "${SCRIPT_DIR}/check_recommendation_readiness.sh" "${OPS_RECOMMENDATION_URL}" "${OPS_TOKEN}" > "${WORK_DIR}/recommendation.json"; then
  json_error_file "${WORK_DIR}/recommendation.json" "recommendation" "recommendation_readiness_check_failed" "inspect_ops_recommendation_route"
fi
if ! bash "${SCRIPT_DIR}/check_graph_readiness.sh" "${OPS_RECOMMENDATION_URL}" "${OPS_TOKEN}" > "${WORK_DIR}/graph.json"; then
  json_error_file "${WORK_DIR}/graph.json" "graph" "graph_readiness_check_failed" "inspect_graph_ops_contract"
fi
if ! bash "${SCRIPT_DIR}/check_realtime_readiness.sh" "${OPS_REALTIME_URL}" "${OPS_TOKEN}" > "${WORK_DIR}/realtime.json"; then
  json_error_file "${WORK_DIR}/realtime.json" "realtime" "realtime_readiness_check_failed" "inspect_realtime_ops_contract"
fi
if ! bash "${SCRIPT_DIR}/check_platform_replay_readiness.sh" "${OPS_PLATFORM_URL}" "${OPS_TOKEN}" > "${WORK_DIR}/platform_replay.json"; then
  json_error_file "${WORK_DIR}/platform_replay.json" "platform_replay" "platform_replay_readiness_check_failed" "inspect_platform_bus_ops_contract"
fi
if ! curl --silent --show-error --fail -H "x-ops-token: ${OPS_TOKEN}" "${OPS_PLATFORM_PROBE_URL}" > "${WORK_DIR}/platform_probe.json"; then
  json_error_file "${WORK_DIR}/platform_probe.json" "platform_probe" "platform_probe_failed" "inspect_delivery_consumer_platform_probe"
fi
