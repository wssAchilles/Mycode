# Phase 30 Recommendation Latency Parity

## Completed

- This phase was aligned against the public reference repositories through GitHub MCP reads of:
  - `xai-org/x-algorithm/candidate-pipeline/candidate_pipeline.rs`
  - `xai-org/x-algorithm/home-mixer/candidate_pipeline/phoenix_candidate_pipeline.rs`
  - `ultraworkers/claw-code/PARITY.md`
- Rust recommendation no longer depends on the composite Node `/internal/recommendation/query` path as its primary query-hydration boundary.
- Node now exposes per-hydrator provider endpoints at:
  - `POST /internal/recommendation/query-hydrators/:name`
- The active query-hydrator provider surface is now explicit and ownership-scoped:
  - `UserFeaturesQueryHydrator -> userFeatures`
  - `UserActionSeqQueryHydrator -> userActionSequence`
  - `NewsModelContextQueryHydrator -> newsHistoryExternalIds, modelUserActionSequence`
  - `ExperimentQueryHydrator -> experimentContext`
- The Node adapter now rejects unauthorized field writes at the provider boundary instead of silently accepting cross-field mutation.
- Rust query hydrators now execute in `parallel_bounded` mode with stable merge order derived from the pipeline definition order.
- Rust sources now execute in `parallel_bounded` mode with a dedicated `GraphSource` branch and deterministic merge order equal to `source_order`.
- The Rust ops surface now exposes:
  - `queryHydratorExecutionMode`
  - `sourceExecutionMode`
  - `queryHydratorConcurrency`
  - `sourceConcurrency`
  - `stageLatency`
  - `partialDegradeCount`
  - `timeoutCount`
- A machine-readable readiness check for this phase now exists at:
  - `deploy/vps/check_phase_30_recommendation_readiness.sh`

## Current Owner Boundary

- `owner = rust`
- `fallbackMode = node_provider_surface_with_cpp_graph_primary`
- Rust now owns:
  - query-hydrator fan-out scheduling
  - stable query-patch merge order
  - source fan-out scheduling
  - graph source parallel branch orchestration
  - stage latency capture for query/retrieval/ranking/post-selection
  - phase-level degrade and timeout accounting
- Node now provides only:
  - per-query-hydrator provider data
  - compatibility composite `/query` fallback surface
  - candidate hydrate/filter/score provider stages
  - control-plane aggregation

## Remaining Gaps

- Candidate hydrators, filters, and scorers still execute inside the Node provider surface rather than as Rust-native component implementations.
- Phase 30 improves latency control and stage observability, but it does not yet replace the Node-backed candidate stage providers.
- The `P95 >= 20%` rollout target requires live before/after production measurements across the same traffic class; the code and ops surface are now in place to measure it, but the release comparison still depends on deployment-time sampling.

## Rollout Notes

- This phase is client-safe and does not require frontend protocol changes.
- Recommended checks after deploy:
  - `GET /api/ops/recommendation`
  - `GET /ops/recommendation`
  - `GET /ops/recommendation/summary`
  - `bash deploy/vps/check_phase_30_recommendation_readiness.sh`
- Healthy Phase 30 signals are:
  - `pipelineVersion = xalgo_candidate_pipeline_v4`
  - `stageExecutionMode = rust_orchestrated_explicit_provider_stages_parallel_bounded`
  - `queryHydratorExecutionMode = parallel_bounded`
  - `sourceExecutionMode = parallel_bounded`
  - `queryHydratorConcurrency = 4`
  - `sourceConcurrency = 4`
  - `summary.stageLatency.queryHydrators` populated
  - `summary.stageLatency.sources` populated

## Smoke Checklist

- Frontend login remains unchanged and still hits `https://api.xuziqi.tech`
- `/api/ops/recommendation` shows Rust as the active owner
- `/ops/recommendation/summary` returns non-empty `stageLatency`
- Query-hydrator contract violations surface as degraded reasons instead of silent field overwrites
- Source ordering stays stable for identical input while query/source execution remains parallel
