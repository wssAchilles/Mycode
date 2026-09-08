# Phase 11 Task 1 Code-Quality Review

## Scope

Read-only review of:

- `telegram-clone-backend/src/services/recommendation/offlinePrediction/streamingV2/`
- `telegram-clone-backend/src/services/recommendation/ope/v3/`
- Phase 11 additions in `offlinePrediction/contracts/artifacts.ts`
- `tests/recommendation/phase11StreamingEvidence.test.ts`

The missing exact-prefix, Rust-trust-rooted target cursor is treated as the already-known provenance blocker and is not duplicated below.

## Findings

### Critical: a failed cohort can still produce an unrelated verified receipt

`consumeOpeStepContributionV3` returns blockers without poisoning the state (`ope/v3/kernel.ts:114-225`). A caller can consume a valid prefix, submit an invalid/resource-exceeding next step, ignore that error, and call `finalizeOpeAggregateReceiptV3`. Finalization only checks that the state exists and is not finalized (`kernel.ts:254-288`); it also accepts an empty state. The receipt preimage contains only resource configuration and high-water counts, not an input/evidence digest, contribution hash chain, aggregate digest, or prior failure status (`kernel.ts:259-284`). Therefore the branded receipt neither proves whole-cohort success nor binds the emitted contributions, and a receipt from one state can be paired with contributions from another.

User impact: cursor or callback failure can be silently truncated into apparently verified offline evidence, violating the required whole-cohort fail-closed boundary.

Smallest fix: add a terminal failed state; every post-creation consume error must poison it, and finalize must reject failed and empty states. Incrementally hash canonical contribution records and bind the final chain head, slot count, trajectory/evidence roots, context root, and aggregate digest into the receipt. Add tests for `valid step -> invalid step -> finalize`, empty finalize, and cross-state receipt/contribution substitution.

### Important: V3 silently accepts importance-weight and DR underflow that V2 rejects

V3 directly computes `Math.exp(prefixLogWeight)`, `Math.exp(logWeight)`, and multiplication-based IPS/DR terms, then checks only `Number.isFinite` (`ope/v3/kernel.ts:174-190`). Finite underflow becomes `0`, so it passes. V2 explicitly checks `LOG_MIN` for weight and contribution underflow and returns stable blockers (`ope/v2/evaluate.ts:20-30`, `133-140`, `201-220`). This changes cumulative prefix IPS/DR semantics instead of preserving the regression baseline.

User impact: extreme but valid positive propensities can be reported as zero contribution rather than `not_evaluable`, biasing synthetic qualification and masking numerical support failures.

Smallest fix: reuse/extract the existing scalar log-domain bounds and `scaled` behavior without calling the V2 cohort row builder. Test both weight underflow and `weight * reward`/DR-term underflow.

### Important: cluster, objective, and segment bindings are caller-authored and may drift within a decision

The kernel accepts raw strings/arrays for `inferenceClusterId`, `segmentKeys`, and `objective` (`ope/v3/kernel.ts:103-131`) instead of a verified Decision Context binding. It does not require later slots of the same decision to match the first slot's cluster/objective/segments. Aggregate identity also includes only segment key names, not PIT-safe segment values (`kernel.ts:193-212`), so `country=US` and `country=DE` cannot be distinguished.

User impact: one sequential trajectory can be split across clusters/objectives or relabeled after the fact, invalidating clustered inference and segment guardrails while the receipt still advertises bounded Decision Context evidence.

Smallest fix: bind a verified decision-context digest and full immutable per-decision binding at first slot, compare it on every later slot, and aggregate by canonical segment assignments (key plus value), not names alone. If this remains a deliberately low-level kernel, do not allow it to mint the final verified receipt until a higher-level projector supplies and binds verified context.

### Important: the model-state resource gate validates self-reported counters, not model state

`validatePhase11ModelStateResourcesV1` receives only caller-authored `modelBytes`, `gradientBytes`, fold counts, and coefficient counts (`offlinePrediction/contracts/artifacts.ts:184-256`). It has no model/bundle/trainer brand from which to derive those values, so an oversized model can report small counters and pass. The ordering literals in the config likewise record a claim but do not verify actual trainer iteration order. Numeric counters use `int()` rather than safe bounded integers, allowing non-safe counts and possible inaccurate totals.

User impact: the new gate does not yet enforce the memory/resource boundary it is meant to certify and cannot support a trustworthy prediction replay receipt.

Smallest fix: compute usage from the actual canonical fold/head/coefficient structures inside the producer/verifier, or accept only a private branded usage receipt created there. Use safe integers and bind the resource-config digest into the model/prediction receipt. Add a test where forged low usage counters accompany an oversized actual model.

## Validation

- Normal path: `rtk npx vitest run tests/recommendation/phase11StreamingEvidence.test.ts` passed all 8 tests.
- Failure paths statically reviewed: prefix mismatch, qHat mismatch, resource limit, numerical error, and post-link durability status.
- Integration edge reviewed: V2 numerical behavior, verified Decision Context ownership, Phase 10 atomic sink semantics, and no runtime callers in the new V3 surface.

The current focused tests do not cover state poisoning/finalization after failure, receipt-to-contribution binding, numerical underflow, within-decision context drift, segment values, or model-usage forgery.

## Verdict

`NEEDS_FIXES`. The implementation is synthetic-only and has no runtime caller, which limits immediate blast radius, but the receipt/failure-state defect and numerical regression must be fixed before Task 1 can be accepted. After those fixes, the known Rust exact-prefix trusted-target blocker still prevents authoritative target provenance.
