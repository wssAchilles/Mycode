#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRAPH_DIR="$ROOT_DIR/telegram-cpp-graph-service"
GRAPH_BUILD_DIR="${GRAPH_BUILD_DIR:-$GRAPH_DIR/build/release}"
CONSUMER_DIR="$ROOT_DIR/telegram-go-delivery-consumer"

if [[ ! -f "$GRAPH_BUILD_DIR/CMakeCache.txt" ]]; then
  cmake --preset release -S "$GRAPH_DIR"
fi

cmake --build "$GRAPH_BUILD_DIR" --target graph-store-tests graph-store-bench telegram-cpp-graph-service
ctest --test-dir "$GRAPH_BUILD_DIR" --output-on-failure
"$GRAPH_BUILD_DIR/graph-store-bench" --json >/tmp/graph-store-bench-fast.json

(cd "$CONSUMER_DIR" && go test ./...)
