#!/usr/bin/env bash

run_remote_compose_ps() {
  local remote_target="${1:?remote target is required}"
  local remote_root="${2:-/opt/telegram}"
  ssh "${remote_target}" "cd '${remote_root}/current/deploy/vps' && docker compose -f docker-compose.prod.yml ps"
}

run_remote_gateway_health() {
  local remote_target="${1:?remote target is required}"
  ssh "${remote_target}" "curl -fsS http://127.0.0.1:4000/health"
}

read_remote_current_release() {
  local remote_target="${1:?remote target is required}"
  local remote_root="${2:-/opt/telegram}"
  ssh "${remote_target}" "readlink '${remote_root}/current' 2>/dev/null || true"
}
