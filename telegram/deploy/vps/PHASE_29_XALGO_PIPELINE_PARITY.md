# Phase 29 X-Algorithm Pipeline Parity

## Completed

- This phase was aligned against the public `xai-org/x-algorithm` repository through GitHub MCP reads of:
  - `candidate-pipeline/candidate_pipeline.rs`
  - `home-mixer/candidate_pipeline/phoenix_candidate_pipeline.rs`
- Rust recommendation no longer treats ranking as a single opaque `/ranking` provider call.
- Rust now executes the stage boundary explicitly as:
  - `hydrate`
  - `filter`
  - `score`
  - `selector`
  - `post-selection hydrate`
  - `post-selection filter`
- Runtime metadata now exposes separate stage groups for:
  - `candidateHydrators`
  - `postSelectionHydrators`
  - `postSelectionFilters`
- The Rust ops surface now exposes `stageExecutionMode = rust_orchestrated_explicit_provider_stages`.
- Pipeline naming was advanced to `pipelineVersion = xalgo_candidate_pipeline_v3`.
- The Rust-side pipeline definition now matches the active provider stage names more closely:
  - query hydrators now use concrete provider names such as `UserFeaturesQueryHydrator`
  - candidate hydrators no longer incorrectly include VF hydration
  - post-selection hydration is now surfaced explicitly as `VFCandidateHydrator`
  - pre-score filter names now match the Node provider surface
  - scorer list now includes the active `EngagementScorer`

## Current Owner Boundary

- `owner = rust`
- `fallbackMode = node_provider_surface_with_cpp_graph_primary`
- Rust now owns:
  - stageful execution order
  - source orchestration
  - graph primary retrieval orchestration
  - ranking-stage composition
  - selector execution
  - post-selection stage ordering
  - runtime contract and ops reporting
- Node now provides only narrow recommendation stage surfaces for:
  - query hydration data
  - individual source materialization
  - candidate hydration
  - candidate filtering
  - candidate scoring
  - post-selection hydration/filtering

## Remaining Gaps

- Query hydrators are still executed through a composite Node provider endpoint rather than separate per-hydrator RPC calls.
- Candidate hydrators and scorers still execute inside the Node provider surface rather than inside Rust-native component implementations.
- Side effects remain lightweight and have not yet been expanded into richer request-cache / serve-log / replay semantics.
- Parallel execution semantics still differ from `x-algorithm`'s reusable candidate-pipeline crate because Rust currently fans out by stage-provider surfaces rather than per-component RPC units.

## Rollout Notes

- This phase is still client-safe and does not require frontend protocol changes.
- Recommended production checks after deploy:
  - `/api/ops/recommendation`
  - `/ops/recommendation`
  - `/ops/recommendation/summary`
  - verify `pipelineVersion = xalgo_candidate_pipeline_v3`
  - verify `stageExecutionMode = rust_orchestrated_explicit_provider_stages`
  - verify `postSelectionHydrators = [VFCandidateHydrator]`
  - verify `postSelectionFilters = [VFFilter, ConversationDedupFilter]`
