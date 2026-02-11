# News Corpus Contract (externalId)

To align with the `x-algorithm` "global corpus + model-first ranking" approach, Space Feed treats
**news** as the default Out-of-Network (OON) corpus.

## Required Fields (for ANN + Phoenix)

A news post can participate in ANN retrieval and Phoenix ranking only if it has:
- `isNews = true`
- `newsMetadata.externalId` (string, stable id in the model vocabulary, e.g. `N12345`)

## Mapping Rule

Models operate on `externalId`, but the backend serves Mongo posts by `_id`.

Therefore:
- ANN returns `externalId` -> backend maps it via `posts.newsMetadata.externalId` -> serves Post `_id`
- Phoenix predictions are keyed by `externalId` -> backend maps them back to candidates by `externalId`

## Crawler News vs Imported Corpus

- Crawler-inserted news that only has canonical URL (no externalId) may still be served as content,
  but it will **not** be personalized by ANN/Phoenix. It will rely on degrade paths (e.g. recency).
- Imported corpora (e.g. MIND) should always populate `newsMetadata.externalId`.

