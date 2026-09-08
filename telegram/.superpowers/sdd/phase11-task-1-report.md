# Phase 11 Task 1 Report

## Result

Phase 11A now has an offline-only, Rust-rooted synthetic trajectory path and a whole-cohort fail-closed OPE V3 receipt. The previously reported exact-prefix target provenance blocker is resolved by the shared Rust behavior fixture plus branded V2 target replay.

## Files changed

- `telegram-clone-backend/src/services/recommendation/offlinePrediction/streamingV2/contracts.ts`
- `telegram-clone-backend/src/services/recommendation/offlinePrediction/streamingV2/trajectory.ts`
- `telegram-clone-backend/src/services/recommendation/offlinePrediction/streamingV2/publish.ts`
- `telegram-clone-backend/src/services/recommendation/offlinePrediction/streamingV2/index.ts`
- `telegram-clone-backend/src/services/recommendation/ope/v3/contracts.ts`
- `telegram-clone-backend/src/services/recommendation/ope/v3/numerics.ts`
- `telegram-clone-backend/src/services/recommendation/ope/v3/kernel.ts`
- `telegram-clone-backend/src/services/recommendation/ope/v3/index.ts`
- `telegram-clone-backend/src/services/recommendation/offlinePrediction/contracts/artifacts.ts`
- `telegram-clone-backend/src/services/recommendation/outcomes/outcomeContractV1.ts`
- `telegram-clone-backend/src/services/recommendation/outcomes/syntheticOutcomeEvidenceV1.ts`
- `telegram-clone-backend/src/services/recommendation/decisionContext/syntheticContextV1.ts`
- `telegram-clone-backend/tests/recommendation/phase11StreamingEvidence.test.ts`
- `.superpowers/sdd/phase11-task-1-report.md`
- `.superpowers/sdd/phase11-task-1-fix-report.md`

The Rust fixture `phase11_synthetic_behavior_trajectory_v1.json` was supplied and verified by the separate Rust owner. This task consumed it but did not edit Rust files. Snapshot V2 did not require modification.

## Implemented boundaries

- The async trajectory verifier accepts only the fixed Rust behavior fixture root and private branded `VerifiedTargetDistributionEvidenceV2` evidence. It transactionally replays the cursor and compares the source decision/candidate pool, selected actions, observed prefixes, support, positions, and probabilities before minting brands.
- The synthetic Decision Log remains offline-only and exposes only `simulated_propensity`; it cannot satisfy the production Decision Log schema or claim `logged_randomized`.
- Synthetic outcomes bind canonical event envelopes directly to the synthetic log and use the same validated attribution core as Outcome V1. Missing exposure, censored windows, conflicting events, invalid attribution, or incomplete action membership fail the whole set.
- Synthetic context binds PIT timestamps, cluster, and canonical key/value segment assignments. Objective comes from the verified reward definition. These immutable bindings are carried in every trajectory step; OPE callers can provide only optional qHat values.
- OPE state creation requires a non-empty verified trajectory cohort. Every consume/finalize failure poisons the state with its first blocker. Finalization requires all expected steps and decisions.
- Contributions form a canonical SHA-256 chain. Receipts bind trajectory, outcome, context, target, resource config, aggregate state, expected/observed counts, and the chain head. Private owner maps reject cross-state contribution/receipt substitution.
- Scalar numerical handling preserves the V2 log bounds and fails closed on weight, IPS contribution, and DR term underflow/overflow without using the V2 cohort row builder.
- The Phase 11 model helper derives coefficients, float64 model/gradient bytes, and train/holdout counts from canonical fold/head/coefficient structures. It enforces safe integers and a total coefficient cap and is explicitly allocation-budget-only; it cannot mint a verified prediction receipt.
- Atomic publish semantics retain pre-publish invisibility and post-link durability uncertainty with retry forbidden after possible visibility.

## Verification

- RED: the expanded Phase 11 test initially failed on the missing synthetic context/outcome/trusted replay surfaces.
- `rtk npx vitest run tests/recommendation/phase11StreamingEvidence.test.ts`: 9 tests passed.
- `rtk npx vitest run tests/recommendation/outcomeContractV1.test.ts`: 27 tests passed.
- `rtk npx tsc --noEmit`: no errors.
- Scoped scans found no `logged_randomized`, `buildOpeContributionRowsV2`, `fullyStreaming: true`, caller-authored target arrays, or self-reported model/gradient byte schemas in the new path.

No command read `.env`, touched or tested `ml-services/**`, ran `verify_all.sh`, modified Rust, staged files, or created a commit.

## Residual limitations

- Outcome/context evidence remains bounded in memory and the receipt says `fullyStreaming: false`.
- The model resource API is not wired to a producer and deliberately returns `canMintVerifiedPredictionReceipt: false`.
- All Phase 11A evidence is synthetic-only, non-servable, and ineligible for real datasets.
- External research was skipped because this change implements the reviewed contract and failure semantics without selecting or changing a statistical estimator or policy algorithm.
