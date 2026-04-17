# Phase 26 Graph Parity

Last updated: 2026-04-17

## Summary

- Owner: `cpp`
- Snapshot contract owner: `node`
- Graph sub-source aggregation owner: `node -> rust summary`
- Primary kernels:
  - `social_neighbors`
  - `recent_engagers`
  - `co_engagers`
  - `content_affinity_neighbors`
  - `bridge_users`

## Completed

- [x] C++ graph service now accepts versioned snapshot pages with:
  - `snapshotVersion`
  - `edgeKinds`
  - extended signal counts for `addressBook`, `directMessage`, `coEngagement`, `contentAffinity`
- [x] C++ graph store metadata now records:
  - `snapshotVersion`
  - `snapshotAgeSecs`
  - `edgeKinds`
- [x] C++ graph retrieval surface now exposes:
  - `/graph/co-engagers`
  - `/graph/content-affinity-neighbors`
- [x] C++ ops now reports:
  - `kernelQueryCounts`
  - `sourceEmptyRate`
  - snapshot edge-kind breakdown
- [x] Node graph snapshot service now exports:
  - `snapshotVersion`
  - per-edge `edgeKinds`
  - new signal families for `chat/dm`, `co-engagement`, `content-affinity`
- [x] Node recommendation `GraphSource` now aggregates five explicit kernel sub-sources instead of only three:
  - `social_neighbor`
  - `recent_engager`
  - `bridge_user`
  - `co_engager`
  - `content_affinity`
- [x] Rust recommendation graph summary already consumes `cpp_graph_*` recall types, so new kernel source counts flow through without additional Rust-side schema changes

## Remaining

- [ ] Snapshot generation is still derived from `RealGraphEdge` rollups rather than a dedicated graph snapshot build pipeline
- [ ] `edgeKinds` are heuristic rollups and not yet backed by a stricter versioned schema registry
- [ ] Rust graph source execution is still mediated through the Node provider surface rather than direct C++ client calls
- [ ] No dedicated operator endpoint exists yet for per-kernel replay or backfill diagnostics

## Rollout Notes

- Phase 26 does not add new infrastructure and stays on HTTP + Redis + existing backend snapshot flow.
- Existing graph routes remain compatible; the new kernel routes are additive.
- Recommended production checks after deploy:
  - `/ops/graph`
  - `/ops/graph/summary`
  - confirm `snapshotVersion` is present
  - confirm `edgeKinds` includes the expanded graph semantics
  - confirm `kernelQueryCounts` and `sourceEmptyRate` are populated after recommendation traffic
