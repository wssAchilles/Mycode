#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Backward-compatible wrapper for scripts that still source read_env_value.sh.
# shellcheck source=deploy/vps/lib/env.sh
source "${SCRIPT_DIR}/env.sh"
