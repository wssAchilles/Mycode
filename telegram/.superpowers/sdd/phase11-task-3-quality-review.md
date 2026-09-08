# Phase 11 Task 3 Code Quality Review

## Verdict

`NEEDS_CHANGES`

## Scope analyzed

- `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/contracts.ts`
- `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/syntheticEvidence.ts`
- `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/evaluate.ts`
- `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/index.ts`
- `telegram-clone-backend/tests/recommendation/inferenceQualificationV1.test.ts`
- Read-only boundary check against Phase 11 frozen-family/ledger capabilities and V3 trajectory/OPE receipts.

## Findings

### [Important] CS applicability is not bound to the synthetic cohort whose assumptions were audited

Evidence:

- `contracts.ts:56-89` contains boolean assumption claims and counts, but no `frozenFamilySha256`, `holdoutLedgerReceiptSha256`, dataset/trajectory root, or V3 aggregate receipt digest.
- `syntheticEvidence.ts:14-48` registers those claims as a standalone hard-coded preimage; the public no-argument loader at `syntheticEvidence.ts:54-70` can mint that capability without receiving any verified family, ledger, trajectory, or aggregate receipt.
- `evaluate.ts:76-87` checks only that the family and ledger match each other. `evaluate.ts:121-125` compares assumption counts with caller-supplied high-water values, but never proves that the assumption audit belongs to that family, holdout, dataset, or trajectory.
- The result bindings at `contracts.ts:140-143` and digest preimage at `evaluate.ts:186-223` omit the assumption-evidence digest, so the qualification receipt itself cannot identify the evidence that produced `applicable`.

Impact:

The WeakSet/recursive-freeze capability prevents object forgery, but authenticates only where the object was created, not which data the iid, support, reward-bound, and dependence claims describe. A reviewed assumption capability can therefore be combined with any independently valid family/ledger pair accepted by this module. Today the synthetic root set is small, but the contract silently becomes unsafe as soon as another reviewed fixture/root is added, and the current `applicable` result is not traceable to the Phase 11 trajectory/V3 receipt.

Smallest fix:

- Add exact family, holdout-ledger receipt, dataset/trajectory cohort, and audited aggregate receipt digests to the registered assumption preimage.
- Compare those bindings against the branded inputs before returning `applicable`, include the assumption-evidence digest in the result bindings/preimage, and add one mismatch regression test.
- If a combined reviewed root is not yet available, keep the audit `not_applicable` instead of certifying unbound assumptions.

Expected risk reduction: makes the positive synthetic applicability result attributable to one immutable evidence chain and prevents capability reuse across cohorts.

### [Moderate] Diagnostic availability is caller-asserted rather than verified

Evidence:

- `contracts.ts:40-54` treats any syntactically valid SHA-256 as an `available` bootstrap-t or Wald diagnostic.
- `evaluate.ts:183-210` copies those hashes into the qualification result without a capability, receipt verification, or binding to the frozen family/trajectory.
- `inferenceQualificationV1.test.ts:25-33,83-90` demonstrates this by using repeated `a`/`b` strings and asserting that they are published as available diagnostic references.

Impact:

This cannot unlock a confidence sequence or Promotion because abstention and the fixed blockers remain intact, but the result can falsely advertise nonexistent or unrelated diagnostic evidence. That weakens auditability and makes the qualification digest attest to caller claims.

Smallest fix:

Accept only branded/verified diagnostic receipts and extract their digests internally. Until such a verifier exists, report these references as `unavailable` (or explicitly `unverified_reference`) rather than `available`.

Expected risk reduction: prevents a diagnostic report from lending credibility to arbitrary hashes while preserving the current abstention behavior.

## Validated

- Focused test: `rtk npx vitest run tests/recommendation/inferenceQualificationV1.test.ts` passed (`1` file, `8` tests).
- Private synthetic-evidence identity is implemented with a module-private symbol, `WeakSet`, `WeakMap`, recursive freeze, and digest recomputation; cloned evidence is rejected.
- Numeric schemas reject NaN/Infinity. The evaluator checks positive propensity floor, finite positive weight bound, ordered reward bounds, complete reward audit, observed reward range, and all required dependence flags.
- Blockers are deduplicated and keep `finite_sample_inference_unavailable` then `multiplicity_control_unavailable` as the final two entries.
- `confidenceSequence` is schema-fixed to `null`; selected method is always `diagnostics_only_abstention_v1`; `realDatasetEligible` is always `false`.

## Residual risk and follow-up

- Priority: fix the cohort/protocol binding before accepting Task 3; the diagnostic-reference issue can be fixed in the same narrow boundary change.
- After the fix, rerun the focused test and TypeScript compile, adding normal-path binding plus family/ledger/trajectory mismatch failure coverage.
- Runtime caller absence and integration with the final Phase 11 V3 receipt still require parent-level integration verification.
