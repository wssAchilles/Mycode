# Analytics To Recommendation Bridge Drift Check

## upstream paths read

- https://github.com/xai-org/x-algorithm/tree/main/candidate-pipeline
- https://github.com/xai-org/x-algorithm/tree/main/home-mixer

## local paths changed

- `telegram-clone-backend/src/services/eventStreamService.ts`
- `telegram-clone-backend/src/services/recommendation/hydrators/UserActionSeqQueryHydrator.ts`
- `telegram-clone-backend/src/scripts/replayUserActionsToSignals.ts`

## alignment decisions

- Keep analytics bridge as side-effect style ingestion into durable action/signal stores.
- Resolve non-post targets before calling the recommendation event recorder.
- Continue using query hydrators to expose engagement history to recommendation runtime.

## known deviations

- Redis Streams are optional locally; bridge now still writes durable recommendation records without Redis.
- Search/topic/link actions do not create RealGraph edges unless downstream services explicitly support them.

## follow-up risks

- Redis realtime feature keys will include new event types only when Redis is available.
- Backfill scripts may need more scoring semantics if new action types become ranking labels.
