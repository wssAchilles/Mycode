#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONSUMER_DIR="$ROOT_DIR/telegram-go-delivery-consumer"

bash "$CONSUMER_DIR/scripts/verify/go_default.sh"
