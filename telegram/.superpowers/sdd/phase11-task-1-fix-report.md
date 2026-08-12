# Phase 11 Task 1 Fix Report

## Review closure

### Rust behavior and target provenance

Closed. `verifySyntheticTrajectoryEvidenceV1` is async and no longer accepts caller-authored target policy or step arrays. A private behavior trust root fixes the full fixture, input, simulation object, simulation self-digest, source decision, candidate pool, behavior config, and target config digests. Target evidence must carry the private V2 brand and pass transactional replay on the exact Rust-selected prefix before any trajectory brand is minted.

Regression coverage includes plain/self-authored target rejection, fixed-root behavior tampering, exact-prefix positive replay, and replay-time prefix drift.

### Synthetic-native outcome attribution

Closed. The deterministic TopK disguise was removed. `syntheticOutcomeEvidenceV1.ts` binds the standalone synthetic log and canonical event envelopes, then invokes the shared validated core extracted from `attributeOutcomeV1`. Whole-set verification rejects event digest/identity conflicts, missing exposures, censored windows, invalid attribution, and non-finite rewards. The evidence never maps simulated propensity to a production policy kind.

### Verified cluster, objective, and segments

Closed. `syntheticContextV1.ts` creates a private PIT-safe context brand with canonical key/value segment assignments. Trajectory steps freeze the context root, outcome root, cluster, objective, and assignments. `consumeOpeStepContributionV3` no longer accepts these values from callers; its raw context is limited to optional qHat.

### Whole-cohort terminal state and receipt integrity

Closed. State creation binds a non-empty verified trajectory cohort and expected decision/slot counts. Any recognized consume or incomplete-finalize error records the first terminal blocker. Later consume/finalize calls return that blocker. Final receipts require exact completion and bind all evidence roots, a canonical contribution hash chain, aggregate digest, resource config, and counts. Private contribution/receipt owner maps reject cross-state substitution.

Regression coverage includes empty state, missing step, valid-then-invalid-finalize, poison persistence, context/cross-cohort substitution, and cross-state contribution/receipt pairing.

### Numerical underflow and overflow

Closed. `ope/v3/numerics.ts` carries the V2 scalar `LOG_MIN`/`LOG_MAX` and log-scaled contribution behavior. The kernel rejects importance-weight underflow/overflow, non-zero IPS contribution underflow/overflow, and DR target/residual underflow/overflow with stable blockers. It does not call the V2 array row builder.

Regression coverage includes scalar contribution underflow and kernel DR target underflow. Full qHat membership remains keyed by the complete canonical action key including served position.

### Model-state resource gate

Closed as an allocation budget tracker. Self-reported `modelBytes`, `gradientBytes`, and coefficient counts were removed. The tracker parses actual canonical fold/head/coefficient structures, derives train/holdout counts, coefficient count, scalar count, and float64 model/gradient bytes, and enforces per-head plus total caps with safe integers. Fixed orders and numeric storage are included in the resource-config digest.

Because no producer owns this surface yet, success is named `within_budget`, carries `role: allocation_budget_only`, and fixes `canMintVerifiedPredictionReceipt: false`; it cannot issue a misleading verified artifact.

### Atomic publish status

Confirmed unchanged and conforming. Pre-publish failure reports the final path not visible and permits retry. Post-link durability uncertainty reports possible visibility and forbids retry.

## Commands and results

- `rtk npx vitest run tests/recommendation/phase11StreamingEvidence.test.ts`: passed 9/9.
- `rtk npx vitest run tests/recommendation/outcomeContractV1.test.ts`: passed 27/27.
- `rtk npx tsc --noEmit`: passed.

## Scope and safety

- No Rust file was edited by this owner.
- No `.env` or `ml-services/**` path was read, edited, or tested.
- No production runtime caller, release gate, staging operation, or commit was added.
- Existing unrelated worktree changes were preserved.
