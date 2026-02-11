# Space Feed Recsys Experiments

This project uses the Experiment framework to gate non-essential heuristics and optional sources.

## Experiment Id

Default experiment id used by the Space Feed pipeline:
- `space_feed_recsys`

You can override it via env:
- `SPACE_FEED_EXPERIMENT_ID`

## Config Keys

All keys below are read via:
`experimentContext.getConfig("space_feed_recsys", key, defaultValue)`

### Sources
- `enable_popular_source` (bool, default: false)
- `enable_two_tower_source` (bool, default: false)

### Scorers (heuristics)
- `enable_content_quality_scorer` (bool, default: false)
- `enable_author_affinity_scorer` (bool, default: false)
- `enable_recency_scorer` (bool, default: false)

### Safety (VF policy)
- `vf_in_network_allow_low_risk` (bool, default: env `VF_IN_NETWORK_ALLOW_LOW_RISK` or true)
- `vf_oon_allow_low_risk` (bool, default: env `VF_OON_ALLOW_LOW_RISK` or false)

## Offline Reports

Recall source industrial report:
- `npm run report:recall-source -- --days 14 --windowHours 24`

Training sample export (NDJSON):
- `npm run export:recsys-samples -- --days 30 --windowHours 24 --output ./tmp/recsys_samples.ndjson`

Both tools are based on `IMPRESSION` + action window labels and support filtering by:
- `--experimentKey <experimentId:bucket>`
- `--surface <productSurface>` (default `space_feed`)
- `--recallSource <sourceName>`

## Notes

- All heuristics are **disabled by default** to align with the "model-first, minimal heuristics" principle.
- When enabled, heuristic scorers must adjust `weightedScore` only (see `score-contract.md`).
