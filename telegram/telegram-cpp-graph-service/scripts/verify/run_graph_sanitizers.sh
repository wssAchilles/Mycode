#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run_preset() {
  local name="$1"
  local preset="$2"

  echo "==> Configuring $name (preset: $preset)"
  cmake --preset "$preset" -S "$ROOT_DIR"

  echo "==> Building $name"
  (cd "$ROOT_DIR" && cmake --build --preset "$preset")

  echo "==> Running $name tests"
  (cd "$ROOT_DIR" && ctest --preset "$preset")
}

run_preset "ASan + UBSan" "asan"

if [[ "${GRAPH_SANITIZER_SKIP_TSAN:-0}" == "1" ]]; then
  echo "Skipping ThreadSanitizer because GRAPH_SANITIZER_SKIP_TSAN=1"
else
  run_preset "TSan + UBSan" "tsan"
fi
