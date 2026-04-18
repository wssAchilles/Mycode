# Phase 28 Recommendation Graph Provider Parity

Last updated: 2026-04-18

## Summary

- Owner: `rust`
- Graph kernel query owner: `rust -> cpp`
- Graph author materialization owner: `node`
- Current graph provider mode:
  `cpp_graph_kernel_primary_with_node_materializer_fallback`

## Completed

- [x] Rust recommendation adds a dedicated C++ graph kernel client instead of routing `GraphSource` entirely through Node `/internal/recommendation/sources/GraphSource`
- [x] Rust source orchestrator now handles `GraphSource` in a dedicated runtime module instead of leaving all graph orchestration inside the generic backend provider surface
- [x] Rust graph retrieval now issues explicit kernel calls for:
  - `social-neighbors`
  - `recent-engagers`
  - `co-engagers`
  - `content-affinity-neighbors`
  - `bridge-users`
- [x] Rust now owns graph author aggregation and graph recall metadata shaping:
  - `cpp_graph_social_neighbor`
  - `cpp_graph_recent_engager`
  - `cpp_graph_bridge_user`
  - `cpp_graph_co_engager`
  - `cpp_graph_content_affinity`
  - `cpp_graph_multi_signal`
- [x] Node backend now exposes a narrow graph provider surface at:
  - `/internal/recommendation/providers/graph/authors`
- [x] Node `GraphSource` no longer keeps its own inline author-post aggregate query block; it reuses the shared graph author materializer
- [x] Rust recommendation ops/runtime now exposes:
  - `pipelineVersion = xalgo_builder_v2`
  - `fallbackMode = node_provider_surface_with_cpp_graph_primary`
  - `graphProviderMode = cpp_graph_kernel_primary_with_node_materializer_fallback`
  - `graphKernelUrl`
  - graph materializer parameters

## Current Owner Boundary

- Rust owns:
  - graph kernel query fan-out
  - graph author score aggregation
  - graph recall type assignment
  - graph path / score shaping
  - graph-provider control-plane summary
- C++ owns:
  - graph kernel retrieval endpoints
  - kernel-side scoring primitives
  - snapshot-backed retrieval execution
- Node now owns only:
  - author-post materialization provider
  - legacy `GraphSource` fallback surface
  - recommendation adapter compatibility layer

## Remaining

- [ ] Rust still depends on Node for graph author post materialization and does not yet own post-fetch/provider hydration directly
- [ ] Other recommendation source/hydrator/filter/scorer stages still rely on Node provider surfaces and have not been split into narrower RPC contracts
- [ ] Graph fallback still returns to Node legacy `GraphSource` when direct kernel retrieval is unavailable or empty
- [ ] No dedicated Rust-side operator endpoint yet exists for per-kernel fallback diagnostics or graph replay inspection

## Rollout Notes

- This phase does not change the public feed API contract.
- Existing Node fallback remains available for degraded recovery.
- Recommended production checks after deploy:
  - `/ops/recommendation`
  - `/ops/recommendation/summary`
  - verify `pipelineVersion = xalgo_builder_v2`
  - verify `fallbackMode = node_provider_surface_with_cpp_graph_primary`
  - verify `graphProviderMode = cpp_graph_kernel_primary_with_node_materializer_fallback`
  - verify `providerCalls` contains `graph_kernel/*` and `providers/graph/authors`
