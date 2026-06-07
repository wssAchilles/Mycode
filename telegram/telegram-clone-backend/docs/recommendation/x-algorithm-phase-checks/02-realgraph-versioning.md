# Phase 02 - RealGraph Versioning

## Upstream paths read

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/tree/main/home-mixer
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md

## Local paths changed

- `src/models/RealGraphEdge.ts`
- `src/services/recommendation/RealGraphService.ts`
- `src/scripts/backfillRealGraphPredictionMetadata.ts`
- `package.json`

## Alignment decisions

- Aligned to Home Mixer user context and graph-feature thinking by making graph scores versioned and auditable.
- Added heuristic prediction metadata instead of pretending a trained RealGraph model exists.
- Recomputed batch `decayedSum` so UserSignal batch writes affect graph ranking features immediately.

## Known deviations

- `predictionMode=heuristic` is a local rules engine, not a learned upstream RealGraph model.
- Graph features are still stored in Mongo and exported to the local graph kernel rather than a dedicated graph feature store.

## Follow-up risks

- Run `npm run backfill:realgraph-predictions -- --dry-run --limit 100` before any write backfill.
- Graph kernel snapshot export should be checked after backfill to verify new metadata is visible to ops.
