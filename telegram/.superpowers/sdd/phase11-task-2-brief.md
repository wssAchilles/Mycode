# Phase 11 Task 2: Frozen evaluation family and complete holdout ledger

Repository: `/Users/achilles/Documents/telegram_code/telegram`

## Goal

Implement the smallest synthetic-only Phase 11B bounded context that freezes an evaluation family and verifies a complete single-use holdout ledger. It is readiness diagnostics only and must not change Promotion V2.

## Ownership

You exclusively own new files under:

- `telegram-clone-backend/src/services/recommendation/promotion/evaluationProtocol/`
- one new focused test file under `telegram-clone-backend/tests/recommendation/`

Do not edit existing Promotion V1/V2 or other write surfaces. Do not commit.

## Frozen family

Add strict `frozen_evaluation_family_v1` Zod contract and verifier. Bind exactly one candidate policy, fixed objectives, PIT-safe segment definitions, `mean_reward_per_logged_slot_v1`, thresholds, dataset/holdout identifiers and digests, seed material, evidence/config digests, `frozenAt`, `holdoutRevealNotBefore`, multiplicity procedure `intersection_union_all_must_pass_v1`, `realDatasetEligible:false`, and self SHA-256 excluding that field. Require canonical unique/sorted arrays and freeze strictly before reveal.

Reject multiple candidates, adaptive family/config changes, digest drift, duplicate objectives/segments, noncanonical timestamps, and any production eligibility claim. Use private WeakSet/WeakMap capability plus recursive freeze.

## Complete ledger stream

Add canonical NDJSON grammar with `ledger_start -> holdout_use* -> ledger_end` and a manifest. Each use record binds sequence, useId, familySha256, holdoutSha256, purpose, revealedAt, usedAt, priorChainHead and recordSha256. Canonical order is ascending sequence. Same useId+digest is idempotent only when replaying the exact complete stream; same useId with another digest or a second distinct use of the same holdout is a blocker.

Verify the entire byte stream incrementally and bind all of:

- `rawSha256`
- `recordCount`
- `initialRoot`
- `finalChainHead`
- `manifestSha256`
- a module-private reviewed `synthetic_fixture` trusted root

The trusted root must bind all six values and cannot be supplied by the caller. A valid truncated prefix must fail. Missing/unmatched root returns `holdout_ledger_completeness_unverified`. No production root is registered.

Return a private branded `holdout_use_ledger_receipt_v1` only after whole-stream verification. Always carry `realDatasetEligible:false` and readiness blocker `multiplicity_control_unavailable`. This is not a reusable-holdout mechanism.

## Resource and failure boundaries

Use bounded line/record/byte limits and incremental SHA-256. Do not split the full stream or retain all raw records. A bounded map of seen useIds/holdoutIds is allowed and its configured high-water count/estimated bytes must be reported. Any grammar, chain, time, family, root, resource or stream error returns no partial brand.

## Tests

Add few hard tests covering complete valid synthetic stream, valid truncated prefix rejection, chain-head/digest/count/root drift, duplicate holdout/use conflicts, reveal-before-freeze ordering, multiple candidates, caller-supplied fake root rejection, immutable brand, and permanent multiplicity blocker.

Run the focused Vitest file and `npx tsc --noEmit`. Do not modify or test `ml-services/**`; do not run `verify_all.sh`.

## Report

Write `.superpowers/sdd/phase11-task-2-report.md` with files changed, tests/commands/results, self-review, and concerns. Return only `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED` plus one-line summary.
