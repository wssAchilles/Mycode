---
feature: space-service-split
status: delivered
updated: 2026-07-16
branch: refactor/space-split
commits: e1cb7819..HEAD
---

# Space Service Domain Split

## Report

**What was built** — `spaceService.ts` 作为唯一公开门面保留，方法体按域迁入 `src/services/space/`：`internal`（纯函数/快照刷新/userMap）、`news`、`search`、`posts`、`interactions`、`profiles`（含推荐关注）、`feed`（getFeedPage 编排）。调用方（routes/scheduler/agentPlane）仍只 import `services/spaceService`，HTTP 与 side-effect 顺序不变。`getFeedPage` 通过 deps 注入 `withFeedTrendKeywords` / `recordServedFeedTrace` / `getUserPosts` / `getUserMap` / `getPostsByIds` / `getInNetworkDirectFallback`，既有 spy 测试继续生效。收尾清理了 facade 未使用 import 与无调用方的 private 一次性委托。

**Verification** — 在 worktree `telegram/.worktrees/space-split/telegram` 执行：

- `tsc --noEmit -p tsconfig.json --pretty false` → PASS
- vitest：`tests/space/pureHelpers.test.ts` + 4 个 space/recommendation 契约文件 → **48/48 PASS**
- `npm test -- --run` → **1444 passed / 3 failed**（`tests/messages/legacyRoutes*.test.ts` 期望 410 实得 404，已在 base `e1cb7819` 复现，标记 PRE-EXISTING）

独立 review（explore-10）结论：**APPROVE**，无 critical；spec 五条验收均 PASS。

**Journey log**

1. 首批在 master 落地 pure/news/search 后，按用户要求改走 compose-next + worktree，避免与主线并行写冲突。
2. 门面委托比“直接改调用方 import”更安全；代价是保留一层 thin wrapper，但换来了零路由 diff。
3. S5 初版把 `getPostsByIds`/`getUserMap` 写成模块直调，导致 `spaceServiceTraceRequestId` 的 spy 失效并超时——改为 deps 注入后恢复；后续域抽取若测试 spy 私有方法，必须保留注入点。
4. Reviewer 建议清死代码：删掉 `this.uses=0` 的 private 委托与约 30 个未用 import 后，facade 从 ~1038 行降到 ~947 行，tsc/space 测试仍绿。
5. `getTrendingTags` / `getNewsBrief` / `getNotifications` / `buildUserInterestKeywords` / `withFeedTrendKeywords` 仍留在 facade（依赖趋势子树或实例缓存），属后续可选拆分，不阻塞本次交付。

## [S1] Problem

`telegram-clone-backend/src/services/spaceService.ts` 曾是 backend 最大单点模块（拆分前 ~2384 行）。AGENTS.md Anti-Flat 要求按域分目录。调用方只 import `services/spaceService`，必须以门面保留方式拆分，避免空间功能逻辑回归。

## [S2] Design

**Strategy:** keep `spaceService.ts` as the public facade (`export const spaceService = new SpaceService()`). Move method bodies into `src/services/space/<domain>/` as exported functions. Class methods become one-line delegations. Callers and HTTP contracts stay unchanged.

**Delivered structure:**

- `space/types.ts` — CreatePostParams / SpaceSearchPageResult / RecommendedSpaceUser（facade re-export）
- `space/internal/pureHelpers.ts` — 搜索/趋势/关键词纯函数
- `space/internal/postFeatureSnapshots.ts` — 特征快照刷新 side-effect
- `space/internal/userMap.ts` — 作者/用户水合
- `space/news/newsQueries.ts` — 新闻帖与 cluster
- `space/search/searchQueries.ts` — text/exact/topic/news-topic 搜索
- `space/posts/postMutations.ts` — create/get/byIds/delete/pin/unpin
- `space/interactions/interactions.ts` — like/repost/comment
- `space/profiles/profileQueries.ts` + `recommendedUsers.ts` — 主页与推荐关注
- `space/feed/feedPage.ts` — getFeedPage / in-network fallback / recordServedFeedTrace

**Contracts:**

- 方法名、签名、返回形状、side-effect 顺序不变（recordRecommendationEvent、incrementStat、refreshPostFeatureSnapshots、InNetworkTimeline）。
- Mongo 查询与推荐事件语义不变。
- `spaceService` 仍是 routes/scheduler/agentPlane 的唯一公开 import 路径。
- Feed 保留实例级 `feedTrendKeywordCache`；推荐关注的 `AuthorSuggestionService` 为模块级单例（与原类字段等价）。

**Per-phase verification:**

```bash
cd telegram-clone-backend
./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false
./node_modules/.bin/vitest run \
  tests/space/pureHelpers.test.ts \
  tests/recommendation/spaceFeedIdentityContract.test.ts \
  tests/recommendation/spaceFeedPageResult.test.ts \
  tests/recommendation/spaceServiceTraceRequestId.test.ts \
  tests/recommendation/spaceFeedResponseAdapter.test.ts
```

## [S3] Out of Scope

- Changing Space HTTP routes or response DTOs
- Splitting `getFeedPage` recommendation pipeline internals (`services/recommendation/**`)
- Renaming `spaceService` or breaking existing imports
- Performance refactors, query rewrites, or new features
- ml-services / light-jobs（已搁置）
- 继续拆 `getTrendingTags`/`getNotifications`/`getNewsBrief` 子树（可选后续）

## Tasks

- [x] T1: Batch 1 — pure helpers + news + search + types — acceptance: tsc + 48 space-related tests green on master e1cb7819 (covers: S2)
- [x] T2: S2 posts extraction — acceptance: createPost/getPost/getPostsByIds/deletePost/pin/unpin delegate to space/posts; tsc + phase tests green; facade API unchanged (covers: S2)
- [x] T3: S3 interactions extraction — acceptance: like/unlike/repost/unrepost/comment paths delegate; feature-snapshot side effects preserved; phase tests green (covers: S2; depends: T2)
- [x] T4: S4 profiles + recommended users extraction — acceptance: profile/cover/user posts/liked/recommended users delegate; phase tests green (covers: S2; depends: T3)
- [x] T5: S5 feed extraction — acceptance: getFeedPage/getFeed/trace/trend keyword paths delegate; recommendation identity/pageResult/trace tests green; full backend vitest or documented smoke (covers: S2; depends: T4)
- [x] T6: Final review + finalize spec — acceptance: reviewer APPROVE; Report filled; status delivered (covers: S2; depends: T5)
