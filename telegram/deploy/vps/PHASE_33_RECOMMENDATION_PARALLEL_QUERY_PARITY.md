# Phase 33 Recommendation Parallel Query Parity

## Completed

- This phase was aligned against the public reference repositories through GitHub MCP reads of:
  - `xai-org/x-algorithm/candidate-pipeline/candidate_pipeline.rs`
  - `xai-org/x-algorithm/home-mixer/candidate_pipeline/phoenix_candidate_pipeline.rs`
  - `ultraworkers/claw-code/PARITY.md`
- Rust recommendation keeps the Phase 30 per-hydrator provider surface, but Phase 33 makes the runtime semantics stricter and more production-safe.
- Rust query hydrators remain `parallel_bounded`, with:
  - execution in parallel
  - merge order fixed to pipeline definition order
  - field ownership conflicts still treated as explicit contract errors
- Rust source orchestration now behaves as a fail-open parallel lane instead of aborting retrieval on a single source/provider error.
- The active source semantics are now:
  - `GraphSource` stays on its dedicated Rust branch
  - non-graph sources run in bounded parallel mode
  - merge order stays equal to `source_order`
  - single-source failure yields a machine-readable failed stage instead of a whole-request failure
- Failed source stages now expose:
  - `detail.error`
  - `detail.executionMode = parallel_bounded`
  - `detail.degradeMode = fail_open`
- Graph source orchestration now normalizes complete graph-branch failure as:
  - `emptyReason = all_kernels_failed`
  - degraded reason `graph_source:all_kernels_failed`
- Runtime version signals were advanced for this phase:
  - `pipelineVersion = xalgo_candidate_pipeline_v5`
  - `retrieval.summary.stage = source_parallel_graph_v4`
- A machine-readable readiness check for this phase now exists at:
  - `deploy/vps/check_phase_33_recommendation_parallel_readiness.sh`

## Current Owner Boundary

- `recommendation owner = rust`
- Rust now owns:
  - query hydrator fan-out scheduling
  - stable query-patch merge order
  - source fan-out scheduling
  - source fail-open degradation
  - graph-source failure normalization
  - stage latency capture for query/retrieval/ranking/post-selection
- Node remains limited to:
  - query hydrator provider data
  - source provider data
  - candidate hydrate/filter/score provider stages
  - control-plane aggregation
- C++ remains the graph kernel owner.

## Remaining Gaps

- Candidate hydrators, filters, scorers, and post-selection logic still execute through the Node provider surface rather than as Rust-native stage implementations.
- Phase 33 makes query/retrieval execution boundaries more robust, but it does not yet replace the Node-backed candidate-stage providers.
- The `P95` improvement target for query + retrieval still requires before/after live production sampling on the same traffic class.

## Rollout Notes

- This phase does not change the frontend contract.
- Recommended checks after deploy:
  - `GET /api/ops/recommendation`
  - `GET /ops/recommendation`
  - `GET /ops/recommendation/summary`
  - `bash deploy/vps/check_phase_33_recommendation_parallel_readiness.sh`
- Healthy Phase 33 signals are:
  - `pipelineVersion = xalgo_candidate_pipeline_v5`
  - `stageExecutionMode = rust_orchestrated_explicit_provider_stages_parallel_bounded`
  - `queryHydratorExecutionMode = parallel_bounded`
  - `sourceExecutionMode = parallel_bounded`
  - `summary.stageLatency.queryHydrators` populated
  - `summary.stageLatency.sources` populated
  - `summary.partialDegradeCount` remains `0` during a clean rollout window
  - source/provider failures surface as degraded reasons instead of request-level `502`

## Smoke Checklist

- Frontend login remains unchanged and still hits `https://api.xuziqi.tech`
- `/api/ops/recommendation` shows Rust as the recommendation owner
- `/ops/recommendation/summary` returns non-empty `stageLatency.queryHydrators`
- `/ops/recommendation/summary` returns non-empty `stageLatency.sources`
- A single source failure no longer aborts the whole retrieval request
- Graph source complete failure is machine-readable as `graph_source:all_kernels_failed`
