#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKSPACE_MANIFEST="${PROJECT_DIR}/telegram-rust-workspace/Cargo.toml"
RECOMMENDATION_DOCKERFILE="${PROJECT_DIR}/telegram-rust-workspace/crates/telegram-rust-recommendation/Dockerfile"

"${SCRIPT_DIR}/quick-gate.sh"

cargo test --manifest-path "${WORKSPACE_MANIFEST}" --workspace
cargo build --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation --release --locked
docker build --check -f "${RECOMMENDATION_DOCKERFILE}" "${PROJECT_DIR}"

printf 'workspace quality gate passed\n'
