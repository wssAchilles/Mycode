#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="${ROOT_DIR}/deploy/vps"
REMOTE_TARGET="${1:-${VPS_SSH_TARGET:-}}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
DEFAULT_RELEASE_TAG="$(git -C "${ROOT_DIR}" rev-parse --short=7 HEAD)"
RELEASE_ID="${RELEASE_ID:-${DEFAULT_RELEASE_TAG}}"
RELEASE_TAG="${RELEASE_TAG:-}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/wssachilles/mycode-telegram-backend}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-gateway}"
DELIVERY_CONSUMER_IMAGE="${DELIVERY_CONSUMER_IMAGE:-ghcr.io/wssachilles/mycode-telegram-go-delivery-consumer}"
RECOMMENDATION_IMAGE="${RECOMMENDATION_IMAGE:-ghcr.io/wssachilles/mycode-telegram-rust-recommendation}"
GRAPH_KERNEL_IMAGE="${GRAPH_KERNEL_IMAGE:-ghcr.io/wssachilles/mycode-telegram-cpp-graph-service}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
DRY_RUN="${DRY_RUN:-false}"
CHECK_IMAGE_MANIFESTS="${CHECK_IMAGE_MANIFESTS:-false}"
RUN_PRE_DEPLOY_GATE="${RUN_PRE_DEPLOY_GATE:-false}"
RUN_POST_DEPLOY_GATE="${RUN_POST_DEPLOY_GATE:-false}"
ARCHIVE_NAME="telegram-${RELEASE_ID}.tar.gz"

if [[ -z "${RELEASE_TAG}" ]]; then
  RELEASE_TAG="${RELEASE_ID}"
  if [[ "${RELEASE_TAG}" =~ ^[0-9a-fA-F]{8,40}$ ]]; then
    RELEASE_TAG="${RELEASE_TAG:0:7}"
  fi
fi

if [[ -z "${REMOTE_TARGET}" ]]; then
  echo "usage: $0 <user@host>" >&2
  exit 1
fi

IMAGE_REFS=(
  "${BACKEND_IMAGE}:${RELEASE_TAG}"
  "${GATEWAY_IMAGE}:${RELEASE_TAG}"
  "${DELIVERY_CONSUMER_IMAGE}:${RELEASE_TAG}"
  "${RECOMMENDATION_IMAGE}:${RELEASE_TAG}"
  "${GRAPH_KERNEL_IMAGE}:${RELEASE_TAG}"
)

echo "release plan:" >&2
echo "  target=${REMOTE_TARGET}" >&2
echo "  remoteRoot=${REMOTE_ROOT}" >&2
echo "  releaseId=${RELEASE_ID}" >&2
echo "  releaseTag=${RELEASE_TAG}" >&2
echo "  archive=${ARCHIVE_NAME}" >&2
echo "  images:" >&2
for image_ref in "${IMAGE_REFS[@]}"; do
  echo "    - ${image_ref}" >&2
done

if [[ "${RUN_PRE_DEPLOY_GATE}" == "true" ]]; then
  CHECK_IMAGE_MANIFESTS="${PRE_DEPLOY_CHECK_IMAGE_MANIFESTS:-true}" \
    CHECK_REMOTE_RUNTIME="${PRE_DEPLOY_CHECK_REMOTE_RUNTIME:-true}" \
    RUN_OPS_CHECKS=false \
    RELEASE_TAG="${RELEASE_TAG}" \
    RELEASE_GATE_REPORT_PATH="${RELEASE_GATE_PRE_REPORT_PATH:-${ROOT_DIR}/deploy-reports/${RELEASE_TAG}/pre-release-gate.json}" \
    "${SCRIPT_DIR}/release_gate.sh" "${REMOTE_TARGET}"
fi

