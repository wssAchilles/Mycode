#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(git -C "${PROJECT_DIR}" rev-parse --show-toplevel)"

fail() {
  printf 'workspace migration check failed: %s\n' "$1" >&2
  exit 1
}

require_file() {
  local file="$1"
  [[ -f "${PROJECT_DIR}/${file}" ]] || fail "missing ${file}"
}

require_repo_file() {
  local file="$1"
  [[ -f "${REPO_ROOT}/${file}" ]] || fail "missing repository file ${file}"
}

require_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq -- "${needle}" "${PROJECT_DIR}/${file}" || fail "${file} does not contain ${needle}"
}

require_repo_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq -- "${needle}" "${REPO_ROOT}/${file}" || fail "${file} does not contain ${needle}"
}

require_absent() {
  local path="$1"
  [[ ! -e "${PROJECT_DIR}/${path}" ]] || fail "${path} must not exist after workspace migration"
}

require_file "telegram-rust-workspace/Cargo.toml"
require_file "telegram-rust-workspace/Cargo.lock"
require_file "telegram-rust-workspace/crates/telegram-rust-recommendation/Cargo.toml"
require_file "telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile"
require_file "telegram-rust-workspace/scripts/check-service-boundaries.sh"
require_file "telegram-rust-workspace/scripts/check-recommendation-boundaries.sh"
require_file "telegram-rust-workspace/scripts/quick-gate.sh"
require_file "telegram-rust-workspace/scripts/recommendation-contract-gate.sh"
require_file "deploy/vps/docker-compose.yml"
require_file "deploy/vps/docker-compose.prod.yml"
require_repo_file ".github/workflows/telegram-ghcr-images.yml"
require_absent "telegram-rust-recommendation"

require_contains "telegram-rust-workspace/Cargo.toml" 'members = ["crates/*"]'
require_contains "telegram-rust-workspace/crates/telegram-rust-recommendation/Cargo.toml" "telegram-pipeline-primitives.workspace = true"
require_contains "telegram-rust-workspace/crates/telegram-rust-recommendation/Cargo.toml" "[lints]"
require_contains "telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile" "telegram-rust-workspace/Cargo.toml"
require_contains "telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile" "-p telegram-rust-recommendation"
require_contains "deploy/vps/docker-compose.yml" "telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile"
require_contains "deploy/vps/docker-compose.prod.yml" "RECOMMENDATION_IMAGE"
require_repo_contains ".github/workflows/telegram-ghcr-images.yml" "telegram/telegram-rust-workspace/**"
require_repo_contains ".github/workflows/telegram-ghcr-images.yml" "context: ./telegram"
require_repo_contains ".github/workflows/telegram-ghcr-images.yml" "dockerfile: ./telegram/telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile"

if command -v rg >/dev/null 2>&1; then
  old_path_matches() {
    rg -n '(\.\./telegram-rust-workspace|COPY telegram-rust-recommendation|context:\s*\./telegram-rust-recommendation|dockerfile:\s*(\./)?telegram-rust-recommendation/Dockerfile)' "$@"
  }
else
  old_path_matches() {
    grep -En '(\.\./telegram-rust-workspace|COPY telegram-rust-recommendation|context:[[:space:]]*\./telegram-rust-recommendation|dockerfile:[[:space:]]*(\./)?telegram-rust-recommendation/Dockerfile)' "$@"
  }
fi

if old_path_matches \
  "${PROJECT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/Cargo.toml" \
  "${PROJECT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile" \
  "${PROJECT_DIR}/deploy/vps/docker-compose.yml" \
  "${REPO_ROOT}/.github/workflows/telegram-ghcr-images.yml" >/tmp/telegram_workspace_old_paths.txt; then
  cat /tmp/telegram_workspace_old_paths.txt >&2
  fail "old recommendation paths are still present in active migration surfaces"
fi

if ! git -C "${REPO_ROOT}" diff --quiet -- telegram/ml-services telegram/telegram-light-jobs; then
  git -C "${REPO_ROOT}" diff --name-only -- telegram/ml-services telegram/telegram-light-jobs >&2
  fail "frozen GCP-backed directories have local diffs"
fi

cargo metadata --manifest-path "${PROJECT_DIR}/telegram-rust-workspace/Cargo.toml" --no-deps --format-version 1 >/dev/null
"${PROJECT_DIR}/telegram-rust-workspace/scripts/check-workspace-deps.sh"

printf 'workspace migration check passed\n'
