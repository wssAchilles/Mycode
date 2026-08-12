# Phase 11 Task 1 Specification Review

## Verdict

`NEEDS_CHANGES`. The implementation is synthetic/offline-only and preserves the production gates, but it does not yet establish Rust-proven target probabilities or a whole-cohort fail-closed V3 receipt.

## Scope reviewed

- `offlinePrediction/streamingV2/`
- `ope/v3/`
- Phase 11 model-state additions in `offlinePrediction/contracts/artifacts.ts`
- `tests/recommendation/phase11StreamingEvidence.test.ts`
- Compared with `.superpowers/sdd/phase11-task-1-brief.md` and the six latest blocking corrections.

## Findings

### P1 - Target probabilities and observed-prefix evaluation are caller-authored, not Rust V2 verified

The public verification input accepts `target.steps` as ordinary arrays (`trajectory.ts:61-75`). Verification checks prefix identity, support membership, and total mass, but never requires a private `VerifiedTargetDistributionEvidenceV2` brand or replays a Rust receipt/cursor (`trajectory.ts:232-254`). The focused fixture demonstrates the gap by constructing a uniform target distribution directly in TypeScript (`phase11StreamingEvidence.test.ts:159-187`). Consequently, any caller can choose probabilities that sum to one and receive a verified trajectory, even when those probabilities were not computed by the target policy on the observed synthetic behavior prefix. IPS/SNIPS/DR would then have no valid target-policy semantics.

The behavior side has the same provenance weakness at a smaller boundary: the input carries a caller-supplied simulation object (`trajectory.ts:63-67`) and calls the existing Node simulation contract verifier (`trajectory.ts:168-177`), but no Rust trusted receipt is required to prove that the supplied draws produced the supplied ordered actions.

Smallest fix: produce a Rust target-distribution stream/receipt for the exact synthetic behavior trajectory, under an independently registered `synthetic_fixture` trusted root. The stream must bind the synthetic behavior decision digest, candidate-pool digest, target policy/config digest, observed ordered actions, and every observed prefix. `verifySyntheticTrajectoryEvidenceV1` should accept only the private V2 brand and consume it through `replayVerifiedTargetDistributionV2`, comparing each position, prefix, support action, observed action, and probability before commit. The existing V2 fixture cannot be adapted by assertion because it evaluates prefixes from the original deterministic trajectory. A corresponding trusted Rust simulation receipt (or fixture-root binding) is also required if `Rust-selected` is meant as provenance rather than algebraic consistency.

### P1 - A failed step can still finalize a verified partial-cohort receipt

Resource, prefix, probability, qHat, and numerical failures return `not_evaluable` without poisoning the aggregate state (`kernel.ts:114-191`, `kernel.ts:217-225`). `finalizeOpeAggregateReceiptV3` has no failed-state check and will verify whatever prefix was accepted, including an empty state (`kernel.ts:254-288`). Therefore, after step 1 succeeds and step 2 fails, a caller can still finalize a verified receipt for step 1. The existing cap test observes the second-step failure but does not attempt finalization (`phase11StreamingEvidence.test.ts:330-379`). This violates whole-cohort fail closed.

Smallest fix: record a terminal blocker in state on every post-creation consume/cursor failure, reject all later consumes and finalization, require at least one completed decision/slot, and bind the receipt to the committed trajectory/outcome/context roots. Add the exact regression: successful first step, failing second step, then finalization must return the original blocker and no verified receipt.

### P1 - Outcome replay is anchored to a second log that claims deterministic TopK

The trajectory verifier binds outcome evidence through `outcomeDecisionLogSha256`, but only compares decision/request IDs, that digest, and exact outcome action membership (`trajectory.ts:214-230`). The fixture creates the replayed outcome log with the Rust-selected actions while declaring `behaviorPolicyKind: deterministic_top_k` and deterministic-unavailable propensity (`phase11StreamingEvidence.test.ts:59-79`). Thus `attributeOutcomeV1` is not replaying the synthetic behavior Decision Log; it is replaying a semantically false deterministic wrapper around the selected actions.