if [[ "${CHECK_IMAGE_MANIFESTS}" == "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required when CHECK_IMAGE_MANIFESTS=true" >&2
    exit 1
  fi
  for image_ref in "${IMAGE_REFS[@]}"; do
    echo "checking GHCR image manifest ${image_ref}" >&2
    docker manifest inspect "${image_ref}" >/dev/null
  done
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "dry run complete; no archive copied and no remote command executed" >&2
  exit 0
fi

LOCAL_ARCHIVE="$(mktemp "/tmp/${ARCHIVE_NAME}.XXXXXX")"

tar -czf "${LOCAL_ARCHIVE}" \
  -C "${ROOT_DIR}" \
  deploy/vps/docker-compose.prod.yml \
  deploy/vps/nginx.telegram.conf.example
scp "${LOCAL_ARCHIVE}" "${REMOTE_TARGET}:${REMOTE_ROOT}/${ARCHIVE_NAME}"
rm -f "${LOCAL_ARCHIVE}"

ssh "${REMOTE_TARGET}" \
  "REMOTE_ROOT='${REMOTE_ROOT}' RELEASE_ID='${RELEASE_ID}' RELEASE_TAG='${RELEASE_TAG}' ARCHIVE_NAME='${ARCHIVE_NAME}' BACKEND_IMAGE='${BACKEND_IMAGE}' GATEWAY_IMAGE='${GATEWAY_IMAGE}' DELIVERY_CONSUMER_IMAGE='${DELIVERY_CONSUMER_IMAGE}' RECOMMENDATION_IMAGE='${RECOMMENDATION_IMAGE}' GRAPH_KERNEL_IMAGE='${GRAPH_KERNEL_IMAGE}' GHCR_USERNAME='${GHCR_USERNAME}' GHCR_TOKEN='${GHCR_TOKEN}' bash -s" <<'EOF'
set -euo pipefail

REMOTE_ROOT="${REMOTE_ROOT:-/opt/telegram}"
RELEASE_ID="${RELEASE_ID:-}"
RELEASE_TAG="${RELEASE_TAG:-}"
ARCHIVE_NAME="${ARCHIVE_NAME:-}"
BACKEND_IMAGE="${BACKEND_IMAGE:-}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:-}"
DELIVERY_CONSUMER_IMAGE="${DELIVERY_CONSUMER_IMAGE:-}"
RECOMMENDATION_IMAGE="${RECOMMENDATION_IMAGE:-}"
GRAPH_KERNEL_IMAGE="${GRAPH_KERNEL_IMAGE:-}"
GHCR_USERNAME="${GHCR_USERNAME:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

if [[ -z "${RELEASE_ID}" || -z "${RELEASE_TAG}" || -z "${ARCHIVE_NAME}" || -z "${BACKEND_IMAGE}" || -z "${GATEWAY_IMAGE}" || -z "${DELIVERY_CONSUMER_IMAGE}" || -z "${RECOMMENDATION_IMAGE}" || -z "${GRAPH_KERNEL_IMAGE}" ]]; then
  echo "REMOTE_ROOT/RELEASE_ID/RELEASE_TAG/ARCHIVE_NAME/BACKEND_IMAGE/GATEWAY_IMAGE/DELIVERY_CONSUMER_IMAGE/RECOMMENDATION_IMAGE/GRAPH_KERNEL_IMAGE must be exported by caller" >&2
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
DELIVERY_CONSUMER_IMAGE=${DELIVERY_CONSUMER_IMAGE}
RECOMMENDATION_IMAGE=${RECOMMENDATION_IMAGE}
GRAPH_KERNEL_IMAGE=${GRAPH_KERNEL_IMAGE}
RELEASE_TAG=${RELEASE_TAG}
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

if [[ "${RUN_POST_DEPLOY_GATE}" == "true" ]]; then
  if ! CHECK_IMAGE_MANIFESTS=false \
    RELEASE_TAG="${RELEASE_TAG}" \
    OPS_BASE_URL="${OPS_BASE_URL:-https://api.xuziqi.tech}" \
    RELEASE_GATE_REPORT_PATH="${RELEASE_GATE_POST_REPORT_PATH:-${ROOT_DIR}/deploy-reports/${RELEASE_TAG}/release-gate.json}" \
    "${SCRIPT_DIR}/release_gate.sh" "${REMOTE_TARGET}"; then
    echo "post-deploy gate failed; inspect ${RELEASE_GATE_POST_REPORT_PATH:-${ROOT_DIR}/deploy-reports/${RELEASE_TAG}/release-gate.json}" >&2
    echo "manual rollback hint: ssh ${REMOTE_TARGET} 'ls -1dt ${REMOTE_ROOT}/releases/* | sed -n \"1,5p\"'" >&2
    exit 1
  fi
fi
