#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CXX_COMPILER="${CXX:-}"

configure_build() {
  local build_dir="$1"
  local flags="$2"

  local args=(
    -S "$ROOT_DIR"
    -B "$build_dir"
    -DCMAKE_BUILD_TYPE=Debug
    "-DCMAKE_CXX_FLAGS=$flags"
  )
  if [[ -n "$CXX_COMPILER" ]]; then
    args+=("-DCMAKE_CXX_COMPILER=$CXX_COMPILER")
  fi

  cmake "${args[@]}"
}

run_profile() {
  local name="$1"
  local build_dir="$2"
  local flags="$3"

  echo "==> Configuring $name build"
  configure_build "$build_dir" "$flags"

  echo "==> Building $name"
  cmake --build "$build_dir"

  echo "==> Running $name tests"
  ctest --test-dir "$build_dir" --output-on-failure
}

run_profile "AddressSanitizer" "$ROOT_DIR/build-asan" "-fsanitize=address,undefined -fno-omit-frame-pointer"

if [[ "${GRAPH_SANITIZER_SKIP_TSAN:-0}" == "1" ]]; then
  echo "Skipping ThreadSanitizer because GRAPH_SANITIZER_SKIP_TSAN=1"
else
  run_profile "ThreadSanitizer" "$ROOT_DIR/build-tsan" "-fsanitize=thread -fno-omit-frame-pointer"
fi
