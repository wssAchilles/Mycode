# Phase 03 - News Materialization

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/phoenix
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/phoenix/README.md

## Local paths changed

- `src/models/Post.ts`
- `src/services/recommendation/newsMaterialization/*`
- `src/scripts/materializeNewsArticlesToPosts.ts`
- `package.json`

## Alignment decisions

- Aligned to Phoenix retrieval by giving news a stable candidate id space through `newsMetadata.externalId`.
- Materialized Postgres `news_articles` into Mongo `posts` so ANN retrieval can hydrate candidates through the normal Post pipeline.
- Reused `PostFeatureSnapshotService` after materialization to keep retrieval/ranking features close to serving data.

## Known deviations

- This phase does not add a Phoenix transformer ranker; it only stabilizes corpus serving.
- News author identity is a service account `news_bot_official`.

## Follow-up risks

- Run materialization in dry-run and then a small batch before wider backfill.
- Verify `posts.isNews=true` count and `NewsAnnSource` externalId hydration after the first write batch.
