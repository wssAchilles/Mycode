# Recommendation Industrialization Checklist

## Rollout Gates

- Rust primary fallback rate is below 1% for 24 hours.
- Graph kernel diagnostics are present on at least 99% of graph source requests.
- Replay logging readiness has zero missing rank, requestId, recallSource, score, experiment key, and post/model id join fields on sampled requests.
- News feed events bridge to recommendation events for impression, click, dwell, like, dismiss, report, block, and mute.
- Embedding contract audit reports zero enabled-source incompatibilities.
- Daily recommendation refresh is the only default scheduled RealGraph and SimClusters owner.

## Release Evidence

- `tests/ops/recommendationOpsReadiness.test.ts` passes.
- `npm run audit:embedding-contracts -- --limit 5000` reports zero incompatible sampled vectors.
- `cargo test -p telegram-rust-recommendation replay` passes.
- Ops readiness blockers are empty before promoting Rust primary beyond shadow/canary.

## Delayed Algorithm Work

- Full SimClusters training starts only after event and feature contracts are stable.
- TwHIN starts only after entity/relation schema and offline samples are versioned.
- GNN retrieval starts only after LightGCN or sparse community vectors beat simple baselines in replay.
- Online learning starts only after propensity or randomized exploration logs exist.
