#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORKSPACE_MANIFEST="${PROJECT_DIR}/telegram-rust-workspace/Cargo.toml"

"${SCRIPT_DIR}/boundary-gate.sh"
"${SCRIPT_DIR}/check-recommendation-contract-schema.mjs"
"${SCRIPT_DIR}/release-preflight-gate.sh"

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
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation pipeline::local::filters
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation pipeline::local::scorers
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation pipeline::executor
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation sources::orchestrator
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation selectors::top_k
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation serving::dedup
cargo test --manifest-path "${WORKSPACE_MANIFEST}" -p telegram-rust-recommendation serving::stable_order
"${SCRIPT_DIR}/replay-gate.sh"

printf 'workspace quick gate passed\n'
