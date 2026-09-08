# Phase 11 Task 3: Honest inference qualification

Repository: `/Users/achilles/Documents/telegram_code/telegram`

## Goal

Implement a synthetic-only Phase 11C applicability/qualification layer. Do not add a public confidence-sequence estimator and do not change existing OPE or bootstrap mathematics.

## Ownership

You exclusively own new files under:

- `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/`
- one new focused test file under `telegram-clone-backend/tests/recommendation/`

Do not edit existing inference, OPE, Promotion or runtime files unless compilation requires a minimal type-only import/export. Do not commit.

## Required behavior

Add strict `inference_qualification_v1` contracts and evaluator comparing these candidates as diagnostics:

- existing cluster bootstrap-t receipt/reference;
- ordinary clustered Wald diagnostic reference;
- time-uniform confidence-sequence applicability audit;
- `diagnostics_only_abstention_v1`.

The CS audit may return `applicable` only when evidence explicitly verifies all of:

- synthetic fixture scope and immutable/frozen protocol binding;
- iid contextual-bandit records;
- one action/slot per independent record;
- fixed behavior and target policies chosen before outcomes;
- absolute continuity of target with respect to behavior;
- finite positive propensity floor and finite importance-weight upper bound;
- reward lower/upper bounds and every reward within them;
- no viewer/session clustering, temporal dependence, common shocks, optional policy adaptation or holdout reuse.

Missing, self-asserted, inconsistent or false evidence is `not_applicable`; independent single-slot alone is insufficient. Do not calculate or expose a confidence sequence.

The qualification result must always choose `diagnostics_only_abstention_v1`, set `realDatasetEligible:false`, and include both stable blockers:

- `finite_sample_inference_unavailable`
- `multiplicity_control_unavailable`

Bind the frozen family/ledger receipt digests when present. If completeness/root verification is absent, include `holdout_ledger_completeness_unverified` before the fixed blockers. Never consume a self-asserted production root.

Add versioned bounded diagnostics/high-water fields for scenario count, record count, cluster count and estimated state bytes. Resource overflow returns `resource_limit_exceeded` while preserving abstention.

## Tests

Add few hard tests proving:

- independent single-slot without iid/absolute-continuity/bounds is not applicable;
- a fully verified synthetic iid bounded fixture can be marked applicable but still abstains;
- viewer cluster, temporal dependence, adaptive policy choice, zero propensity or unbounded weight each makes CS not applicable;
- missing complete ledger root is surfaced;
- no result is production eligible and fixed blockers never disappear.

Run the focused Vitest file and `npx tsc --noEmit`. Do not modify or test `ml-services/**`; do not run `verify_all.sh`.

## Report

Write `.superpowers/sdd/phase11-task-3-report.md` with files changed, tests/commands/results, self-review, and concerns. Return only `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` plus one-line summary.
