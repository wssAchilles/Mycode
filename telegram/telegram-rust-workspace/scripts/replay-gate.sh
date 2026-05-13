#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKSPACE_MANIFEST="${PROJECT_DIR}/telegram-rust-workspace/Cargo.toml"

cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-recommendation-fixtures
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation replay

printf 'workspace replay gate passed\n'
