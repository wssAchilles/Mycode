#!/usr/bin/env bash

read_remote_current_release() {
  local remote_target="${1:?remote target is required}"
  local remote_root="${2:-/opt/telegram}"
  ssh "${remote_target}" "REMOTE_ROOT='${remote_root}' bash -s" <<'EOF'
set -euo pipefail
if [[ -L "${REMOTE_ROOT}/current" ]]; then
  basename "$(readlink "${REMOTE_ROOT}/current")"
fi
EOF
}

run_remote_compose_ps() {
  local remote_target="${1:?remote target is required}"
  local remote_root="${2:-/opt/telegram}"
  ssh "${remote_target}" "REMOTE_ROOT='${remote_root}' bash -s" <<'EOF'
set -euo pipefail
cd "${REMOTE_ROOT}/current/deploy/vps"
docker compose -f docker-compose.prod.yml ps
EOF
}

run_remote_gateway_health() {
  local remote_target="${1:?remote target is required}"
  ssh "${remote_target}" "curl --silent --show-error --fail --max-time 10 http://127.0.0.1:4000/health"
}
