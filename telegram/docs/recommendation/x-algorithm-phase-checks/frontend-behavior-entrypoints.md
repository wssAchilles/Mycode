# Frontend Behavior Entrypoints Drift Check

## upstream paths read

- https://github.com/xai-org/x-algorithm/tree/main/home-mixer
- https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md

## local paths changed

- `telegram-clone-frontend/src/hooks/useAnalytics.ts`
- `telegram-clone-frontend/src/components/space/SpacePost.tsx`
- `telegram-clone-frontend/src/components/space/SpaceExplore.tsx`
- `telegram-clone-frontend/src/pages/SpacePage.tsx`

## alignment decisions

- Frontend collects real user actions at UI boundaries and sends them as analytics events.
- Request, rank, score, and selection metadata are preserved for feed-card actions.
- Page-level topic/search/follow actions are captured without changing navigation or business APIs.

## known deviations

- Upstream Home Mixer is server-side orchestration; this phase only adds client-side action collection.
- Follow/unfollow remains business-route authoritative; analytics is an attribution copy.

## follow-up risks

- If Markdown rendering changes, link tracking must remain attached to rendered anchors.
- If multiple Space surfaces are split later, productSurface values should be made stricter.
