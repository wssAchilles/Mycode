# Phase 31 Graph Kernel Diagnostics Parity

## Completed

- This phase was aligned against the public reference repositories through GitHub MCP reads of:
  - `xai-org/x-algorithm/home-mixer/candidate_pipeline/phoenix_candidate_pipeline.rs`
  - `ultraworkers/claw-code/PARITY.md`
- C++ graph kernel responses now expose additive per-request `diagnostics` for graph query routes, including:
  - `kernel`
  - `queryDurationMs`
  - `candidateCount`
  - `empty`
  - `emptyReason`
  - `relationKinds`
- C++ `/ops/graph` and `/ops/graph/summary` now expose per-kernel:
  - `kernelLatency`
  - `emptyReasonCounts`
  - existing `kernelQueryCounts`
  - existing `sourceEmptyRate`
- Rust graph source now consumes graph-kernel diagnostics instead of treating C++ as an opaque candidate-only surface.
- Rust graph retrieval summary now exposes:
  - `perKernelCandidateCounts`
  - `perKernelLatencyMs`
  - `perKernelEmptyReasons`
  - `perKernelErrors`
  - `dominantKernelSource`
  - `dominanceShare`
- Rust graph aggregate reason taxonomy is now normalized to:
  - `all_kernels_empty`
  - `all_kernels_failed`
  - `partial_kernel_failure`
  - `authors_materialized_empty`
  - `legacy_fallback_used`
- A machine-readable readiness check for this phase now exists at:
  - `deploy/vps/check_phase_31_graph_readiness.sh`

## Current Owner Boundary

- `graph owner = cpp`
- `recommendation owner = rust`
- C++ now owns:
  - kernel query diagnostics
  - per-kernel latency accounting
  - per-kernel empty reason accounting
  - graph data-plane HTTP retrieval
- Rust now owns:
  - graph kernel fan-out scheduling
  - graph diagnostic aggregation
  - dominant kernel calculation
  - graph degrade / fallback normalization
- Node remains limited to:
  - graph snapshot contract owner
  - author materializer provider
  - control-plane aggregation

## Remaining Gaps

- Node author materialization is still required on the primary graph path, so graph retrieval is not yet fully end-to-end Rust/C++ only.
- `legacy_fallback_used` can still appear for sparse users or materializer-path issues; Phase 31 makes this explicit but does not remove the fallback itself.
- C++ kernel diagnostics are now machine-readable, but there is still no dedicated historical dashboard for long-window latency analysis.

## Rollout Notes

- This phase is additive and does not change the frontend contract.
- Recommended checks after deploy:
  - `GET /api/ops/recommendation`
  - `GET /ops/graph`
  - `GET /ops/graph/summary`
  - `bash deploy/vps/check_phase_31_graph_readiness.sh`
- Healthy Phase 31 signals are:
  - `ownership.graph.owner = cpp`
  - `graphKernel.requests.kernelLatency` populated
  - `graphKernel.requests.emptyReasonCounts` populated
  - `rustRecommendation.summary.lastGraphPerKernelCandidateCounts` populated
  - `rustRecommendation.summary.lastGraphPerKernelLatencyMs` populated
  - `rustRecommendation.summary.lastGraphDominantSource` stable

## Smoke Checklist

- Frontend login and feed load remain unchanged
- `/api/ops/recommendation` shows Rust recommendation and C++ graph ownership
- Graph kernel query responses include a non-empty `diagnostics.kernel`
- Rust graph summary no longer collapses all empty cases into a single `graph_candidates_empty`
- Partial kernel failure and legacy fallback are machine-readable from the control plane
