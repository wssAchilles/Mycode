# 2026-07-13 Recommendation Embedding Contract Remediation Design

## Superpowers Workflow Status

- Workflow: `superpowers:brainstorming`.
- Approved direction: per-vector contracts, verified metadata repair, and non-destructive quarantine for mixed-lineage vectors.
- Parallel verification completed before this design:
  - User-vector lineage verifier.
  - Post-vector lineage verifier.
  - Code-consistency reviewer.
  - `agent-reach` research verifier.
  - Superpowers scope reviewer.
- Next workflow step after user review: `superpowers:writing-plans`.
- This document is a design specification. It does not authorize implementation, MongoDB mutation, cache deletion, scheduler changes, canary rollout, or production rollout.

## Decision

Use a Phase 0.5 remediation before the existing cross-runtime golden-contract phase:

1. Store a distinct contract for each stored dense user vector.
2. Stop sparse SimClusters updates from relabeling dense vectors.
3. Repair metadata only when the stored vector can be reproduced exactly from the persisted inputs required by the replayed producer contract.
4. Preserve the four mixed-lineage `serving-lite` Two-Tower vectors and quarantine them until an authoritative model and index manifest proves their contract.
5. Keep Python code read-only.
6. Require a separate explicit authorization before applying any MongoDB mutation.

Blindly setting `semantic: true`, accepting a contract based only on vector dimension, or overwriting the four `serving-lite` vectors is rejected.

## Scope

Phase 0.5 covers the smallest set of changes required to make the existing release gate truthful:

- Node/TypeScript embedding contract definitions.
- Mongo `UserFeatureVector` per-vector producer-contract fields.
- Cold-start vector creation and repair behavior.
- SimClusters sparse-update behavior.
- User embedding hydration, semantic export eligibility, and Two-Tower eligibility.
- Daily refresh ops and strict embedding audit classification.
- The existing `telegram-clone-backend/src/scripts/backfillEmbeddingContracts.ts` CLI with dry-run and explicit apply modes.
- Cache invalidation and restart requirements for an approved apply operation.
- A shared dense-cosine dimension guard so unequal vector lengths cannot be partially compared.

Python ML code, model training, FAISS rebuilds, new ANN generations, Rust ranking behavior, frontend behavior, Go delivery behavior, and C++ graph behavior are not modified in this phase. The per-vector sidecars are Mongo/Node migration fields and must not be added to Rust, frontend, Go, or C++ contracts in Phase 0.5.

## Verified Current State

### User Vectors

Read-only MongoDB and PostgreSQL replay established:

- 646 `user_feature_vectors` documents exist.
- 646 matching PostgreSQL users were read using `id`, `username`, `region`, and `language`.
- 642 documents use `registered_user_cold_start_v1` / `cold_start_registered_user`.
  - `twoTowerEmbedding` exactly matches the current deterministic cold-start generator.
  - `phoenixEmbedding` exactly matches the same generator.
- 4 documents use `2026-04-29_kuai_lite256` / `serving-lite`.
  - `phoenixEmbedding` exactly matches the deterministic cold-start generator.
  - `twoTowerEmbedding` does not match the cold-start generator.

The equality check was element-by-element `===` after replaying the current SHA-256 based generator. This establishes bit-for-bit consistency with the current deterministic cold-start implementation for the persisted replay inputs. It does not, by itself, prove the historical producer execution or artifact identity, semantic retrieval quality, or compatibility with an ANN item tower.

### Post Vectors

Read-only replay established:

- 1,917 `PostFeatureSnapshot` records have a dense vector.
- All 1,917 vectors reproduce bit-for-bit from fields persisted in the snapshot and the current `buildDensePostEmbedding` implementation.
- 1,832 records carry the pre-contract-split identity.
- 85 records carry a generic dimension-derived backfill identity.

These records are replay-verified candidates for metadata-only repair to `HEURISTIC_POST_HASH_EMBEDDING_CONTRACT`. The repaired contract states consistency with that deterministic contract; it does not claim a recorded historical execution. The contract remains `semantic: false`.

## Root Causes

### One Contract Describes Two Different Vectors

`UserFeatureVector` stores `twoTowerEmbedding` and `phoenixEmbedding` but only one `embeddingContract`. The four `serving-lite` records prove these fields can have different producers.

