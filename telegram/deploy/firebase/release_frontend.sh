#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/deploy/firebase/frontend.env.production}"
FIREBASE_PROJECT="${FIREBASE_PROJECT:-telegram-467705}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing frontend env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

cd "${ROOT_DIR}"
npm --prefix telegram-clone-frontend run build
firebase deploy --project "${FIREBASE_PROJECT}" --only hosting
