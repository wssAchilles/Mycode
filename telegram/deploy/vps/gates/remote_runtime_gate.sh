#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# shellcheck source=deploy/vps/lib/remote.sh
source "${ROOT_DIR}/deploy/vps/lib/remote.sh"

OUTPUT_FILE="${1:?output file is required}"
REMOTE_TARGET="${2:?remote target is required}"
REMOTE_ROOT="${3:-/opt/telegram}"

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

current_release="$(read_remote_current_release "${REMOTE_TARGET}" "${REMOTE_ROOT}" || true)"
if ! run_remote_compose_ps "${REMOTE_TARGET}" "${REMOTE_ROOT}" > "${WORK_DIR}/compose_ps.txt"; then
  compose_ok=false
else
  compose_ok=true
fi
if ! run_remote_gateway_health "${REMOTE_TARGET}" > "${WORK_DIR}/gateway_health.txt"; then
  gateway_ok=false
else
  gateway_ok=true
fi

python3 - "${OUTPUT_FILE}" "${compose_ok}" "${gateway_ok}" "${current_release}" "${WORK_DIR}/compose_ps.txt" "${WORK_DIR}/gateway_health.txt" <<'PY'
import json
import sys
from pathlib import Path

output = Path(sys.argv[1])
compose_ok = sys.argv[2] == "true"
gateway_ok = sys.argv[3] == "true"
current_release = sys.argv[4]
compose_path = Path(sys.argv[5])
gateway_path = Path(sys.argv[6])
blocked = not (compose_ok and gateway_ok)
gateway_raw = gateway_path.read_text() if gateway_path.exists() else ""
try:
    gateway_health = json.loads(gateway_raw) if gateway_raw.strip().startswith("{") else gateway_raw
except json.JSONDecodeError:
    gateway_health = gateway_raw

output.write_text(json.dumps({
    "capability": "remote_runtime",
    "currentBlocker": "remote_runtime_unavailable" if blocked else "none",
    "recommendedAction": "inspect_vps_ssh_compose_and_gateway_health" if blocked else "remote_runtime_ready",
    "readinessState": "blocked" if blocked else "ready",
    "currentRelease": current_release,
    "composePs": compose_path.read_text() if compose_path.exists() else "",
    "gatewayHealth": gateway_health,
}, indent=2, sort_keys=True) + "\n")
sys.exit(1 if blocked else 0)
PY
