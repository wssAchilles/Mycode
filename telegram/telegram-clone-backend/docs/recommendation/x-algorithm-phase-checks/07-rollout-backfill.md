# Phase 07 - Rollout And Backfill

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/candidate-pipeline
- https://github.com/xai-org/x-algorithm/tree/main/home-mixer
- https://github.com/xai-org/x-algorithm/tree/main/phoenix
- https://github.com/xai-org/x-algorithm/tree/main/thunder

## Local paths changed

- `src/scripts/backfillRealGraphPredictionMetadata.ts`
- `src/scripts/materializeNewsArticlesToPosts.ts`
- `src/scripts/auditEmbeddingContracts.ts`
- `src/scripts/smokeRecommendationRedisRuntime.ts`
- `package.json`

## Alignment decisions

- Backfill scripts are idempotent and support `--dry-run`, `--limit`, `--since`, and `--batch` where mutation is possible.
- Rollout is staged around shadow/fallback evidence, not a hard switch.
- Validation is data-oriented: table growth, version coverage, news materialization, Redis runtime keys, and trace fallback reduction.

## Known deviations

- This phase does not execute cloud backfills automatically.
- UserAction-to-UserSignal historical replay remains a follow-up because the new write path prevents future drift first.

## Follow-up risks

- Execute write backfills only after dry-run output is reviewed.
- Add a historical replay script for old `user_actions` if production data needs past UserSignal reconstruction.

## Execution evidence

Dry-run was executed before writes:

- RealGraph prediction metadata: matched 20, dryRun true.
- UserAction replay: scanned 20, signalCandidates 10, dryRun true.
- News materialization: scanned 20, dryRun true.
- Embedding contract backfill: matched 73 user vectors and 85 post feature snapshots, dryRun true.

Small write batch was then executed:

- RealGraph prediction metadata: matched 20, updated 20.
- UserAction replay: scanned 20, insertedSignals 10.
- News materialization: scanned 20, upserted 20, snapshotRequested 20.
- Embedding contract backfill: updated 73 user vectors and 85 post feature snapshots.
- Redis smoke: `timeline:author:evidence_author` contains `evidence_post_001`; `recommendation:serve:v1:evidence_user` contains `evidence_post_001`.

Post-write database evidence:

- Mongo `user_signals`: 172, including 148 with `metadata.replayedFrom=user_actions`.
- Mongo `real_graph_edges` with `modelVersion=heuristic_realgraph_v1`, `predictionMode=heuristic`, and `lastPredictionAt`: 324.
- Mongo `posts.isNews=true`: 833.
- Mongo `post_feature_snapshots`: 918, including 833 news snapshots.
- Mongo user embedding contracts: 73.
- Mongo post embedding contracts: 918.
- Postgres `news_articles`: 833.
- Redis `timeline:author:*` keys: 2.
- Redis `recommendation:serve:v1:*` keys: 1.
- Redis final smoke evidence: `timeline:author:evidence_author_final` contains `evidence_post_final_001`; `recommendation:serve:v1:evidence_user_final` contains `evidence_post_final_001`.
