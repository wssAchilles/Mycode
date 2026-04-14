#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_TARGET="${1:-${VPS_SSH_TARGET:-}}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
RELEASE_ID="${RELEASE_ID:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
ARCHIVE_NAME="telegram-${RELEASE_ID}.tar.gz"
LOCAL_ARCHIVE="$(mktemp "/tmp/${ARCHIVE_NAME}.XXXXXX")"

if [[ -z "${REMOTE_TARGET}" ]]; then
  echo "usage: $0 <user@host>" >&2
  exit 1
fi

git -C "${ROOT_DIR}" archive --format=tar.gz --output "${LOCAL_ARCHIVE}" HEAD
scp "${LOCAL_ARCHIVE}" "${REMOTE_TARGET}:${REMOTE_ROOT}/${ARCHIVE_NAME}"
rm -f "${LOCAL_ARCHIVE}"

ssh "${REMOTE_TARGET}" \
  "REMOTE_ROOT='${REMOTE_ROOT}' RELEASE_ID='${RELEASE_ID}' ARCHIVE_NAME='${ARCHIVE_NAME}' bash -s" <<'EOF'
set -euo pipefail

REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
RELEASE_ID="${RELEASE_ID:-}"
ARCHIVE_NAME="${ARCHIVE_NAME:-}"

if [[ -z "${RELEASE_ID}" || -z "${ARCHIVE_NAME}" ]]; then
  echo "REMOTE_ROOT/RELEASE_ID/ARCHIVE_NAME must be exported by caller" >&2
  exit 1
fi

RELEASE_DIR="${REMOTE_ROOT}/releases/${RELEASE_ID}"
SHARED_DIR="${REMOTE_ROOT}/shared"
CURRENT_LINK="${REMOTE_ROOT}/current"
TMP_LINK="${REMOTE_ROOT}/.current-${RELEASE_ID}"
LEGACY_BACKUP=""

mkdir -p "${REMOTE_ROOT}/releases" "${SHARED_DIR}" "${RELEASE_DIR}"
tar -xzf "${REMOTE_ROOT}/${ARCHIVE_NAME}" -C "${RELEASE_DIR}"
rm -f "${REMOTE_ROOT}/${ARCHIVE_NAME}"

if [[ ! -f "${SHARED_DIR}/backend.env" ]]; then
  echo "missing ${SHARED_DIR}/backend.env on remote host" >&2
  exit 1
fi

ln -sfn "${SHARED_DIR}/backend.env" "${RELEASE_DIR}/deploy/vps/backend.env"

if [[ -e "${CURRENT_LINK}" && ! -L "${CURRENT_LINK}" ]]; then
  LEGACY_BACKUP="${REMOTE_ROOT}/current.legacy.$(date +%Y%m%d%H%M%S)"
  mv "${CURRENT_LINK}" "${LEGACY_BACKUP}"
  echo "moved legacy current directory to ${LEGACY_BACKUP}"
fi

ln -sfn "${RELEASE_DIR}" "${TMP_LINK}"
mv -Tf "${TMP_LINK}" "${CURRENT_LINK}"

cd "${CURRENT_LINK}/deploy/vps"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
EOF