### Sparse Updates Relabel Dense Vectors

`UserFeatureVector.upsertEmbedding()` writes `DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT` whenever the caller omits a contract. `SimClustersService.computeAndStoreEmbedding()` updates only sparse cluster fields, so a sparse refresh can relabel unchanged dense vectors as semantic Two-Tower output.

### Cold-Start Hashes Use The Remote Semantic Contract

`RegisteredUserFeatureBootstrapService` generates deterministic profile hashes but writes the default semantic recommendation contract. A local fallback representation is not evidence of compatibility with the remote Two-Tower corpus.

### Dense Repair Can Destroy Valid Vectors

`repairDenseVectors()` treats a shared-contract mismatch as vector corruption and can replace both dense vectors. This can overwrite the four `serving-lite` Two-Tower vectors even though only their producer contract is unresolved.

### Audit And Daily Ops Use Different Definitions

The strict audit checks more fields than daily refresh ops. Daily ops can report compatible coverage while strict audit blocks. Both control planes need one shared producer-contract evidence classifier.

### Cache Invalidation Is Incomplete

Mongo repair does not invalidate `fcs:emb:*` L1/L2 entries. SimClusters invalidates only its `sc:embed:*` namespace. A successful metadata repair can therefore remain invisible to serving processes for hours.

## Contract Model

Keep the existing `EmbeddingContract` type. Add per-vector sidecar contracts to `UserFeatureVector`:

```ts
twoTowerEmbedding?: number[];
twoTowerEmbeddingContract?: EmbeddingContract;
twoTowerEmbeddingQuarantineReason?: string;

phoenixEmbedding?: number[];
phoenixEmbeddingContract?: EmbeddingContract;
```

The existing shared `embeddingContract` remains a temporary legacy-read field during migration. New writes must not create or update it.

This is intentionally not a nested vector-object rewrite. The sidecars are the smallest compatible schema change and preserve existing vector storage and API shapes.

### Known Contracts

The contract module must distinguish:

- `DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT`: the existing ANN eligibility sentinel. Its current heuristic model/artifact identifiers are not an authoritative remote runtime or corpus manifest. It remains temporarily named this way to avoid unrelated cross-runtime churn.
- `REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT`: deterministic local profile hash, 256 dimensions, `semantic: false`, with the current cold-start model and artifact identifiers.
- `HEURISTIC_POST_HASH_EMBEDDING_CONTRACT`: deterministic local post hash, 48 dimensions, `semantic: false`.

The default semantic sentinel must never be used as an implicit fallback in a model update method, and matching it alone must not produce `semantic_ready`.

The remote ANN runtime/corpus manifest is a separate concern from stored user-vector producer-contract evidence. Phase 0.5 must not claim ANN readiness from Mongo metadata.

## Producer-Contract Evidence Classification

Use one pure persisted-state classifier in strict audit and daily ops. It accepts the vector, its per-vector metadata, and optional replay evidence that was computed by the caller. The classifier does not access MongoDB or PostgreSQL. The repair CLI is responsible for producing deterministic replay evidence; daily ops may classify stored state but must not invent replay evidence.

A known per-vector local contract is persistent trusted evidence only when it was written atomically by the local generator or by the replay-verified apply path, and the stored vector still satisfies that contract structurally. Daily ops may classify that state as `verified_local_fallback`. A legacy shared contract is never trusted this way. Strict audit may add fresh replay evidence without changing the classification vocabulary.

Each vector is classified independently as one of:

- `verified_local_fallback`: exact replay verifies consistency with a known deterministic local producer contract, or a structurally matching known per-vector local contract was written by an approved generator/apply path; separately recorded lineage metadata may identify a historical producer execution.
- `semantic_ready`: an authoritative semantic artifact contract proves eligibility.
- `quarantined`: the vector is preserved but cannot be assigned a verified contract.
- `invalid`: contract and vector disagree, required data is absent, or deterministic replay fails.
- `unclassified`: no supported rule applies.

Classification rules:

