# Phase 25 Platform Bus Parity

Last updated: 2026-04-17

## Summary

- Owner: `go`
- Primary topics: `sync_wake_requested`, `presence_fanout_requested`, `notification_dispatch_requested`
- Replay stream: `platform:events:replay:v1`
- Delivery of online socket/session fanout remains owned by Rust realtime edge and is intentionally out of scope for Go.

## Completed

- [x] `telegram-go-delivery-consumer/internal/platform` expanded into topic-oriented modules:
  - `syncwake/`
  - `presence/`
  - `notification/`
  - `replay/`
  - `ops/`
- [x] Presence and notification defaults promoted from `shadow` to `publish`
- [x] Unified platform dispatch result now records `executed / shadowed / fallback / replayed`
- [x] Platform replay stream introduced: `platform:events:replay:v1`
- [x] `/ops/summary` now exposes:
  - `platformReplayStreamKey`
  - `platformTopicModes`
  - `platformTopics`
- [x] Per-topic platform summary now records:
  - execution counters
  - fallback counters
  - replay counters
  - last reason
  - last replay id / stream
  - last lag milliseconds

## Remaining

- [ ] Dedicated replay consumer / operator endpoint for replay drain and manual re-drive
- [ ] Cross-service fallback handoff beyond replay record creation
- [ ] VPS env convergence to ensure older explicit `shadow` values are removed from shared runtime

## Rollout Notes

- Phase 25 keeps Redis Streams as the control surface and does not introduce Kafka/NATS.
- Poison platform messages still route to platform DLQ.
- Executable-but-degraded platform events now prefer replay over silent drop or direct DLQ.
