# Phase 32 Platform Replay Operator Parity

## Completed

- This phase was aligned against the public reference repositories through GitHub MCP reads of:
  - `ultraworkers/claw-code/PARITY.md`
- Go platform bus now exposes a topic-first replay operator instead of treating replay as a write-only Redis side stream.
- Replay stream records now carry the Phase 32 contract fields:
  - `event_id`
  - `topic`
  - `status`
  - `reason`
  - `channel`
  - `lag_ms`
  - `attempt`
  - `replay_kind`
  - `recorded_at`
  - `partitionKey`
  - `event`
- Go now exposes:
  - `GET /ops/platform/replay/summary`
  - `POST /ops/platform/replay/drain`
- Replay drain uses:
  - idempotency key `topic:event_id`
  - completed-state hash `platform:events:replay:v1:completed`
  - single-topic drain concurrency `1`
  - cross-topic operator concurrency `3`
- Manual drain attempts now append replay audit records back into the replay stream with:
  - `status = completed` when the topic handler finishes cleanly
  - `status = replayed` when the handler still lands in shadow/fallback/failed state
- Node `/api/ops/platform-bus` now aggregates the Go replay operator summary but does not execute replay itself.
- A machine-readable readiness check for this phase now exists at:
  - `deploy/vps/check_phase_32_platform_replay_readiness.sh`

## Current Owner Boundary

- `platform owner = go`
- Go now owns:
  - replay backlog summarization
  - replay drain execution
  - completed-state idempotency
  - topic-scoped replay accounting
- Node remains limited to:
  - public control-plane aggregation
  - capability ownership summary
  - fallback visibility
- Rust remains the only owner for realtime socket session paths.

## Remaining Gaps

- Replay summary is currently request-time computed from Redis state; there is still no long-window historical dashboard for replay pressure.
- The operator is intentionally best-effort and audit-first; it does not yet support scheduled background drain policies.
- Replay contract is topic-first and machine-readable now, but there is still no dedicated UI surface for operators beyond the JSON control plane.

## Rollout Notes

- This phase does not change the frontend contract.
- Recommended checks after deploy:
  - `GET /api/ops/platform-bus`
  - `GET /ops/platform/replay/summary`
  - `POST /ops/platform/replay/drain`
  - `bash deploy/vps/check_phase_32_platform_replay_readiness.sh`
- Healthy Phase 32 signals are:
  - `ownership.owner = go`
  - `replay.summary.available = true`
  - `replay.summary.runtime.singleTopicDrainConcurrency = 1`
  - `replay.summary.runtime.crossTopicDrainConcurrency = 3`
  - `runtime.platformReplayCompletedKey` populated
  - replay backlog can be drained without duplicating a `topic:event_id`

## Smoke Checklist

- Frontend login and feed load remain unchanged
- `/api/ops/platform-bus` shows replay summary nested under the Go platform owner
- `/ops/platform/replay/summary` returns backlog, completed keys, per-topic status counts, last error class, attempt count, and topic lag
- `/ops/platform/replay/drain` can target a single topic without touching unrelated topics
- Re-running drain after a `completed` record does not publish the same `topic:event_id` again
