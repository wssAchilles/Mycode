#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${APPROVED_EMBEDDING_QUARANTINE_DIGEST:?Set an independently approved quarantine digest}"

if [[ ! "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" =~ ^[0-9a-f]{64}$ ]]; then
  echo "APPROVED_EMBEDDING_QUARANTINE_DIGEST must be lowercase 64-hex" >&2
  exit 64
fi

bash "$ROOT_DIR/tools/release/verify_cpp.sh"
bash "$ROOT_DIR/tools/release/verify_go.sh"
npm --prefix "$ROOT_DIR/telegram-clone-backend" test -- \
  tests/recommendation/userEmbeddingQueryHydrator.test.ts \
  tests/recommendation/registeredUserFeatureBootstrap.test.ts \
  tests/recommendation/embeddingProvenance.test.ts \
  tests/recommendation/newsAnnSource.test.ts \
  tests/recommendation/denseEmbedding.test.ts \
  tests/recommendation/embeddingRetrievalPolicy.test.ts \
  tests/recommendation/embeddingContractEvidence.test.ts \
  tests/config/db.test.ts \
  tests/recommendation/auditMongoAccess.test.ts \
  tests/recommendation/embeddingEvidenceAudit.test.ts \
  tests/recommendation/embeddingRepairArtifacts.test.ts \
  tests/recommendation/embeddingRepairPlannerTransaction.test.ts \
  tests/scripts/auditEmbeddingContracts.test.ts \
  tests/scripts/auditDailyRecommendationRefresh.test.ts \
  tests/recommendation/dailyRefreshOps.test.ts \
  tests/recommendation/dailyRecommendationRefreshJob.test.ts \
  tests/scripts/backfillEmbeddingContracts.test.ts \
  tests/ops/recommendationOpsReadiness.test.ts
cargo test \
  --manifest-path "$ROOT_DIR/telegram-rust-workspace/Cargo.toml" \
  -p telegram-rust-recommendation replay
npm --prefix "$ROOT_DIR/telegram-clone-backend" run audit:embedding-contracts -- \
  --strict \
  --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST"
