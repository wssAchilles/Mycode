#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_TARGET="${1:-${VPS_SSH_TARGET:-}}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
RELEASE_ID="${RELEASE_ID:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/wssachilles/mycode-telegram-backend}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-gateway}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
ARCHIVE_NAME="telegram-${RELEASE_ID}.tar.gz"
LOCAL_ARCHIVE="$(mktemp "/tmp/${ARCHIVE_NAME}.XXXXXX")"

if [[ -z "${REMOTE_TARGET}" ]]; then
  echo "usage: $0 <user@host>" >&2
  exit 1
fi

tar -czf "${LOCAL_ARCHIVE}" \
  -C "${ROOT_DIR}" \
  deploy/vps/docker-compose.prod.yml \
  deploy/vps/nginx.telegram.conf.example
scp "${LOCAL_ARCHIVE}" "${REMOTE_TARGET}:${REMOTE_ROOT}/${ARCHIVE_NAME}"
rm -f "${LOCAL_ARCHIVE}"

ssh "${REMOTE_TARGET}" \
  "REMOTE_ROOT='${REMOTE_ROOT}' RELEASE_ID='${RELEASE_ID}' ARCHIVE_NAME='${ARCHIVE_NAME}' BACKEND_IMAGE='${BACKEND_IMAGE}' GATEWAY_IMAGE='${GATEWAY_IMAGE}' GHCR_USERNAME='${GHCR_USERNAME}' GHCR_TOKEN='${GHCR_TOKEN}' bash -s" <<'EOF'
set -euo pipefail

REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
RELEASE_ID="${RELEASE_ID:-}"
ARCHIVE_NAME="${ARCHIVE_NAME:-}"
BACKEND_IMAGE="${BACKEND_IMAGE:-}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:-}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

if [[ -z "${RELEASE_ID}" || -z "${ARCHIVE_NAME}" || -z "${BACKEND_IMAGE}" || -z "${GATEWAY_IMAGE}" ]]; then
  echo "REMOTE_ROOT/RELEASE_ID/ARCHIVE_NAME/BACKEND_IMAGE/GATEWAY_IMAGE must be exported by caller" >&2
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

cat > "${RELEASE_DIR}/deploy/vps/.env" <<ENVVARS
BACKEND_IMAGE=${BACKEND_IMAGE}
GATEWAY_IMAGE=${GATEWAY_IMAGE}
RELEASE_TAG=${RELEASE_ID}
ENVVARS

ln -sfn "${SHARED_DIR}/backend.env" "${RELEASE_DIR}/deploy/vps/backend.env"

if [[ -e "${CURRENT_LINK}" && ! -L "${CURRENT_LINK}" ]]; then
  LEGACY_BACKUP="${REMOTE_ROOT}/current.legacy.$(date +%Y%m%d%H%M%S)"
  mv "${CURRENT_LINK}" "${LEGACY_BACKUP}"
  echo "moved legacy current directory to ${LEGACY_BACKUP}"
fi

ln -sfn "${RELEASE_DIR}" "${TMP_LINK}"
mv -Tf "${TMP_LINK}" "${CURRENT_LINK}"

cd "${CURRENT_LINK}/deploy/vps"

if [[ -n "${GHCR_USERNAME}" && -n "${GHCR_TOKEN}" ]]; then
  printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin >/dev/null
fi

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker image prune -f >/dev/null 2>&1 || true
EOF