1. A matching dimension is necessary but never sufficient.
2. A record-level `modelVersion` or `modelProfile` is a hint, not proof.
3. Deterministic replay may repair metadata only to the producer contract whose exact implementation-and-input tuple reproduced the vector. It must not be presented as proof of the historical producer execution.
4. A quarantined vector must not be exported or used to claim semantic ANN eligibility.
5. Legacy shared contracts are read only for migration classification; they are not copied blindly into per-vector fields.

## Writer And Consumer Behavior

### Sparse SimClusters Updates

`upsertEmbedding()` must preserve all dense vector and contract fields unless the caller explicitly supplies a dense vector update. A Node dense-vector update without its matching per-vector contract must fail validation.

### Cold-Start Bootstrap

New cold-start users receive the deterministic vector in both dense fields and the cold-start contract in both per-vector contract fields. The vectors remain local fallbacks and are not semantic-export eligible.

### Dense Repair

Dense repair may fill a missing vector or replace a structurally invalid vector only when the target slot is already known to be cold-start. It must not replace a non-empty vector merely because its contract is missing, legacy, or quarantined.

The four `serving-lite` Two-Tower vectors are preserved. Their Phoenix vectors receive the verified cold-start contract. Their Two-Tower contracts remain unset and carry a fixed quarantine reason.

### Hydration And Two-Tower Eligibility

User hydration maps `twoTowerEmbeddingContract` into the existing query-facing `embeddingContract` field. During legacy migration it may use the shared field only through the producer-contract evidence classifier. The current default sentinel cannot make a legacy record `semantic_ready` without an independent authoritative runtime/corpus manifest.

`TwoTowerSource` remains fail-closed: local cold-start and quarantined vectors do not satisfy the remote semantic requirement. Phase 0.5 does not promote the ANN source.

### Feature Export

User export reads only `twoTowerEmbeddingContract`. A cold-start or quarantined vector is excluded. Post export continues excluding `semantic: false` heuristic post hashes.

### Dense Similarity

The shared cosine helper must return zero when vector lengths differ. It must not compare only the shorter prefix. This is a structural guard, not a substitute for producer-contract validation.

## Verified Repair Flow

Reuse `telegram-clone-backend/src/scripts/backfillEmbeddingContracts.ts`. Do not add a second migration framework.

### Dry-Run

Dry-run is the default and performs only reads and local computation. Dry-run, strict audit, and apply authorization evidence use stable-cursor full-collection scans. `--limit` remains available only for non-authoritative diagnostics and cannot be combined with `--strict` or `--apply`.

Dry-run reports:

- documents scanned by cohort;
- per-vector classification counts;
- exact replay match and mismatch counts;
- proposed field-level metadata changes;
- vector checksums before the proposed change;
- the aggregate identity digest of the four approved quarantine records;
- cache keys that would require invalidation;
- records that would remain invalid or unclassified.

Dry-run must not call `save`, `update`, `bulkWrite`, cache deletion, scheduler control, or service restart. Only an explicit `--apply` flag may enter a write path.

The quarantine digest is canonical:

1. Compute each Two-Tower vector checksum as SHA-256 over its length followed by IEEE-754 big-endian float64 values.
2. Build one UTF-8 row per record from `userId`, vector checksum, and the fixed quarantine reason separated by NUL bytes.
3. Sort rows lexicographically by `userId`.
4. SHA-256 the newline-joined rows.

### Apply Authorization Gate

After implementation tests and dry-run pass, the operator must present:

- exact cohort counts;
- the approved quarantine count and aggregate identity digest;
- proposed Mongo field changes;
- proof that vector arrays are unchanged;
- backup and rollback commands;
- proof that the clobber fix is deployed to every Node writer;
- scheduler/manual-job pause steps for Node daily refresh, Node export, and the existing Python feature refresh writer;
- cache invalidation and Node refresh steps;
- the failure-triggered rollback operation that is authorized with the apply.

The production-operation authorization must explicitly cover writer pauses, MongoDB apply, failure-triggered rollback, cache deletion, and Node process refresh. It does not authorize restoring the existing Python feature refresh writer.

### Apply

Before an authorized apply operation:

1. Deploy the Node clobber fixes to every writer and verify that no old Node instance can update `UserFeatureVector`.
2. Pause scheduled and manual Node daily refresh and export jobs.
3. Pause the existing Python feature refresh writer without modifying Python source.
4. Re-run the full read-only dry-run and verify the approved cohort and quarantine digest.

