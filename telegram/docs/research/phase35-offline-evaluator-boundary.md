# Phase 35: Offline Evaluator Boundary

## Decision

- Offline evaluator resource and failure handling: `GO`
- Data/source admission: `NO-GO / no_verified_source`
- Candidate selection and qualification: `NO-GO / no_candidate_selected`
- Runtime learned model, real inference, Promotion, exploration and Task 9: blocked

This phase is a narrow offline CLI hardening change. External algorithm research was skipped because
the change does not alter scoring, inference, or candidate-method semantics.

## Implemented Boundary

`evaluateRecsysTrainingSamples.ts` now:

- fails closed when an explicitly supplied development model cannot be verified;
- reads a regular-file `fstat` snapshot through the same descriptor and hashes the bounded input;
- limits input bytes, line bytes, rows, requests, rows per request, `topK`, and evaluation work;
- aggregates caller-controlled source, state, and pipeline keys through `Map` before JSON output;
- labels output `offline_diagnostic_v1` with model selection, qualification, and real-data eligibility
  all set to `false`.

The evaluator remains a diagnostic CLI. Its input and model digests are observability fields, not
source receipts, approval brands, or qualification evidence.

## Deliberate Non-Goals

- No DatasetAcceptance consumer, source receipt, PIT/Decision Log completeness proof, or retention
  contract was added.
- No candidate adapter, method freeze, qualification seed/root, model receipt, or runtime model load
  was added.
- `PhoenixScorer` remains learned-model disabled; `selectedMethod` remains
  `diagnostics_only_abstention_v1` and `candidateQualificationStatus` remains `not_run`.

The next re-entry requires an independently owned, immutable source receipt with PIT, viewer/time
provenance, completeness, retention and evaluation/rollback bindings. Until then, real finite-sample
inference, Promotion, exploration, and Task 9 remain unavailable or unauthorized.
