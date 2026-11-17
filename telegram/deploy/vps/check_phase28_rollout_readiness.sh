#!/usr/bin/env bash
# Phase 28G V3 推荐全栈灰度就绪度与回滚门禁巡检脚本。
# 用法:
#   check_phase28_rollout_readiness.sh [--ml-ready-url <url>] [--ops-url <url>] [--ops-token <token>] [--skip-network]
# 输出:
#   标准输出为机器可读 JSON（兼容 deploy/vps/gates 巡检），失败或阻断时以非零退出码退出（fail-closed）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_FILE="${SCRIPT_DIR}/recommendation_runtime_contract.env"
# shellcheck source=deploy/vps/lib/ops_readiness.sh
source "${SCRIPT_DIR}/lib/ops_readiness.sh"

ML_READY_URL="${ML_READY_URL:-https://telegram-ml-services-22619257282.us-central1.run.app/ready}"
OPS_RECOMMENDATION_URL=""
OPS_TOKEN=""
SKIP_NETWORK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ml-ready-url)
      ML_READY_URL="${2:?missing value for --ml-ready-url}"
      shift 2
      ;;
    --ops-url)
      OPS_RECOMMENDATION_URL="${2:?missing value for --ops-url}"
      shift 2
      ;;
    --ops-token)
      OPS_TOKEN="${2:?missing value for --ops-token}"
      shift 2
      ;;
    --skip-network)
      SKIP_NETWORK=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--ml-ready-url <url>] [--ops-url <url>] [--ops-token <token>] [--skip-network]" >&2
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "${CONTRACT_FILE}" ]]; then
  echo "Missing contract file: ${CONTRACT_FILE}" >&2
  exit 1
fi

# 加载版本与阈值合同
set -a
# shellcheck disable=SC1090
source "${CONTRACT_FILE}"
set +a

ML_READY_JSON="{}"
if [[ "${SKIP_NETWORK}" == "false" ]]; then
  if ! ML_READY_JSON="$(curl --silent --show-error --fail --max-time 15 -H "Accept: application/json" "${ML_READY_URL}")"; then
    ML_READY_JSON='{"__error":"ml_ready_unreachable"}'
  fi
fi

OPS_RECOMMENDATION_JSON="{}"
if [[ "${SKIP_NETWORK}" == "false" && -n "${OPS_RECOMMENDATION_URL}" ]]; then
  if ! OPS_RECOMMENDATION_JSON="$(bash "${SCRIPT_DIR}/check_recommendation_readiness.sh" "${OPS_RECOMMENDATION_URL}" "${OPS_TOKEN}")"; then
    OPS_RECOMMENDATION_JSON='{"readinessState":"blocked","currentBlocker":"ops_recommendation_unreachable"}'
  fi
fi

python3 - "${CONTRACT_FILE}" "${SKIP_NETWORK}" "${ML_READY_URL}" "${ML_READY_JSON}" "${OPS_RECOMMENDATION_URL}" "${OPS_RECOMMENDATION_JSON}" <<'PY'
import json
import os
import sys
from pathlib import Path

contract_file, skip_network_str, ml_url, ml_raw, ops_url, ops_raw = sys.argv[1:7]
skip_network = skip_network_str == "true"

required_contract_keys = [
    "EXPECTED_RECOMMENDATION_OWNER",
    "EXPECTED_RECOMMENDATION_PIPELINE_VERSION",
    "EXPECTED_RECOMMENDATION_RUNTIME_CONTRACT_VERSION",
    "EXPECTED_ML_READY_MANIFEST_VERIFIED",
    "EXPECTED_ML_READY_MODELS_LOADED",
    "EXPECTED_SEMANTIC_READY_MIN_RATIO",
    "RECOMMENDATION_DECISION_LOG_V1_ENABLED",
]
missing_contract_keys = [k for k in required_contract_keys if not os.environ.get(k)]

