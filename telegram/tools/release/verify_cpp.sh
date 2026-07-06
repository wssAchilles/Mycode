#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRAPH_DIR="$ROOT_DIR/telegram-cpp-graph-service"
export GRAPH_BUILD_DIR="${GRAPH_BUILD_DIR:-$GRAPH_DIR/build/release}"

if [[ ! -f "$GRAPH_BUILD_DIR/CMakeCache.txt" ]]; then
  cmake --preset release -S "$GRAPH_DIR"
fi

bash "$GRAPH_DIR/scripts/verify/ci_verify_graph.sh"
GRAPH_SANITIZER_SKIP_TSAN="${GRAPH_SANITIZER_SKIP_TSAN:-1}" bash "$GRAPH_DIR/scripts/verify/run_graph_sanitizers.sh"
