#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

bash -n "${PROJECT_DIR}/deploy/vps/release_backend.sh"
DRY_RUN=true REMOTE_ROOT=/opt/telegram \
  "${PROJECT_DIR}/deploy/vps/release_backend.sh" dry-run@localhost >/dev/null

printf 'workspace release preflight gate passed\n'
