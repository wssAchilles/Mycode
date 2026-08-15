# Phase 34: Dataset Admission Handoff

## Decision

- Dataset acceptance consumer: `NO-GO / no_verified_source`
- Social Phoenix training qualification: `NO-GO / no_candidate_selected`
- Runtime learned model: `NO-GO` and disabled
- Offline diagnostic inspection: `GO`

This phase does not change a scoring or inference algorithm, so external algorithm research was
skipped. The decision is based on the current source and consumer contracts.

## Verified Code Facts

- `buildVersionedTrainingArtifacts` derives `datasetDigest` from caller-provided valid and
  quarantine bytes, a caller-provided manifest summary, caller-provided identity, and ANN inputs.
- `DatasetAcceptanceV1` has no issuer, signature, source receipt, or independent valid-byte digest.
  `approvalConfig` is parsed from caller JSON and has no private brand.
- The runtime exporter uses an empty diagnostic identity and an unbuilt ANN artifact, so its normal
  output is correctly `trainingReady=false`.
- The seven exporter files are written separately. No consumer verifies their cross-file binding.
- `trainSocialPhoenixModel.ts` accepts arbitrary caller NDJSON and currently validates labels and
  bounded features, but ignores acceptance, PIT manifest, versioned-example identity, and source
  provenance.
- `PhoenixScorer` keeps its learned model unset. Remote Phoenix and the existing heuristic remain
  the only runtime paths.

## Options

| Option | Decision | Reason |
|---|---|---|
| Treat `trainingReady=true` as authority | Reject | Plain approval JSON can be self-generated. |
| Add a thin acceptance wrapper | Reject | It would add a new unconsumed trust surface. |
| Build a source-bound consumer | Defer | Requires an independent PIT/source receipt, immutable byte set, and lifecycle owner. |
| Keep diagnostic training and runtime abstention | Adopt | Preserves experimentation without upgrading caller data to evidence. |

## Required Future Handoff

Before any model can be selected or loaded, a future version must bind, in one independently owned
receipt:

1. immutable valid and quarantine byte digests plus counts;
2. PIT, Decision Log, outcome and feature provenance roots;
3. an approved identity and fixed training/config digest;
4. evaluation/rollback evidence and an explicit authorization owner.

Until then, no candidate applicability or qualification is assessed. `selectedMethod` remains
`diagnostics_only_abstention_v1`, `candidateQualificationStatus` remains `not_run`, and real
finite-sample inference, Promotion, exploration, and Task 9 remain blocked.
