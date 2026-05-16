#!/usr/bin/env bash

read_env_value_from_file() {
  local env_file="${1:-}"
  local env_key="${2:-}"

  if [[ -z "${env_file}" || -z "${env_key}" || ! -f "${env_file}" ]]; then
    return 1
  fi

  awk -v key="${env_key}" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      candidate = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", candidate)
      if (candidate != key) {
        next
      }
      value = substr(line, index(line, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
          (substr(value, 1, 1) == "'"'"'" && substr(value, length(value), 1) == "'"'"'")) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "${env_file}"
}

read_remote_env_value() {
  local remote_target="${1:-}"
  local remote_root="${2:-/opt/telegram}"
  local env_key="${3:-}"

  if [[ -z "${remote_target}" || -z "${env_key}" ]]; then
    return 1
  fi

  ssh "${remote_target}" "REMOTE_ROOT='${remote_root}' ENV_KEY='${env_key}' bash -s" <<'REMOTE'
set -euo pipefail
ENV_FILE="${REMOTE_ROOT}/shared/backend.env"
awk -v key="${ENV_KEY}" '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  {
    line = $0
    sub(/^[[:space:]]*export[[:space:]]+/, "", line)
    split(line, parts, "=")
    candidate = parts[1]
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", candidate)
    if (candidate != key) {
      next
    }
    value = substr(line, index(line, "=") + 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
        (substr(value, 1, 1) == "'"'"'" && substr(value, length(value), 1) == "'"'"'")) {
      value = substr(value, 2, length(value) - 2)
    }
    print value
    found = 1
    exit
  }
  END {
    if (!found) {
      exit 1
    }
  }
' "${ENV_FILE}"
REMOTE
}
