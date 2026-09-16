#!/usr/bin/env bash
# Shared helpers for capability readiness check scripts.
# shellcheck shell=bash

# fetch_ops_json <url> <token>
# Prints raw response body on stdout. Returns non-zero on transport failure.
fetch_ops_json() {
  local url="${1:?ops url is required}"
  local token="${2-}"
  local args=(
    --silent
    --show-error
    --fail
    --max-time "${OPS_READINESS_CURL_TIMEOUT_SECS:-12}"
    -H "x-internal-ops-client: readiness-gate"
    -H "Accept: application/json"
  )
  if [[ -n "${token}" ]]; then
    args+=(-H "x-ops-token: ${token}")
  fi
  curl "${args[@]}" "${url}"
}

# emit_readiness_json <capability> <owner> <blocker> <action> <runtime_mode> <state> [metrics_json]
# Writes the canonical readiness payload to stdout.
emit_readiness_json() {
  local capability="${1:?capability}"
  local owner="${2-}"
  local blocker="${3:-none}"
  local action="${4-}"
  local runtime_mode="${5-}"
  local state="${6:-}"
  local metrics_json="${7:-{}}"

  if [[ -z "${state}" ]]; then
    if [[ "${blocker}" == "none" ]]; then
      state="ready"
    elif [[ "${blocker}" == "waiting_for_traffic" ]]; then
      state="waiting_for_traffic"
    else
      state="blocked"
    fi
  fi

  python3 - "${capability}" "${owner}" "${blocker}" "${action}" "${runtime_mode}" "${state}" "${metrics_json}" <<'PY'
import json
import sys

capability, owner, blocker, action, runtime_mode, state, metrics_raw = sys.argv[1:8]
try:
    metrics = json.loads(metrics_raw) if metrics_raw.strip() else {}
except json.JSONDecodeError:
    metrics = {"rawMetrics": metrics_raw}

payload = {
    "capability": capability,
    "owner": owner or "",
    "currentBlocker": blocker or "none",
    "recommendedAction": action or "",
    "runtimeMode": runtime_mode or "",
    "capabilityMetrics": metrics if isinstance(metrics, dict) else {"value": metrics},
    "readinessState": state,
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
}

# emit_fetch_failure <capability> <url> <detail>
emit_fetch_failure() {
  local capability="${1:?capability}"
  local url="${2-}"
  local detail="${3-ops_fetch_failed}"
  python3 - "${capability}" "${url}" "${detail}" <<'PY'
import json
import sys

capability, url, detail = sys.argv[1:4]
print(json.dumps({
    "capability": capability,
    "owner": "",
    "currentBlocker": "ops_endpoint_unreachable",
    "recommendedAction": "inspect_backend_ops_endpoint_and_network",
    "runtimeMode": "",
    "capabilityMetrics": {"url": url, "error": detail},
    "readinessState": "blocked",
}, indent=2, sort_keys=True))
PY
}

# unwrap_ops_data <raw_json_on_stdin>
# Backend ops routes wrap payload in {success, data}. Prints the inner object.
unwrap_ops_data() {
  python3 -c '
import json
import sys

raw = sys.stdin.read()
try:
    payload = json.loads(raw)
except json.JSONDecodeError as exc:
    print(json.dumps({"__error": f"invalid_json:{exc}"}))
    sys.exit(0)

if isinstance(payload, dict) and "data" in payload and isinstance(payload.get("data"), (dict, list)):
    print(json.dumps(payload["data"]))
elif isinstance(payload, dict):
    print(json.dumps(payload))
else:
    print(json.dumps({"__error": "unexpected_payload_shape"}))
'
}
