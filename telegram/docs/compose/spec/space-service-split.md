---
feature: space-service-split
status: in-progress
updated: 2026-07-16
branch: refactor/space-split
commits: e1cb7819..HEAD
---

# Space Service Domain Split

## Report

## [S1] Problem

`telegram-clone-backend/src/services/spaceService.ts` remains the largest backend single-point module (~1948 lines after batch 1). AGENTS.md Anti-Flat requires domain-oriented directories. Callers import only `services/spaceService`, so a facade-preserving split is required to avoid logic regressions in Space APIs.

## [S2] Design

**Strategy:** keep `spaceService.ts` as the public facade (`export const spaceService = new SpaceService()`). Move method bodies into `src/services/space/<domain>/` as exported functions. Class methods become one-line delegations. Callers and HTTP contracts stay unchanged.

**Already delivered (batch 1, master `e1cb7819`):**

- `space/types.ts` — CreatePostParams / SpaceSearchPageResult / RecommendedSpaceUser (re-exported)
- `space/internal/pureHelpers.ts` — pure search/trend/keyword helpers
- `space/news/newsQueries.ts` — createNewsPosts, getNewsClusters, getNewsPosts, getNewsClusterPosts, cleanupOldNews
- `space/search/searchQueries.ts` — searchPostsPage, exact/topic/news topic search

**Remaining phases (order fixed by user):**

| Phase | Domain | Public methods to extract | Notes |
| --- | --- | --- | --- |
| S2 | posts | createPost, getPost, getPostsByIds, deletePost, pinPost, unpinPost | getPost uses recommendation event; createPost uses reply/quote |
| S3 | interactions | likePost, unlikePost, repostPost, unrepostPost, createComment, getPostComments, getCommentsWithAuthors | interactions call `refreshPostFeatureSnapshots` |
| S4 | profiles | getUserMap, getFollowedSet, getUserProfile, setUserCover, updateSpaceProfileFields, getUserPosts, getUserLikedPosts, getRecommendedUsers, getFastRecommendedUsers, withRecommendedUsersFallback, getFastFallbackUsers | recommended users stay coupled to Contact/User |
| S5 | feed | getFeed, getFeedPage, recordServedFeedTrace, withFeedTrendKeywords, getCachedFeedTrendKeywords, getInNetworkDirectFallback, getNotifications (if feed-adjacent) | **highest risk** — recommendation runtime; extract last |

**Shared private helpers** used across domains (`refreshPostFeatureSnapshots`, `getUserMap`) move to `space/internal/` once more than one domain needs them, or stay on the facade and are passed as deps.

**Contracts:**

- No change to method names, signatures, return shapes, or side-effect order.
- No change to Mongo queries, recommendation events, or cache invalidation calls.
- `spaceService` remains the only public import path for routes/scheduler/agentPlane.

**Per-phase verification (mandatory):**

```bash
cd telegram-clone-backend
./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false
./node_modules/.bin/vitest run \
  tests/space/pureHelpers.test.ts \
  tests/recommendation/spaceFeedIdentityContract.test.ts \
  tests/recommendation/spaceFeedPageResult.test.ts \
  tests/recommendation/spaceServiceTraceRequestId.test.ts \
  tests/recommendation/spaceFeedResponseAdapter.test.ts
# plus any domain-specific tests added in that phase
# full npm test when the phase touches feed or when user requests smoke
```

## [S3] Out of Scope

- Changing Space HTTP routes or response DTOs
- Splitting `getFeedPage` recommendation pipeline internals (`services/recommendation/**`)
- Renaming `spaceService` or breaking existing imports
- Performance refactors, query rewrites, or new features
- ml-services / light-jobs (explicitly shelved)

## Tasks

- [x] T1: Batch 1 — pure helpers + news + search + types — acceptance: tsc + 48 space-related tests green on master e1cb7819 (covers: S2)
- [x] T2: S2 posts extraction — acceptance: createPost/getPost/getPostsByIds/deletePost/pin/unpin delegate to space/posts; tsc + phase tests green; facade API unchanged (covers: S2)
- [x] T3: S3 interactions extraction — acceptance: like/unlike/repost/unrepost/comment paths delegate; feature-snapshot side effects preserved; phase tests green (covers: S2; depends: T2)
- [x] T4: S4 profiles + recommended users extraction — acceptance: profile/cover/user posts/liked/recommended users delegate; phase tests green (covers: S2; depends: T3)
- [ ] T5: S5 feed extraction — acceptance: getFeedPage/getFeed/trace/trend keyword paths delegate; recommendation identity/pageResult/trace tests green; full backend vitest or documented smoke (covers: S2; depends: T4)
- [ ] T6: Final review + finalize spec — acceptance: reviewer pass on integrated diff; Report filled; status delivered (covers: S2; depends: T5)
