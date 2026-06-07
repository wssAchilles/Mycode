# Demo Interviewer Social Graph Expansion Drift Check

## Upstream paths read

- `https://github.com/xai-org/x-algorithm/blob/main/README.md`
- `https://github.com/xai-org/x-algorithm/tree/main/home-mixer`
- `https://github.com/xai-org/x-algorithm/tree/main/candidate-pipeline`
- `https://github.com/xai-org/x-algorithm/tree/main/thunder`

## Local paths changed

- `src/scripts/demo/expandDemoInterviewerSocialGraph.ts`
- `package.json`

## Alignment decisions

- Home Mixer: expanded `demo_interviewer` context with followed users, engagement history, post snapshots, and RealGraph edges so query hydrators have real data to read.
- Candidate Pipeline: generated data across source-like posts, hydrator-ready snapshots, scorer-ready engagement stats, and side-effect records (`UserAction`, `UserSignal`, Redis timeline).
- Thunder: wrote all generated posts into both author timeline key formats through `InNetworkTimelineService.addPost`.
- Phoenix-style retrieval/ranking: materialized post feature snapshots and kept keywords/engagement metadata on generated posts for graph, embedding, and popular retrieval lanes.

## Known deviations

- This phase uses deterministic demo data generation rather than a live Kafka ingestion stream.
- RealGraph remains heuristic-versioned (`heuristic_realgraph_v1`) instead of a trained model prediction.
- UserSignal rows are rebuilt under this script namespace on rerun because the current schema has no unique idempotency key for `metadata.demoExpansionId`.

## Follow-up risks

- `UserSignal` should eventually add a stable unique idempotency key if large replay jobs become common.
- Demo posts use English language tags to avoid MongoDB text-index language override failures for unsupported language codes.
- Large cloud writes still take minutes because several existing collections lack bulk replay indexes.