The apply operation then:

1. Updates only per-vector contract and quarantine metadata.
2. Updates a post contract only after exact deterministic replay succeeds.
3. Does not change any vector array.
4. Leaves any mismatch untouched and exits nonzero.
5. Uses bounded unordered `bulkWrite` batches over a stable full-collection cursor.
6. Records cohort counts and before/after vector checksums.

The Node refresh/export jobs may be restored after post-checks. The existing Python feature refresh writer remains disabled after Phase 0.5 because it writes `twoTowerEmbedding` without a per-vector contract. Restoring it requires a separate design and authorization for an atomic vector-plus-contract write path; no Python source or test file is modified here.

### Cache And Process Refresh

After an authorized apply:

1. Delete the affected `fcs:emb:*` and `sc:embed:*` Redis keys.
2. Roll Node serving processes, or wait longer than the configured L1 TTL after Redis deletion before post-checks. The current L1 TTL is 60 seconds.
3. Re-run the full read-only strict audit.
4. Restore only the Node refresh/export jobs after the audit passes. Do not restore the Python feature refresh writer in this phase.

These are production operations and require the same explicit authorization as the Mongo apply.

## Release Gate Semantics

The strict audit uses a stable-cursor full-collection scan. A limited diagnostic scan cannot satisfy the release gate.

The storage producer-contract evidence gate passes only when:

- `invalid = 0`;
- `unclassified = 0`;
- `incompatible_unquarantined = 0`;
- every non-empty dense vector has either a verified per-vector contract or an approved quarantine reason;
- every repaired post vector exactly replays to the heuristic post hash contract;
- the quarantine count remains 4 and its aggregate identity digest matches the approved dry-run digest;
- quarantined vectors are excluded from export and semantic ANN eligibility.

The audit must report local fallback, semantic-ready, quarantined, invalid, and unclassified counts separately.

Passing this gate proves producer-contract evidence coverage, replay consistency for replay-verified cohorts, and quarantine enforcement. It does not prove historical producer execution or artifact lineage, ANN index compatibility, model quality, recall@K, latency, semantic equivalence, or production canary readiness.

## Error Handling And Rollback

- Any deterministic replay mismatch stops the affected repair batch and leaves the record unchanged.
- Any quarantine count or identity-digest change fails strict audit.
- Any dense vector checksum change during metadata-only apply fails post-check and triggers rollback.
- Rollback restores the pre-apply metadata backup, invalidates both cache namespaces, and rolls Node processes again.
- The legacy shared contract remains available during the compatibility window but must not be used as a semantic fallback.
- Removing the legacy shared field is outside Phase 0.5 and requires a later design.

## High-Value Tests

Keep tests few and contract-focused:

1. A sparse SimClusters update preserves both dense vectors and per-vector contracts.
2. Dense repair does not overwrite a mixed-lineage `serving-lite` Two-Tower vector.
3. Cold-start creation writes `semantic: false` per-vector contracts and is excluded from semantic export and ANN eligibility.
4. Post repair changes metadata only when full deterministic replay is bit-for-bit equal.
5. Strict audit accepts the approved four-record quarantine cohort and fails on any added, removed, or changed cohort identity.
6. Daily ops and strict audit classify the same sample set identically.
7. Unequal dense-vector lengths produce zero similarity.
8. The CLI defaults to dry-run, performs no write or operational side effect without `--apply`, and rejects limited scans in strict/apply modes.

No Python test, formatter, generator, or endpoint verification command is part of this phase.

## Acceptance Criteria

### Code And Dry-Run Ready

The code package is ready for production-operation authorization only when:

- new sparse updates cannot relabel dense vectors;
- audit and daily ops use the same classifier;
- the CLI defaults to a side-effect-free full dry-run and requires explicit `--apply`;
- limited scans cannot be used as strict/apply evidence;
- the dry-run identifies the replay-verified baseline cohorts, currently 642 cold-start users and 1,917 post snapshots, plus any newer records;
- the four mixed-lineage records retain their Two-Tower arrays and are excluded from semantic consumers in code paths;
- Python source and tests remain unchanged.

