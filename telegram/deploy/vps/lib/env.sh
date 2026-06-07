#!/usr/bin/env bash

normalize_release_tag() {
  local raw_tag="${1:?release tag is required}"
  if [[ "${raw_tag}" =~ ^[0-9a-fA-F]{8,40}$ ]]; then
    printf '%s\n' "${raw_tag:0:7}"
    return
  fi
  printf '%s\n' "${raw_tag}"
}

read_remote_env_value() {
  local remote_target="${1:?remote target is required}"
  local remote_root="${2:-/opt/telegram}"
  local key="${3:?env key is required}"
  ssh "${remote_target}" "REMOTE_ROOT='${remote_root}' KEY='${key}' bash -s" <<'EOF'
set -euo pipefail
env_file="${REMOTE_ROOT}/shared/backend.env"
if [[ ! -f "${env_file}" ]]; then
  exit 0
fi
awk -F= -v key="${KEY}" '
  $1 == key {
    value = substr($0, length(key) + 2)
    gsub(/^"/, "", value)
    gsub(/"$/, "", value)
    print value
    exit
  }
' "${env_file}"
EOF
}