blockers = []
if missing_contract_keys:
    blockers.append(f"missing_contract_keys:{','.join(missing_contract_keys)}")

ml_probe = {"url": ml_url, "skipped": skip_network}
if not skip_network:
    try:
        ml_data = json.loads(ml_raw)
    except json.JSONDecodeError as exc:
        ml_data = {"__error": f"invalid_json:{exc}"}

    if "__error" in ml_data:
        blockers.append(f"ml_ready_failed:{ml_data['__error']}")
        ml_probe["error"] = ml_data["__error"]
    else:
        ml_probe.update({
            "ready": ml_data.get("ready"),
            "modelsLoaded": ml_data.get("models_loaded"),
            "manifestVerified": ml_data.get("manifest_verified"),
            "servingMode": ml_data.get("serving_mode"),
            "runtimeEngine": ml_data.get("runtime_engine"),
        })
        if ml_data.get("ready") is not True:
            blockers.append("ml_not_ready")
        if os.environ.get("EXPECTED_ML_READY_MODELS_LOADED") == "true" and ml_data.get("models_loaded") is not True:
            blockers.append("ml_models_not_loaded")
        if os.environ.get("EXPECTED_ML_READY_MANIFEST_VERIFIED") == "true" and ml_data.get("manifest_verified") is not True:
            blockers.append("ml_manifest_not_verified")

ops_probe = {"configured": bool(ops_url), "skipped": skip_network}
if not skip_network and ops_url:
    try:
        ops_data = json.loads(ops_raw)
    except json.JSONDecodeError:
        ops_data = {"readinessState": "blocked", "currentBlocker": "ops_json_invalid"}
    ops_probe.update({
        "url": ops_url,
        "readinessState": ops_data.get("readinessState"),
        "currentBlocker": ops_data.get("currentBlocker"),
        "owner": ops_data.get("owner"),
    })
    if ops_data.get("readinessState") not in ("ready", "waiting_for_traffic"):
        blockers.append(f"ops_recommendation:{ops_data.get('currentBlocker', 'blocked')}")

status = "contract_verified_offline" if skip_network and not blockers else ("ready" if not blockers else "blocked")

report = {
    "phase": "phase28g_rollout_readiness_v1",
    "status": status,
    "contractFile": contract_file,
    "expectedContract": {
        "owner": os.environ.get("EXPECTED_RECOMMENDATION_OWNER"),
        "pipelineVersion": os.environ.get("EXPECTED_RECOMMENDATION_PIPELINE_VERSION"),
        "runtimeContractVersion": os.environ.get("EXPECTED_RECOMMENDATION_RUNTIME_CONTRACT_VERSION"),
        "decisionLogV1Enabled": os.environ.get("RECOMMENDATION_DECISION_LOG_V1_ENABLED"),
        "semanticReadyMinRatio": float(os.environ.get("EXPECTED_SEMANTIC_READY_MIN_RATIO", "0.99")),
    },
    "mlReadyProbe": ml_probe,
    "opsRecommendationProbe": ops_probe,
    "blockers": blockers,
    "rolloutPlan": {
        "stages": ["10%_canary", "50%_staged", "100%_full"],
        "experimentFlags": [
            "enable_page_rl_exploration=true",
            "page_rl_exploration_epsilon=0.05",
            "dpp_theta=0.65",
            "dpp_sid_lambda=0.35",
            "enable_fair_share_ranking=true",
            "enable_cold_start_thompson_sampling=true",
        ],
        "rollbackCommands": [
            "gcloud run services update-traffic telegram-ml-services --region=us-central1 --to-revisions=telegram-ml-services-00045-mxx=100",
            "Set experiment flag enable_page_rl_exploration=false and RECOMMENDATION_DECISION_LOG_V1_ENABLED=false",
        ],
    },
}
print(json.dumps(report, indent=2, ensure_ascii=False))
if blockers:
    sys.exit(1)
PY
