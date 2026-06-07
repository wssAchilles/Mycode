# Recommendation Signal Validation Drift Check

## upstream paths read

- https://github.com/xai-org/x-algorithm/tree/main/phoenix
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md

## local paths changed

- `telegram-clone-backend/tests/recommendation/recommendationEventMapping.test.ts`
- `telegram-clone-backend/tests/recommendation/eventStreamBridge.test.ts`
- `telegram-clone-backend/src/scripts/auditRecommendationBehaviorSignals.ts`

## alignment decisions

- Validate engagement facts at the action/signal boundary before expecting Phoenix-style retrieval or ranking effects.
- Audit by user and since timestamp so demo verification can prove actual database writes.
- Keep validation output secret-safe and focused on counts, target types, and recent samples.

## known deviations

- Local Phoenix remains heuristic/adapter backed; this phase does not train or replace the ranking model.
- The audit script proves feature inputs exist, not that every model artifact has already retrained on them.

## follow-up risks

- Production evidence requires exercising the UI or seeding representative events after deployment.
- Retrieval/ranking impact should be measured after enough events accumulate.
