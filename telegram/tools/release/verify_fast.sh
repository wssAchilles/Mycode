#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GRAPH_DIR="$ROOT_DIR/telegram-cpp-graph-service"
CONSUMER_DIR="$ROOT_DIR/telegram-go-delivery-consumer"

cmake --build "$GRAPH_DIR/build" --target graph-store-tests graph-store-bench telegram-cpp-graph-service
ctest --test-dir "$GRAPH_DIR/build" --output-on-failure
"$GRAPH_DIR/build/graph-store-bench" --json >/tmp/graph-store-bench-fast.json

(cd "$CONSUMER_DIR" && go test ./...)
