#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run_preset() {
  local name="$1"
  local preset="$2"

  echo "==> Configuring $name (preset: $preset)"
  cmake --preset "$preset" -S "$ROOT_DIR"

  echo "==> Building $name"
  cmake --build --preset "$preset"

  echo "==> Running $name tests"
  ctest --preset "$preset" --test-dir "$ROOT_DIR"
}

run_preset "ASan + UBSan" "asan-ubsan"

if [[ "${GRAPH_SANITIZER_SKIP_TSAN:-0}" == "1" ]]; then
  echo "Skipping ThreadSanitizer because GRAPH_SANITIZER_SKIP_TSAN=1"
else
  run_preset "TSan + UBSan" "tsan-ubsan"
fi
