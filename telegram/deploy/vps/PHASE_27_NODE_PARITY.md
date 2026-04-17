# Phase 27 Node Parity

Last updated: 2026-04-17

## Summary

- Owner: `node`
- Target shape: `API + control-plane + fallback plane`
- Node strategic responsibilities:
  - `public_rest_api`
  - `auth`
  - `uploads`
  - `data_access`
  - `control_plane`
  - `fallback_adapters`

## Completed

- [x] Node control-plane now exposes a unified capability owner summary at:
  - `/api/ops/capabilities`
  - `/api/ops/control-plane`
  - `/api/ops/control-plane/summary`
- [x] Capability summary explicitly records current owners for:
  - `realtime`
  - `recommendation`
  - `platform`
  - `graph`
- [x] Node ops now records the live fallback posture for each capability instead of only showing local Node config fragments
- [x] `/api/ops/platform-bus` now prefers Go consumer runtime modes for ownership reporting, instead of stale Node-only env defaults
- [x] `/api/ops/realtime` and `/api/ops/recommendation` now surface ownership records alongside the existing runtime/ops payloads
- [x] `/health` now includes Node strategic shape and capability-owner summary text so VPS smoke checks can confirm the shrink target without separate deep inspection

## Current Owner Boundary

- `realtime owner = rust`
  - Node role: `compat_transport_shim`, `event_publisher`, `fallback_emitter`
- `recommendation owner = rust`
  - Node role: `provider_surface`, `api_adapter`, `shadow_compare`
- `platform owner = go`
  - Node role: `control_plane`, `event_publisher`, `fallback_adapter`
- `graph owner = cpp`
  - Node role: `provider_surface`, `fallback_adapter`

## Remaining

- [ ] `SocketService` is still a large legacy compatibility unit and has not yet been physically split into `compat shim / event publisher / fallback emitter` submodules
- [ ] Legacy recommendation and graph fallback code paths still exist in-process for degraded recovery, even though they are no longer the intended primary owners
- [ ] Node still hosts some historical runtime logic that should eventually be pushed fully behind provider or fallback surfaces

## Rollout Notes

- Phase 27 does not change public frontend contracts.
- This phase is primarily a control-plane and owner-boundary consolidation.
- Recommended production checks after deploy:
  - `/health`
  - `/api/ops/capabilities`
  - `/api/ops/control-plane`
  - `/api/ops/realtime`
  - `/api/ops/platform-bus`
  - `/api/ops/recommendation`
