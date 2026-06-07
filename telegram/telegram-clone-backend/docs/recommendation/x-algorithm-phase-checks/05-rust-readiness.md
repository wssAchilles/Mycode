# Phase 05 - Rust Readiness

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/home-mixer
- https://github.com/xai-org/x-algorithm/tree/main/candidate-pipeline
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md

## Local paths changed

- `src/services/ops/recommendation/buildRecommendationOps.ts`

## Alignment decisions

- Kept Rust as the primary orchestrator candidate and Node as adapter/fallback, matching Home Mixer orchestration and pipeline boundary ideas.
- Exposed blockers in the existing Node ops control plane instead of adding an isolated endpoint.
- Included Rust provider, Node adapter, Graph kernel, and trace fallback signals in one readiness object.

## Known deviations

- The Rust service already had `/health`, `/readiness`, and `/ops/recommendation/summary`; this phase only improves Node-side visibility.
- Readiness still reports degraded rather than forcing rollout mode changes.

## Follow-up risks

- Token mismatch can make the Node self-probe fail in local environments unless `RECOMMENDATION_INTERNAL_TOKEN` and base URL are configured consistently.
- Rollout should remain shadow/fallback until traces show reduced `rust_primary_error_fallback_node`.
