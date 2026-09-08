# Phase 32: Training Source and Consumer Boundary

## Decision

The reduced offline hardening scope is `GO`. This phase does not change ranking,
label attribution, PIT feature math, model loss, or runtime policy behavior, so
external algorithm research was skipped.

The training export remains diagnostic-only. It is not an authoritative real
evidence source and does not authorize a model for serving.

## Implemented boundary

- Every trace must bind the parsed Decision Log by `requestId`, `decisionId`,
  and `decisionLogV1Sha256` before any downstream action or feature read.
- Invalid Decision Log rows fail the whole export instead of being silently
  omitted.
- Trace, outcome/history action, embedding, and post feature reads share one
  MongoDB snapshot session. PostgreSQL user/contact reads remain explicitly
  outside that snapshot.
- The exporter limits traces to 8,192, candidates per trace to 2,048, served
  samples to 65,536, each action class to 131,072 records, contacts to 131,072,
  each output to 32 MiB, and all seven outputs to 128 MiB.
- Artifact targets are create-only `0600` files. Existing files and symlinks are
  not overwritten.
- The Social Phoenix trainer rejects every row whose task labels are not exact
  binary `0/1` values. Quarantined `null` labels can no longer become negative
  training examples.

## Honest limits

- The seven files are not a transactionally atomic artifact set. A storage
  failure after the first create may leave a partial diagnostic set.
- Output records still contain linkable viewer, request, post, author, decision,
  and candidate identifiers. Pseudonymizing only top-level fields would break
  nested outcome and identity contracts; a privacy-safe artifact requires a new
  version and coordinated consumers.
- The MongoDB snapshot cannot cover PostgreSQL state. Contact PIT evidence stays
  absent, so those rows remain quarantined.
- A caller-selected cutoff is not an authoritative event-ingestion watermark.
- The artifact identity remains incomplete and the ANN artifact remains unbuilt;
  this path cannot establish `trainingReady` or real-evidence eligibility.
- The trainer now rejects invalid labels, but it still does not bind an approved
  dataset receipt. The runtime model loader also does not verify training-source
  provenance. That is the next consumer-backed gate.

## Status

| Scope | Status |
|---|---|
| Phase 32 offline diagnostic hardening | `GO` |
| Decision Log source binding | `READY` |
| Mongo-only snapshot consistency | `READY / diagnostic only` |
| Cross-store PIT consistency | `NOT READY` |
| Privacy-controlled training artifact | `NOT READY` |
| Training dataset admission | `NOT READY` |
| Real evidence readiness | `NO-GO` |
| Candidate qualification | `not_run` |
| Active selected method | `diagnostics_only_abstention_v1` |
| Runtime randomized logging / Promotion / Task 9 | `NO-GO` |

## Next phase

Phase 33 should inspect the Social Phoenix model artifact and runtime loader as
one consumer-backed boundary. The minimum acceptable result is either a
dataset/model receipt that the loader can verify without enabling a new model,
or an honest fail-closed status if the existing artifact contracts cannot bind
training provenance without a new version.
