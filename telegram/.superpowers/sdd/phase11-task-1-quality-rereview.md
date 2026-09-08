# Phase 11 Task 1 Final Code-Quality Re-review

## Verdict

`NEEDS_CHANGES`. The prior terminal-state, provenance, numerical-scaling, private-brand, and model-budget findings are materially closed, but four Important correctness/resource-contract gaps remain.

## Scope analyzed

- `offlinePrediction/streamingV2/**`
- `ope/v3/**`
- `outcomes/syntheticOutcomeEvidenceV1.ts` and the shared attribution core
- `decisionContext/syntheticContextV1.ts`
- Phase 11 model-budget additions in `offlinePrediction/contracts/artifacts.ts`
- `tests/recommendation/phase11StreamingEvidence.test.ts`
- Rust Phase 11 behavior fixture, golden/relationship tests, and manifest entry
- prior Task 1 quality/spec reviews and fix report

## Findings

### Important: the claimed bounded step chain still materializes candidate x position support and under-reports state memory

`VerifiedSyntheticTrajectoryEvidenceV1` stores every step, and every step stores the full target distribution (`streamingV2/trajectory.ts:59-97`). Verification accumulates all steps in `provisionalSteps` and copies every action probability into each step before minting evidence (`trajectory.ts:211-212`, `363-386`). State creation then retains all step objects in both `expectedDecisions` and `expectedSteps` (`ope/v3/kernel.ts:47-65`, `107-120`). However `estimatedBytes` counts only decisions/clusters/segment keys/objectives/prefixes/aggregates (`kernel.ts:423-432`), and the receipt names only outcome/context as bounded in-memory evidence (`ope/v3/contracts.ts:62-64`).

Impact: a 2048 x 64 support can retain roughly 129k action-probability objects per decision while the high-water diagnostic reports only aggregate maps. The NDJSON replay is streaming, but the full chain is not bounded by the advertised state-byte gate.

Smallest fix: either consume branded target steps directly into the OPE step kernel and retain only current-step data, or explicitly add trajectory/target-step records and bytes to the bounded-evidence declaration, limits, and high-water calculation. Add one maximum-support regression proving the configured byte/record gate fires before untracked materialization.

### Important: canonical receipt ordering uses locale-dependent collation

Target root objects, aggregate entries, prefixes, and aggregate-state entries are ordered with `localeCompare` (`ope/v3/kernel.ts:132-136`, `351-353`, `423-432`). Aggregate keys include caller-controlled Unicode cluster/objective/segment values, so ordering can differ with ICU/default locale even though the receipt calls these canonical SHA-256 bindings.

Impact: the same verified cohort can produce a different `targetEvidenceRootsSha256`, `aggregateStateSha256`, or estimated-state representation across Node builds/locales, breaking reproducibility and cross-runtime verification.

Smallest fix: use the existing UTF-8 byte comparator pattern (`Buffer.compare(Buffer.from(left), Buffer.from(right))`) for every digest/resource-ordering path. Add a non-ASCII ordering test.

### Important: malformed synthetic events can escape the fail-closed result contract

The event payload is intentionally `z.unknown()` (`outcomes/syntheticOutcomeEvidenceV1.ts:16-20`), but verification calls `syntheticOutcomeEventSha256V1(envelope.event)` outside a `try/catch` (`syntheticOutcomeEvidenceV1.ts:110-139`). Canonical hashing recursively walks arbitrary objects; cyclic objects or unsupported values such as `BigInt` can throw before a stable `not_evaluable` result is returned. The existing whole-set V1 verifier already protects this boundary with a catch (`outcomes/verifiedOutcomeEvidenceV1.ts:171-216`).

Impact: malformed offline evidence can reject the verifier by exception instead of poisoning the whole cohort with a stable blocker, making batch orchestration and rollback behavior unreliable.

Smallest fix: wrap event canonicalization/normalization in the same guarded boundary used by V1 and return `synthetic_outcome_event_contract_invalid`. Add one cyclic/unsupported event regression.

### Important: synthetic outcome evidence does not bind or validate finite reward bounds

The synthetic verifier checks only that each realized reward is finite (`outcomes/syntheticOutcomeEvidenceV1.ts:172-174`), and its evidence contract contains no derived bounds (`syntheticOutcomeEvidenceV1.ts:43-60`). The verified V1 path derives bounds, rejects non-finite bounds, checks every reward, and binds the bounds in evidence (`outcomes/verifiedOutcomeEvidenceV1.ts:152-158`, `243-249`, `281-282`). With individually finite but very large weights, the theoretical upper/lower sum can overflow even when a realized reward happens to remain finite through cancellation.

Impact: synthetic OPE evidence can be branded without the finite reward-bound premise later required by confidence-sequence and robust-inference audits.

Smallest fix: reuse a single exported reward-bound helper from the V1 implementation, reject non-finite/out-of-range rewards, and bind `{minimum, maximum}` into the synthetic evidence digest. Test finite realized reward with overflowing theoretical bounds.

## Confirmed closures

- Callback/abort/commit: trajectory replay publishes no brand unless transactional replay commits; callback/commit failure invokes abort and returns a stable blocker. The Task 1 visitor itself has reversible in-memory callbacks.
- State poisoning: the first consume/finalize blocker is terminal; incomplete, cross-cohort, qHat, numerical, and resource failures cannot later finalize.
- Private provenance: behavior/target roots and evidence brands are module-private; cloned/self-authored evidence is rejected. Contribution/receipt owner maps prevent cross-state pairing.
- Numerical scaling: importance-weight and non-zero IPS/DR product underflow/overflow are checked in log space before commit. No new cancellation defect beyond the existing naive aggregate baseline was reproduced.
- Model budget: usage is derived from canonical fold/head/coefficient structures, uses safe integers, enforces empty-fold and configured count/byte caps, and explicitly cannot mint a verified prediction receipt.
- Fixture relationship: the manifest raw digest matches the Phase 11 behavior fixture; Rust recomputes the private behavior kernel and binds the separate target configuration/source relationship.
- Runtime boundary: scoped caller search found only the focused Phase 11 test; no runtime caller or `logged_randomized` exposure exists in the reviewed APIs.

## Validation

- `rtk npx vitest run tests/recommendation/phase11StreamingEvidence.test.ts`: 9/9 passed.
- `rtk npx tsc --noEmit`: passed.
- `rtk cargo test -p telegram-rust-recommendation phase11_synthetic_behavior_fixture_matches_private_kernel`: 1 passed.
- `rtk cargo test -p telegram-recommendation-fixtures phase11_synthetic_behavior_fixture_binds_target_source_and_logged_trajectory`: 1 passed.
- Raw SHA-256 for `phase11_synthetic_behavior_trajectory_v1.json` matches its manifest entry.

## Residual risk and follow-up

Priority is to close the four findings above, then rerun the focused Node test, TypeScript compile, both Rust focused tests, manifest digest test, and this quality review. The current synthetic-only/no-runtime boundary limits immediate production blast radius, but it does not make non-canonical receipts or incomplete resource accounting acceptable evidence.
