#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "================================================================="
echo "🛡️  启动统一多语言契约与 Wire 协议防漂移全自动 CI 阻断门禁"
echo "    对标体系: Google TAP / Uber Schema Registry / Twitter(X)"
echo "================================================================="

echo ""
echo "▶️ [步骤 1/4] 跨语言静态 AST 与 Wire 字段对齐门禁检查..."
node "${SCRIPT_DIR}/check-cross-language-contracts.mjs"

echo ""
echo "▶️ [步骤 2/4] Node.js (TypeScript) 跨语言 Golden Roundtrip 测试..."
(
  cd "${REPO_ROOT}/telegram-clone-backend"
  npm test -- tests/contracts/crossLanguageRoundtrip.test.ts
)

echo ""
echo "▶️ [步骤 3/4] Rust 核心契约 crate 跨语言 Golden 测试与确定性指纹断言..."
(
  cd "${REPO_ROOT}/telegram-rust-workspace"
  cargo test -p telegram-recommendation-contracts --test cross_language_golden_test
)

echo ""
echo "▶️ [步骤 4/4] Go 投递消费端协议信封版本门禁与反序列化测试..."
(
  cd "${REPO_ROOT}/telegram-go-delivery-consumer"
  go test -v ./internal/contracts/...
)

echo ""
echo "================================================================="
echo "🎉 全仓多语言契约防漂移门禁检验 100% 通过！"
echo "   全端 Wire 契约强一致性与确定性指纹已固化，无任何静默漂移。"
echo "================================================================="
