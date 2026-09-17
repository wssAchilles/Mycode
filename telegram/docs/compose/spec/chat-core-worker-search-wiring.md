---
feature: chat-core-worker-search-wiring
status: designed
updated: 2026-07-16
branch: feat/worker-cron-auth
commits: 
---

# ChatCore Worker Search Modular Wiring

## Report

## [S1] Problem

`chatCore.worker.ts` (~4965 lines) still inlines search (haystack cache, remote search, merge). `chatCore/searchBridge.ts` already implements the same responsibility as a module but is unused by the production worker. `chatCore.worker.new.ts` is incomplete (TODOs) and must not be used as the worker entry.

## [S2] Design

**Strategy:** keep `chatCore.worker.ts` as the production entry. Wire **search only** to `SearchBridge`; leave socket/sync/persistence/ingest on the existing monolith paths.

1. Instantiate `SearchBridge` in the worker with a context that binds existing state (`apiBaseUrl`, `currentUserId`, wasm ref, telemetry).
2. Route the public `ChatCoreApi.searchMessages` through `searchBridge.search(...)` (exact public method name to match the module).
3. Keep search-related cache invalidation hooks that the monolith already calls (e.g. on message load/save) if they are exported from SearchBridge; otherwise preserve existing monolith invalidation functions used by other paths—do not delete non-search helpers still referenced elsewhere.
4. Do **not** switch `workerBridge.ts` to `chatCore.worker.new.ts`.
5. Prefer deleting dead inlined search helpers **only if** nothing else references them; otherwise leave them and only change the `searchMessages` API path (smallest safe diff).

**Contracts:**

- `ChatCoreApi.searchMessages` signature and return type unchanged.
- Worker still exposed via Comlink from `chatCore.worker.ts`.
- `npm run check:worker-first` and existing worker-related vitest remain green.

## [S3] Out of Scope

- Completing `chatCore.worker.new.ts` TODOs
- Switching production entry to `.new.ts`
- Socket/sync/persistence modular cutover
- Changing search ranking semantics

## Tasks

- [ ] T1: Bind SearchBridge in chatCore.worker.ts and delegate searchMessages — acceptance: searchMessages uses SearchBridge; entry file remains chatCore.worker.ts (covers: S2)
- [ ] T2: Remove or isolate now-unused inlined search only if unreferenced — acceptance: tsc + vitest worker/search related pass (covers: S2; depends: T1)
- [ ] T3: Frontend verification — acceptance: tsc --noEmit; check:worker-first or focused vitest green (covers: S2; depends: T2)
