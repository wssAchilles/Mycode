# Phase 01 - Event Capture

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/candidate-pipeline
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md

## Local paths changed

- `src/services/recommendation/events/*`
- `src/services/eventStreamService.ts`
- `src/services/recommendation/sideeffects/ServeCacheSideEffect.ts`
- `src/services/recommendation/sideeffects/ImpressionLogger.ts`
- `src/services/spaceService.ts`
- `tests/recommendation/recommendationEventMapping.test.ts`

## Alignment decisions

- Adopted the Candidate Pipeline idea that side effects and engagement history should be explicit pipeline boundaries.
- Centralized recommendation event recording so durable actions, realtime signals, and RealGraph updates grow from the same input event.
- Kept the local TypeScript service boundary instead of copying upstream directories.

## Known deviations

- Delivery remains action-only and does not create a UserSignal because it is serving evidence, not user intent.
- Event capture is best-effort in side effects and does not block feed serving.

## Follow-up risks

- Remaining direct `UserAction.logActions` calls in route helpers and reporting scripts should be audited before deleting legacy fallback writes.

## Registered user coverage follow-up

- Added registered-user cold-start feature bootstrap so Postgres `users.id` is the canonical recommendation user id.
- Hooked registration to create a recommendation feature vector asynchronously.
- Backfilled 642 Postgres registered users:
  - existing feature vectors: 73
  - created cold-start vectors: 569
  - registered user vector coverage after backfill: 642 / 642
- Replayed 195 `contacts` rows into recommendation signals and RealGraph interactions.
