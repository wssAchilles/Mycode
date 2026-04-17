# Phase 24 Recommendation Parity

## Completed

- Rust recommendation now owns pipeline assembly through `RecommendationPipelineBuilder`.
- The service is restructured around `clients/`, `pipeline/`, `server/`, `query_hydrators/`, `sources/`, `candidate_hydrators/`, `filters/`, `scorers/`, `selectors/`, `side_effects/`, `state/`, `ops/`, and `contracts/`.
- The old flat execution paths under `adapters/`, `candidate_pipeline/`, and `http/` were removed from the active code path.
- Runtime and response contracts now expose:
  - `pipelineVersion`
  - `owner`
  - `fallbackMode`
  - `providerCalls`
- Rust ops now reports the configured stage groups instead of only the coarse retrieval/ranking mode.

## Current Owner Boundary

- `owner = rust`
- `fallbackMode = node_provider_surface`
- Rust owns:
  - stage ordering
  - source ordering
  - selector execution
  - side-effect execution
  - runtime contract and ops shape
- Node still provides:
  - query hydration payloads
  - per-source candidate provider endpoints
  - composite ranking surface
  - post-selection hydrate/filter surfaces

## Remaining Gaps

- Query hydrators are modeled explicitly in Rust, but still backed by the Node provider surface.
- Candidate hydrators, pre-scoring filters, and scorers are represented as named stage groups, but composite execution is still supplied by the Node ranking provider.
- Rust has not yet split ranking provider calls into fully independent hydrator/filter/scorer RPC surfaces.
- Side effects are still lightweight and primarily centered on recent-serve cache plus metrics tracking.

## Rollout Notes

- This phase is safe to deploy without client changes.
- Rust remains the only public recommendation orchestrator endpoint at `/recommendation/candidates`.
- The recommended production check after deploy is:
  - `/ops/recommendation`
  - `/ops/recommendation/summary`
  - verify `pipelineVersion = xalgo_builder_v1`
  - verify `owner = rust`
  - verify `fallbackMode = node_provider_surface`
