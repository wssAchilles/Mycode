# Phase 11 Task 1: Synthetic trajectory and bounded streaming evidence

Repository: `/Users/achilles/Documents/telegram_code/telegram`

## Goal

Implement the minimum Phase 11A contract surface that closes the reviewed blockers without changing V1 contracts or runtime behavior.

## Ownership

You exclusively own new files under:

- `telegram-clone-backend/src/services/recommendation/offlinePrediction/streamingV2/`
- `telegram-clone-backend/src/services/recommendation/ope/v3/`
- one new focused test file under `telegram-clone-backend/tests/recommendation/`

You may make the smallest required edits to:

- `offlinePrediction/snapshotV2/verify.ts` and `snapshotV2/index.ts` for candidate-base replay
- `offlinePrediction/contracts/artifacts.ts` only for a Phase 11 resource schema/helper

Do not edit any other write surface. Do not commit.

## Required behavior

1. Add a strict synthetic trajectory contract. It must bind:
   - behavior policy/config digest and explicit uniform draws;
   - Rust-selected ordered action identities and conditional probabilities;
   - a synthetic Decision Log whose `actions` exactly equal the Rust-selected trajectory;
   - exact-action verified outcomes;
   - a separate target policy/config digest evaluated on the observed behavior prefix;
   - `evidenceKind: simulated_propensity`, `realDatasetEligible:false`, `servable:false`.
   It must never claim or emit `logged_randomized` and must reject a deterministic Decision Log with probabilities over a different action trajectory.

2. Add a private branded verifier using WeakSet/WeakMap plus recursive freeze and canonical SHA-256. The verifier must validate full action identity, 1-based contiguous positions, without-replacement trajectory, probability/draw ranges, behavior/target digest separation, Decision Log digest/action equality, and verified outcome membership. Do not recompute Rust PL/softmax/selection mathematics.

3. Add a single-step/prefix contribution kernel for streaming OPE V3. It must not call `buildOpeContributionRowsV2` or return cohort arrays. It accepts one validated step at a time, updates prefix log-weight deterministically, and emits one slot contribution. Preserve `mean_reward_per_logged_slot_v1`. Fail closed on prefix/support/probability/qHat/numerical errors.

4. Name the scope honestly: outcome/context V1 remain bounded in-memory evidence. Add limits/high-water diagnostics for decisions, slots, clusters, segment keys, objectives, aggregate-state entries and estimated aggregate-state bytes. Reject limit breaches before returning a verified receipt. Do not call the chain "fully streaming".

5. Add Phase 11 model-state resource validation covering fold x 10 heads x coefficient count, model/gradient bytes, per-fold train/holdout decision and row counts, and empty train/holdout folds. Lock canonical row, fold, head, feature and accumulation order in the contract. Keep all thresholds versioned/config-bound, not universal statistical claims.

6. Encode atomic sink semantics in Phase 11 result contracts:
   - pre-publish failure => final path not visible;
   - post-link durability uncertainty => `published_durability_unconfirmed`, final path may be visible and retry is forbidden.
   Reuse the existing sink; do not modify its implementation unless a focused test proves a bug.

## Tests

Add few hard tests covering:

- simulated probabilities over the original deterministic action are rejected;
- selected synthetic actions, Decision Log actions and outcomes must match exactly;
- behavior and target config digests must differ;
- step kernel preserves prefix cumulative IPS math without cohort arrays;
- aggregate/model-state caps and empty folds fail closed;
- post-publish durability status is represented honestly;
- V1/V2 evidence cannot be passed to V3 brands.

Run the new focused Vitest file and `npx tsc --noEmit`. Do not modify or test `ml-services/**`; do not run `verify_all.sh`.

## Report

Write `.superpowers/sdd/phase11-task-1-report.md` with files changed, tests/commands/results, self-review, and concerns. Return only `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` plus one-line summary.
