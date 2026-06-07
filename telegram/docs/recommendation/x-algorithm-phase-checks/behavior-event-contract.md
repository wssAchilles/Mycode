# Behavior Event Contract Drift Check

## upstream paths read

- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md
- README sections: Query Hydration, Candidate Pipeline stages, engagement history, Side Effects

## local paths changed

- `telegram-clone-backend/src/models/UserAction.ts`
- `telegram-clone-backend/src/services/recommendation/events/types.ts`
- `telegram-clone-backend/src/services/recommendation/events/eventMapping.ts`
- `telegram-clone-backend/src/services/recommendation/events/recordRecommendationEvent.ts`
- `telegram-clone-frontend/src/types/analytics.ts`

## alignment decisions

- Treat profile clicks, search queries, topic clicks, and link opens as engagement history facts.
- Keep model-derived features out of the frontend; frontend emits user actions only.
- Preserve Candidate Pipeline separation by mapping actions through one recommendation event contract.

## known deviations

- Local implementation remains TypeScript/Mongo based rather than the upstream Rust framework.
- `search_query`, `hashtag_click`, and `open_link` are lightweight action/signal records, not full Phoenix labels.

## follow-up risks

- Search/topic interest quality depends on downstream feature jobs consuming these new action types.
- Video action types remain contract-only for this phase.