Smallest fix: add an offline-only outcome replay adapter whose source is the verified synthetic Decision Log and whose behavior evidence remains `simulated_propensity`, or define a dedicated synthetic outcome input contract that reuses `attributeOutcomeV1` without coercing the trajectory into `deterministic_top_k`. Keep it incompatible with the production Decision Log schema and never map it to `logged_randomized`.

### P1 - V3 cluster, segment, and objective bindings are unverified caller context

`consumeOpeStepContributionV3` accepts `inferenceClusterId`, `segmentKeys`, and `objective` as plain strings (`kernel.ts:103-131`). That bypasses the already verified PIT Decision Context boundary and permits post-outcome segment or arbitrary cluster substitution even though the receipt advertises bounded `decision_context_v1` evidence (`contracts.ts:33-49`).

Smallest fix: take a private branded per-decision projection from `VerifiedDecisionContextSetV1` (and a frozen objective/config binding), then derive cluster and segment values internally. Raw strings should remain only inside that verified adapter.

### P1 - Importance-weight underflow is accepted as a valid zero weight

The single-step kernel computes `Math.exp(logWeight)` and accepts every finite result (`kernel.ts:174-181`). For a sufficiently negative but finite cumulative log weight, JavaScript underflows to `0`, so the step is emitted instead of failing closed on the requested numerical error boundary. This regresses the V2 behavior, which explicitly distinguishes importance-weight underflow.

Smallest fix: reuse the V2 `LOG_MIN`/`LOG_MAX` guard and scaled-contribution semantics in the one-step kernel; reject finite log weights below `Math.log(Number.MIN_VALUE)` with a stable underflow blocker. Add one cumulative-prefix underflow test.

### P1 - Model-state limits can be bypassed by self-reported byte counts and omit a total coefficient cap

The config limits coefficients only per head (`artifacts.ts:145-178`), while the validator merely sums coefficients for reporting and never compares the total against a configured fold x head x coefficient limit (`artifacts.ts:241-255`). `modelBytes` and `gradientBytes` are caller-provided values (`artifacts.ts:184-198`), so a large model can report small byte counts. The helper also has no production caller; only the focused test invokes it.

Smallest fix: add a versioned `maxTotalCoefficientCount`, compute counts and float64 model/gradient bytes from the actual canonical fold/head coefficient state, and invoke the validator inside producer and replay verifier before allocation/publication. Retain the declared row/fold/head/feature/accumulation ordering and add a total-count regression rather than relying only on per-head overflow.

## Confirmed conforming boundaries

- Exact outcome and qHat lookup use the complete action key including 1-based `servedPosition` (`trajectory.ts:227-230`, `kernel.ts:161-171`). Candidate removal intentionally uses namespace/id identity for without-replacement selection.
- The V3 kernel is one-step and does not call `buildOpeContributionRowsV2`.
- New surfaces do not emit `logged_randomized` or claim `fullyStreaming: true`.
- Aggregate receipts explicitly disclose materialized Outcome/Context V1 evidence and configured high-water fields (`contracts.ts:33-49`, `kernel.ts:259-284`).
- Atomic result description correctly distinguishes pre-publish invisibility from post-link durability uncertainty and forbids retry after possible publication (`publish.ts:3-26`).
- V1/V2 plain objects cannot satisfy the V3 step WeakSet brand (`kernel.ts:114-118`, `phase11StreamingEvidence.test.ts:414-429`).

## Validation

- `rtk npx vitest run tests/recommendation/phase11StreamingEvidence.test.ts`: 8/8 passed.
- `rtk npx tsc --noEmit`: passed.
- No `.env`, `ml-services/**`, release verification, production write, staging, or commit operation was used.

## Residual risk

Until the Rust behavior/target provenance, failed-state poisoning, verified context adapter, and model-state integration are closed, this surface is suitable only as contract scaffolding. It must not be described as unified V2 evidence readiness or used to qualify real-data inference.