Reaching this state does not authorize or require MongoDB mutation.

### Authorized Apply Complete

After separate production-operation authorization:

- every live user dense vector has its own verified contract or explicit quarantine state;
- the replay-verified cold-start baseline is represented as local non-semantic vectors;
- replay-verified post vectors carry the heuristic post contract;
- the four approved mixed-lineage records retain their Two-Tower arrays and match the approved quarantine digest;
- dry-run and post-check prove zero vector-array mutation;
- cache invalidation and Node refresh complete;
- the Python feature refresh writer remains disabled.

### Phase 0.5 Gate Complete

Phase 0.5 is complete only when:

- strict storage producer-contract evidence audit passes after an authorized apply;
- the full release script advances past the embedding audit without masking any other Phase 0 blocker;
- the original Phase 0 entry conditions and the Phase 0.5 storage producer-contract evidence gate both pass before Phase 1 starts;
- Python remains unchanged.

## Non-Goals

- Do not set missing `semantic` fields to `true`.
- Do not infer a producer contract from dimension alone.
- Do not run the current writable backfill unchanged.
- Do not trigger the current daily refresh before the clobber paths are fixed.
- Do not overwrite the four `serving-lite` Two-Tower vectors.
- Do not change Python ML code or tests.
- Do not rebuild FAISS or promote ANN.
- Do not introduce a new vector database, feature store, migration service, or dependency.
- Do not implement backward-compatible representation learning.
- Do not start the existing cross-runtime golden-contract phase until Phase 0.5 passes its own gate.

## Industry And Research Evidence

- Azure recommends the same embedding model for manual query/index vectorization and requires paired integrated index/query vectorizers to target the same model. Matching dimensions alone does not establish a shared embedding space:
  - https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query
  - https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-configure-vectorizer
- Qdrant named vectors allow independently configured vector spaces on one point. Its migration guide recommends dual writes and background re-embedding, while collection-alias changes are atomic:
  - https://qdrant.tech/documentation/concepts/vectors/
  - https://qdrant.tech/documentation/tutorials-operations/embedding-model-migration/
  - https://qdrant.tech/documentation/manage-data/collections/#collection-aliases
- Weaviate collection aliases support atomic, zero-downtime cutover and quick rollback while the previous collection is retained:
  - https://docs.weaviate.io/weaviate/manage-collections/collection-aliases
- W3C PROV models entities and the activities that use or generate them. MLMD records artifacts, executions, and input/output events for lineage. A guessed contract label alone is not full provenance:
  - https://www.w3.org/TR/prov-primer/
  - https://www.tensorflow.org/tfx/guide/mlmd
- Backward-compatible representation papers require explicit training and cross-generation evaluation. BCT and AdvBCT train the new representation against old-model information; FCT requires side-information prepared during the old-model stage. They do not justify metadata relabeling of existing independent models:
  - BCT, CVPR 2020: https://openaccess.thecvf.com/content_CVPR_2020/html/Shen_Towards_Backward-Compatible_Representation_Learning_CVPR_2020_paper.html
  - FCT, CVPR 2022: https://openaccess.thecvf.com/content/CVPR2022/html/Ramanujan_Forward_Compatible_Training_for_Large-Scale_Embedding_Retrieval_Systems_CVPR_2022_paper.html
  - AdvBCT, CVPR 2023: https://openaccess.thecvf.com/content/CVPR2023/html/Pan_Boundary-Aware_Backward-Compatible_Representation_via_Adversarial_Learning_in_Image_Retrieval_CVPR_2023_paper.html

These sources support the design principles. They do not prove this repository's live data state; the repository-specific claims above come from read-only deterministic replay and code inspection.

## Implementation Handoff

After the user reviews and approves this written specification:

1. Invoke `superpowers:writing-plans`.
2. Add Phase 0.5 as an additional logical-AND prerequisite in the master coordination plan without rewriting completed Phase 0 history or replacing its existing blockers.
3. Write one focused implementation plan for code, deterministic dry-run, and the later separately authorized apply operation.
4. Run the required code, research, and plan-review agent gate again before implementation.
5. Use `superpowers:subagent-driven-development` task by task.
6. Use `superpowers:verification-before-completion` before claiming Phase 0.5 complete.
