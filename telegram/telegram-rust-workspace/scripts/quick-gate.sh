#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKSPACE_MANIFEST="${PROJECT_DIR}/telegram-rust-workspace/Cargo.toml"

"${SCRIPT_DIR}/check-workspace-migration.sh"
"${SCRIPT_DIR}/check-service-boundaries.sh"

cargo fmt --manifest-path "${WORKSPACE_MANIFEST}" --all --check
cargo clippy --manifest-path "${WORKSPACE_MANIFEST}" --workspace --all-targets -- -D warnings
cargo test --manifest-path "${WORKSPACE_MANIFEST}" \
  -p telegram-component-primitives \
  -p telegram-filter-primitives \
  -p telegram-pipeline-primitives \
  -p telegram-recommendation-fixtures \
  -p telegram-source-primitives \
  -p telegram-ranking-primitives \
  -p telegram-selector-primitives \
  -p telegram-serving-primitives
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation pipeline::local::scorers
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation pipeline::executor
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation replay

printf 'workspace quick gate passed\n'
