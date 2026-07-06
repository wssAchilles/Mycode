#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "$ROOT_DIR/tools/release/verify_cpp.sh"
bash "$ROOT_DIR/tools/release/verify_go.sh"
bash "$ROOT_DIR/tools/release/verify_performance.sh"
npm --prefix "$ROOT_DIR/telegram-clone-backend" test -- tests/ops/recommendationOpsReadiness.test.ts
npm --prefix "$ROOT_DIR/telegram-clone-backend" run audit:embedding-contracts -- --limit 5000
cargo test --manifest-path "$ROOT_DIR/telegram-rust-workspace/Cargo.toml" -p telegram-rust-recommendation replay
