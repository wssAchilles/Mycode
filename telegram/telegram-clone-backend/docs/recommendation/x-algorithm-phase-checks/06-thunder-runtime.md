# Phase 06 - Thunder Runtime

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/thunder
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md

## Local paths changed

- `src/services/recommendation/InNetworkTimelineService.ts`
- `src/services/recommendation/sideeffects/ServeCacheSideEffect.ts`
- `src/scripts/smokeRecommendationRedisRuntime.ts`
- `package.json`

## Alignment decisions

- Aligned to Thunder-like realtime ingestion by keeping recent author timelines in Redis.
- Added `timeline:author:{authorId}` alongside the existing `tl:author:{authorId}` key to match the planned runtime key contract.
- Added `recommendation:serve:v1:{userId}` served-history keys while keeping the old `serve:{userId}` key compatible.

## Known deviations

- Redis remains runtime cache only; no long-term user features are moved there.
- The smoke script verifies runtime keys but does not call a full authenticated feed endpoint.

## Follow-up risks

- Existing filters still read `serve:{userId}` in some paths; migrate reads to the new prefix after Rust and Node agree on the key contract.
