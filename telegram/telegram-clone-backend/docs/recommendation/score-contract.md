# Space Feed Scoring Contract (Industrial Alignment)

This document defines the **field-level contract** for Space Feed candidates so the scoring pipeline
remains coherent and debuggable as we iterate.

## Candidate Fields

### `phoenixScores`
- Meaning: Multi-action engagement predictions (or rule fallback).
- Producer:
  - `PhoenixScorer` (preferred, model-based; news externalId only)
  - `EngagementScorer` (fallback-only; must not override meaningful Phoenix predictions)

### `weightedScore`
- Meaning: The **normalized** weighted combination of `phoenixScores`.
- Producer: `WeightedScorer`
- Notes:
  - `weightedScore` is the only output of `WeightedScorer`.
  - Do not apply OON downweighting here; that belongs to `OONScorer`.

### `score`
- Meaning: Final score used for selection + post-selection (e.g. conversation dedup).
- Producers (in strict order):
  1. `AuthorDiversityScorer` (writes `score` from `weightedScore`)
  2. `OONScorer` (surface-aware adjustment on `score`, only for `inNetwork === false`)
- Rule: No other component may overwrite `score` in the default pipeline.

### `recallSource`
- Meaning: The retrieval source attribution for each candidate.
- Producer: `RecommendationPipeline.fetchCandidates()` (auto inject by source component name)
- Rule: Used for analysis/experiments/training logs; should be stable (`FollowingSource`, `NewsAnnSource`, etc.).

### `_scoreBreakdown` / `_pipelineScore` (debug only)
- Meaning:
  - `_scoreBreakdown`: merged per-scorer score contributions from pipeline wrapper.
  - `_pipelineScore`: selector input score after scorer chain.
- Producer: `RecommendationPipeline.selectCandidates()` when debug is enabled.
- Rule: Not a business contract field; only for debugging and observability.

## Default Scoring Order

1. `PhoenixScorer`
2. `EngagementScorer` (fallback-only)
3. `WeightedScorer` -> writes `weightedScore`
4. Optional experiment scorers (must adjust `weightedScore`, not `score`)
5. `AuthorDiversityScorer` -> writes `score`
6. `OONScorer` -> adjusts `score`

## Logging Contract (Training Data Readiness)

For `ActionType.IMPRESSION` and `ActionType.DELIVERY`, log at least:
- `requestId`
- `rank` (1-based position)
- `score`
- `weightedScore`
- `inNetwork`
- `isNews`
- `modelPostId`
- `recallSource`
- `experimentKeys` (e.g. `space_feed_recsys:treatment`)

## Experiment Policy

Any heuristic scorer (recency, content quality, affinity, extra retrieval sources) must be:
- disabled by default
- enabled only via `experimentContext.getConfig(...)`
- applied in a way that preserves the contract above (prefer operating on `weightedScore`)
