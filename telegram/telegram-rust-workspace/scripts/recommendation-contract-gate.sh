#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${PROJECT_DIR}/telegram-clone-backend"

"${SCRIPT_DIR}/quick-gate.sh"

(
  cd "${BACKEND_DIR}"
  npm test -- tests/recommendation/runtimeOwnership.test.ts tests/recommendation/adapterScorerSelection.test.ts
  npx tsc --noEmit
)

if ! git -C "${PROJECT_DIR}" diff --quiet -- ml-services telegram-light-jobs; then
  git -C "${PROJECT_DIR}" diff --name-only -- ml-services telegram-light-jobs >&2
  printf 'recommendation contract gate failed: frozen GCP-backed directories have local diffs\n' >&2
  exit 1
fi

printf 'recommendation contract gate passed\n'
