#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "$ROOT_DIR/tools/release/verify_cpp.sh"
bash "$ROOT_DIR/tools/release/verify_go.sh"
bash "$ROOT_DIR/tools/release/verify_performance.sh"
