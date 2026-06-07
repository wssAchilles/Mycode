# Phase 04 - Embedding Contract

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/phoenix
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/phoenix/README.md

## Local paths changed

- `src/models/UserFeatureVector.ts`
- `src/models/PostFeatureSnapshot.ts`
- `src/services/recommendation/contracts/embeddingContract.ts`
- `src/scripts/auditEmbeddingContracts.ts`
- `tests/recommendation/embeddingContract.test.ts`
- `package.json`

## Alignment decisions

- Aligned to Two-Tower and Phoenix artifact separation by making embedding space, dimensions, model version, and artifact version explicit.
- Added compatibility checks that can force ANN/embedding recall to degrade when contracts mismatch.
- Added a read-only audit script instead of mutating existing vectors.

## Known deviations

- Existing stored vectors are not rewritten in this phase.
- Current sources must opt in to the contract helper before mismatch degradation is complete everywhere.

## Follow-up risks

- Run `npm run audit:embedding-contracts -- --limit 5000` to quantify current production drift.
- Backfill contract metadata only after dimension distributions are understood.

## Execution evidence

- Before backfill audit: user vectors were all 24-dimensional, post feature snapshots were all 48-dimensional, and artifactVersion coverage was 0.
- Backfill command updated 73 user vectors and 85 existing post feature snapshots before full news materialization.
- After full news materialization and contract generation, audit sampled 73 user vectors and 918 post feature snapshots:
  - user vector artifactVersion coverage: 1
  - post snapshot artifactVersion coverage: 1
  - incompatible user samples: 0
  - incompatible post samples: 0
