#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/check-workspace-migration.sh"
"${SCRIPT_DIR}/check-change-boundaries.sh"
"${SCRIPT_DIR}/check-service-boundaries.sh"
"${SCRIPT_DIR}/check-recommendation-boundaries.sh"
"${SCRIPT_DIR}/check-node-recommendation-freeze.mjs"

printf 'workspace boundary gate passed\n'
