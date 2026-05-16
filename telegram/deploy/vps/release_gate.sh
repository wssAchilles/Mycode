#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="${ROOT_DIR}/deploy/vps"

# shellcheck source=deploy/vps/lib/env.sh
source "${SCRIPT_DIR}/lib/env.sh"
# shellcheck source=deploy/vps/lib/images.sh
source "${SCRIPT_DIR}/lib/images.sh"

REMOTE_TARGET="${1:-${VPS_SSH_TARGET:-}}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
OPS_BASE_URL="${OPS_BASE_URL:-https://api.xuziqi.tech}"
DEFAULT_RELEASE_TAG="$(git -C "${ROOT_DIR}" rev-parse --short=7 HEAD)"
RELEASE_TAG="$(normalize_release_tag "${RELEASE_TAG:-${DEFAULT_RELEASE_TAG}}")"
CHECK_IMAGE_MANIFESTS="${CHECK_IMAGE_MANIFESTS:-true}"
CHECK_REMOTE_RUNTIME="${CHECK_REMOTE_RUNTIME:-true}"
RUN_OPS_CHECKS="${RUN_OPS_CHECKS:-true}"
ALLOW_WAITING_FOR_TRAFFIC="${ALLOW_WAITING_FOR_TRAFFIC:-false}"
RELEASE_GATE_REPORT_DIR="${RELEASE_GATE_REPORT_DIR:-${ROOT_DIR}/deploy-reports/${RELEASE_TAG}}"
RELEASE_GATE_REPORT_PATH="${RELEASE_GATE_REPORT_PATH:-${RELEASE_GATE_REPORT_DIR}/release-gate.json}"
RELEASE_GATE_PRINT_JSON="${RELEASE_GATE_PRINT_JSON:-false}"

if [[ -z "${REMOTE_TARGET}" && "${CHECK_REMOTE_RUNTIME}" == "true" ]]; then
  echo "VPS_SSH_TARGET or first argument is required when CHECK_REMOTE_RUNTIME=true" >&2
  exit 2
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

write_skipped() {
  local file_path="${1}"
  local capability="${2}"
  local reason="${3}"
  python3 - "${file_path}" "${capability}" "${reason}" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "capability": sys.argv[2],
    "currentBlocker": "none",
    "recommendedAction": sys.argv[3],
    "readinessState": "skipped",
}, indent=2, sort_keys=True) + "\n")
PY
}

IMAGE_REFS=()
while IFS= read -r image_ref; do
  [[ -n "${image_ref}" ]] && IMAGE_REFS+=("${image_ref}")
done < <(build_image_refs "${RELEASE_TAG}")

if [[ "${CHECK_IMAGE_MANIFESTS}" == "true" ]]; then
  if ! bash "${SCRIPT_DIR}/gates/image_manifest_gate.sh" "${WORK_DIR}/image_manifests.json" "${IMAGE_REFS[@]}"; then
    true
  fi
else
  write_skipped "${WORK_DIR}/image_manifests.json" "image_manifests" "image_manifest_check_disabled"
fi

if [[ "${CHECK_REMOTE_RUNTIME}" == "true" ]]; then
  if ! bash "${SCRIPT_DIR}/gates/remote_runtime_gate.sh" "${WORK_DIR}/remote_runtime.json" "${REMOTE_TARGET}" "${REMOTE_ROOT}"; then
    true
  fi
else
  write_skipped "${WORK_DIR}/remote_runtime.json" "remote_runtime" "remote_runtime_check_disabled"
fi

if [[ "${RUN_OPS_CHECKS}" == "true" ]]; then
  OPS_TOKEN="${OPS_METRICS_TOKEN:-}"
  if [[ -z "${OPS_TOKEN}" && "${CHECK_REMOTE_RUNTIME}" == "true" ]]; then
    OPS_TOKEN="$(read_remote_env_value "${REMOTE_TARGET}" "${REMOTE_ROOT}" OPS_METRICS_TOKEN || true)"
  fi
  if [[ -z "${OPS_TOKEN}" ]]; then
    echo "OPS_METRICS_TOKEN is required for release gate ops checks" >&2
    exit 2
  fi
  bash "${SCRIPT_DIR}/gates/ops_readiness_gate.sh" "${WORK_DIR}" "${OPS_BASE_URL}" "${OPS_TOKEN}"
else
  write_skipped "${WORK_DIR}/recommendation.json" "recommendation" "ops_checks_disabled"
  write_skipped "${WORK_DIR}/graph.json" "graph" "ops_checks_disabled"
  write_skipped "${WORK_DIR}/realtime.json" "realtime" "ops_checks_disabled"
  write_skipped "${WORK_DIR}/platform_replay.json" "platform_replay" "ops_checks_disabled"
  write_skipped "${WORK_DIR}/platform_probe.json" "platform_probe" "ops_checks_disabled"
fi

report_args=(
  --report-path "${RELEASE_GATE_REPORT_PATH}"
  --release-tag "${RELEASE_TAG}"
  --remote-target "${REMOTE_TARGET:-}"
  --ops-base-url "${OPS_BASE_URL}"
  --result "image_manifests=${WORK_DIR}/image_manifests.json"
  --result "remote_runtime=${WORK_DIR}/remote_runtime.json"
  --result "recommendation=${WORK_DIR}/recommendation.json"
  --result "graph=${WORK_DIR}/graph.json"
  --result "realtime=${WORK_DIR}/realtime.json"
  --result "platform_replay=${WORK_DIR}/platform_replay.json"
  --result "platform_probe=${WORK_DIR}/platform_probe.json"
)
[[ "${ALLOW_WAITING_FOR_TRAFFIC}" == "true" ]] && report_args+=(--allow-waiting-for-traffic)
[[ "${CHECK_IMAGE_MANIFESTS}" == "true" ]] && report_args+=(--check-image-manifests)
[[ "${CHECK_REMOTE_RUNTIME}" == "true" ]] && report_args+=(--check-remote-runtime)
[[ "${RUN_OPS_CHECKS}" == "true" ]] && report_args+=(--run-ops-checks)
[[ "${RELEASE_GATE_PRINT_JSON}" == "true" ]] && report_args+=(--print-json)

python3 "${SCRIPT_DIR}/gates/release_gate_report.py" "${report_args[@]}"
