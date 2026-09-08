# Phase 107: Feed Cursor Consistency and Mutable-Ranking Boundary

## Scope and verdict

本阶段研究 feed continuation 的排序一致性，不改变在线合同或生产行为。研究对象是：

1. 复合 keyset cursor（完整排序 tuple 加唯一 tie-breaker）；
2. opaque replay-state cursor（服务端保存不可变排序结果或 PIT/state，并由 token 引用）；
3. 当前 ranked-cursor abstention（general feed continuation 直接拒答）。

当前安全结论：

- **保留当前 abstention：`GO`**。它是唯一不把不稳定的 ranked continuation 伪装成完整分页的生产安全行为。
- **私有 offline/shadow cursor-v2 合同：`CONDITIONAL GO`**。先冻结排序 tuple、ordering version、tie-breaker、旧 cursor 兼容和 mutation fixture；只输出一致性诊断，不接入 serving、OPE、qualification 或 promotion。
- **直接恢复生产 general-feed continuation：`NO-GO`**。当前 score 可变、跨 Node/Rust/Redis/Mongo 没有共同 PIT，Date-only cursor 与 Rust 的 ranked order 不同构。
- **opaque replay-state 的生产化：`NO-GO`**。需要跨进程状态 owner、TTL/GC、授权与 snapshot/PIT 生命周期；当前 `stable_order_key` 是排序身份诊断，不是可重放的剩余候选状态。

全局边界保持不变：

```text
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
realDatasetEligible = false
real finite-sample inference = UNAVAILABLE
production randomized serving = disabled
Promotion / exploration / Task 9 = NO-GO / UNAUTHORIZED
```

## 当前代码事实与调用图

### Rust canonical owner

- `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/stable_order.rs:17-30`
  定义两个顺序：
  - in-network：`createdAt DESC, postId DESC, authorId DESC`；
  - general：`score DESC, createdAt DESC, postId DESC, authorId DESC`。
- `src/pipeline/executor/serving_stage.rs:32-91` 先按上述顺序排序、去重和截断，然后调用
  `build_next_cursor`。
- `src/serving/cursor.rs:9-15` 的 `build_next_cursor` 只返回最后候选的
  `DateTime<Utc>`，没有返回 `score`、`postId` 或 `authorId`。
- `src/serving/policy/cursor.rs:4-22` 只规范化一个 RFC3339 字符串；它不是 tuple cursor
  验证器。
- `src/pipeline/executor/cache_replay.rs:32-101` 在 cache replay 上仍对 general cursor
  强制 `has_more=false`、`next_cursor=None` 和 `ranked_cursor_abstention_v1`。
- `src/pipeline/executor/response/mod.rs:172-275` 构建空的 terminal abstention result，
  不运行 retrieval、ranking 或 serving stages。

### Node/数据源边界

- `telegram-clone-backend/src/services/recommendation/types/FeedQuery.ts:147-238` 的
  `FeedQuery.cursor?: Date` 是单一时间游标；
  `rust/contracts.ts:917-977` 将它序列化成一个 ISO 字符串。
- `src/services/recommendation/feed/rustFeedRuntime.ts:76-99` 在 general query 带 cursor 时
  先 abstain，不调用 Rust；这是当前 production fallback。
- `sources/FollowingSource.ts:47-119` 通过 Redis timeline 传入 Date-only cursor，Mongo fallback
  只过滤 `createdAt < cursor`，直接查询只按 `createdAt DESC` 排序。
- `sources/FollowingTimelineCache.ts:34-114` 只用 `createdAt` 过滤并按时间排序，同一时间戳没有
  `_id` tie-breaker。
- `InNetworkTimelineService.ts:129-253` 用 `cursor.getTime() - 1` 作为 Redis score 上界；各作者
  结果在 Node 端按 `score` 排序，但 `b.score - a.score` 对相同 score 返回 `0`，没有统一的
  `postId`/`authorId` tie-breaker。
- `sources/ColdStartSource.ts:100-151` 的查询按 `createdAt DESC, engagementScore DESC, _id DESC`
  排序，却仍只用 `createdAt < cursor` 做边界，故排序 tuple 与 cursor predicate 不完整。

因此 Rust 的 canonical order、Node source 的 query order、Redis 的 score order 和跨页 cursor
并非同一个不可变序。`stable_order_key` 可帮助诊断排序身份，但不包含跨页剩余候选或 PIT 句柄，
不能单独证明 replay correctness。

## 研究问题

1. 当多个候选共享 `createdAt` 或 score 时，Date-only cursor 是否能保证无遗漏、无重复且可重放？
2. 对 general feed，完整的 `(score, createdAt, postId, authorId)` tuple 是否足够，还是必须把
   score/ranking version 固定在 snapshot 中？
3. opaque cursor 只隐藏 cursor 内容，还是还需要服务端保存不可变排序结果、PIT 或 replay state？
4. 新增、删除、过滤、score 更新和跨进程 cache eviction 时，三种方案各自的失败模式、资源成本
   和 fail-closed 行为是什么？
5. 在不改变生产授权边界的情况下，什么 bounded offline fixture 能证伪 cursor-v2 的一致性，
   并区分真实 snapshot guarantee 与“当前一次排序看起来稳定”？

## Primary-source evidence matrix

| 来源 | 精确元数据与阅读状态 | 关键前提、复杂度与失败模式 | 仓库映射与结论 |
|---|---|---|---|
| **cursor.skip()** — MongoDB Documentation Team, year `n/a` (living manual; accessed 2026-08-25), *MongoDB Database Manual*, official [reference](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/), `full_text` | MongoDB 明确要求与 `sort()`/`skip()` 一起使用时，排序至少包含一个唯一字段；重复排序值在持续写入时可能在多次执行间产生不一致顺序，推荐把 `_id` 放进 sort。该页讨论的是 offset API，但它直接证明“时间字段单独排序”不是稳定分页合同。 | 需要唯一且可比较的 tie-breaker、匹配的索引和可接受的写入语义；`skip` 深页还会增加扫描成本。它没有提供跨请求 snapshot/PIT。 | `FollowingSource`、`FollowingTimelineCache` 和 `ColdStartSource` 的 Date-only boundary 都违反完整 sort tuple 原则。采纳 tie-breaker 结论；不把 Mongo `skip` 当作 cursor-v2 实现。 |
| **Paginate search results** — Elastic Documentation Team, year `n/a` (living reference; accessed 2026-08-25), *Elasticsearch Reference*, official [reference](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html), `full_text` | `search_after` 必须在后续请求中复用相同 query/sort，并携带上一页最后 hit 的完整 sort values。官方警告：没有唯一 tie-breaker 时可能 miss/duplicate；refresh 发生在请求之间会改变顺序。PIT 固定 index state，附带一个在 PIT 内唯一且恒定的 `_shard_doc` tie-breaker；PIT 请求需持续 `keep_alive` 并在结束后删除。 | 无 PIT 时只适用于 sort tuple 在分页期间不变；有 PIT 时需承担 open context、TTL/keep-alive 和 PIT ID 生命周期。`search_after` 的实际成本取决于索引、segment 和 shard；它避免了深页 `from/size` 的累计内存，但 PIT 并不免费。 | Rust general order 需要完整 tuple；当前 DateTime cursor 丢失三项。Elastic refresh 警告直接对应 score 更新和 mutable feed。采纳“tuple + snapshot 才能声称稳定”的条件；拒绝在没有共同 PIT 的 Node/Rust/Redis/Mongo 路径直接启用。 |
| **GraphQL Cursor Connections Specification** — Relay/GraphQL maintainers, year `n/a` (current specification page does not state a publication year), *GraphQL Cursor Connections Specification*, official [specification](https://relay.dev/graphql/connections.htm), `full_text` | 规范要求 cursor 对客户端应视为 opaque string，并由客户端原样传回；规范同时要求 page-to-page edge ordering 一致，`hasNextPage` 语义基于同一连接的剩余 edges。opaque 是表示层契约，不是 snapshot 证明。 | 需要服务端定义稳定 ordering 和 cursor 解释；规范不规定存储方式、PIT、签名、TTL 或 mutable-data 处理。若底层 `allEdges` 每页变化，opaque token 仍可能失效。 | 可作为未来 API 形状参考：`cursorVersion`、完整 order tuple 或 state reference、`hasMore` 必须同属一个版本合同。不能用 opaque 字符串包装当前 DateTime 就宣称稳定。 |
| **arrayConnection.ts** — GraphQL.js/Relay maintainers, year `2015` (repository lineage; current source is living), official [source](https://github.com/graphql/graphql-relay-js/blob/main/src/connection/arrayConnection.ts), `full_text` | 官方参考实现明确注释：它使用 array offsets，分页“only work[s] if the array is static”；offset 被 base64 包装成 opaque cursor，但数据数组变化仍会破坏 continuation。 | 需要静态数组或额外 snapshot；opaque/base64 本身不增加一致性。offset cursor 的空间是 `O(1)`，但正确性依赖底层数组不变。 | 证明 `stable_order_key`/opaque wrapper 不能代替 Rust candidate remainder。若采用 replay-state，必须保存不可变排序结果或可验证 snapshot，而不是只编码时间。 |
| **ZRANGE** — Redis Documentation Team, year `n/a` (living command reference; accessed 2026-08-25), *Redis Command Reference*, official [reference](https://redis.io/docs/latest/commands/zrange/), `full_text` | Redis sorted set 按 score 排序；相同 score 按成员字典序排序，`REV` 时 tie 反向字典序。`BYSCORE` 与 `LIMIT` 支持 score range 分页；官方复杂度为 `O(log(N)+M)`，大 offset 仍需遍历前置成员。 | score 相同的 tie 规则是成员字典序，不是业务 `postId DESC, authorId DESC` tuple；score 变化会改变成员位置。跨多个 sorted set 合并还需要应用层统一 tie-breaker。 | `InNetworkTimelineService` 按 `createdAt` score 做 `ZREVRANGEBYSCORE`，随后 Node 对跨作者结果只按 score sort；这不能证明 Rust stable order。采纳 Redis 的 score/tie/成本事实；要求 source-specific cursor 或在 canonical merge 层重建完整 tuple。 |

这些资料提供的是分页与存储语义证据，不是本仓库的 utility、coverage、PIT 或 production evidence；不能解除
`realDatasetEligible=false` 或 promotion/exploration 禁止。

## 方案比较

| 方案 | 可证伪合同、资源与前提 | 主要失败模式 | 决定 |
|---|---|---|---|
| **A. 复合 keyset cursor** | cursor 至少包含 `cursorVersion`、`orderingVersion` 和完整 tuple。in-network 可用 `(createdAt, postId, authorId)`；general 需要 `(score, createdAt, postId, authorId)`。每个 source 的 query predicate 必须与 sort 方向逐项一致，并有 supporting compound index。单 source cursor 约 `O(1)` 状态，page seek 约 `O(log N + K)`；`M` 个异构 source 的 merge cursor 至少是 `O(M)` 字段。 | equal timestamp/score 若缺 tie-breaker 仍会 miss/duplicate；score 或 ordering version 更新会把项目搬过边界；Node filters、source fallback 或 query 参数变化会令旧 tuple 不再代表同一 universe。旧 DateTime cursor 不能无损解释为 v2。 | **CONDITIONAL GO / offline-shadow only**。先做 versioned contract、frozen fixture、source-by-source keyset predicate 和 fail-closed old-cursor handling；不直接开启 production general continuation。 |
| **B. opaque replay-state cursor** | 首页生成 immutable ordered candidate IDs/scores、filter/query fingerprint、ordering version 和 TTL state；token 只引用或签名该 state。后续页读取 state remainder，而不是重新按 mutable score 排序。正确性在 state 保留期间接近 `O(K)` page read；存储为每个 open session `O(R)`（`R` 为候选 remainder/metadata），需跨进程共享、GC、权限和加密/签名。 | state eviction、PIT 过期、跨 replica 不一致、候选删除/权限变化、token replay/滥用；state 太大导致 Redis/DB 压力。若只存 hash/stable key 而不存 remainder，无法恢复下一页。 | **NO-GO / production**：当前没有 feed state owner、PIT 生命周期、跨 Node/Rust/Redis/Mongo snapshot 或用户级 TTL 合同。可作为 private offline replay harness 的对照组。 |
| **C. 当前 ranked-cursor abstention** | general feed 有 cursor 时在 Node/Rust/cache replay 直接返回空 continuation：`has_more=false`、`next_cursor=None`、`ranked_cursor_abstention_v1`；不运行后续 stages，资源近似 `O(1)`。in-network 仍走 Date-only time path。 | general continuation 不可用；in-network 的 equal timestamp 和 source merge tie 仍可能丢失/重复；它不能改善 source-level cursor，只能避免不诚实的 ranked continuation。 | **GO / retain**。作为 production fail-closed baseline；所有实验结果只标记 degraded/diagnostic，不当作 utility 或 qualification。 |
| **D. 只加 score fence 或只包装 DateTime 为 opaque** | 令下一页查询 `score < lastScore`，或把 DateTime base64/签名后继续使用；实现成本低、cursor `O(1)`。 | score equal、score update、refresh、query/source fallback 改变时仍 miss/duplicate；签名只能防篡改，不能冻结 ordering。 | **NO-GO**。没有完整 tuple 与 immutable ordering state，不构成 cursor-v2。 |

### Mutable-score 推论

对 general order `score DESC, createdAt DESC, postId DESC, authorId DESC`，即使 cursor 包含上一页
最后候选的全部字段，只要下一次请求重新计算 score，下面两种变化都会破坏“之后”关系：

- 上一页之后的候选 score 上升到边界之前，可能重复或插入到已经返回的逻辑位置；
- 已返回候选 score 下降到边界之后，重新查询可能再次返回它，或把原本应返回的候选挤掉。

因此 general cursor-v2 需要至少一个不变条件：冻结 `orderingVersion`/score snapshot、保存 replay remainder，
或明确把 continuation 诊断为 abstention。没有该条件时，完整 tuple 只能消除 tie bug，不能制造 snapshot guarantee。

## 最小离线验证范围

若下一阶段实施，必须仍是 private `cfg(test)` 或 shadow harness，不改在线响应合同：

1. 冻结一个小型多 source fixture，覆盖相同 `createdAt`、相同 score、跨 source duplicate、insert、delete、
   filter change 和 score update。
2. 定义 `cursor_v2` 结构：`version`、`orderingVersion`、方向、完整 sort tuple、query/filter fingerprint；
   所有字段先做大小/字符/数值 preflight，超过边界直接 `resource_limit_exceeded`。
3. 对 frozen ordering 验证：分页拼接与一次性全排序完全一致、无重复 ID、无遗漏 ID、tie-breaker deterministic、
   `hasMore` 只由实际剩余项推导。
4. 对 score mutation 验证：若没有 immutable orderingVersion/replay state，fixture 必须得到
   `not_evaluable`/abstention，而不是把“恰好相同的结果”当成正确性证明。
5. 对旧 DateTime cursor 验证：不猜测其 tuple；版本不匹配必须 first-page reset 或 fail closed，并记录
   diagnostics，不把旧 cursor 迁移当成无损兼容。
6. 只比较 ID/order/资源和 deterministic digest；不输出真实 CTR、utility、OPE、support coverage、
   candidate qualification 或 promotion gate。

建议的离线量化指标：

```text
duplicate_rate = duplicate_ids / returned_ids
omission_rate = expected_snapshot_ids_missing / expected_snapshot_ids
order_mismatch_rate = page_concat != frozen_total_order
legacy_cursor_rejection_rate = rejected_legacy_cursors / legacy_cursor_requests
resource_bytes = encoded_cursor_bytes + replay_state_bytes
```

这些指标只回答 pagination contract 是否自洽；它们不是用户 utility 或 recommendation quality。

## 验收与下一阶段边界

- 当前阶段的验收证据是：Rust/Node 调用图、官方文档矩阵、等时间/等 score 失败模式、mutable-score 推论和
  明确的 `GO / CONDITIONAL GO / NO-GO` 决定；没有实现 cursor-v2，也没有改变 `ranked_cursor_abstention_v1`。
- 下一阶段若继续，优先做 bounded offline cursor-v2 fixture 和 contract-only shadow report；先证明 frozen
  ordering，再证明 mutation 时会 fail closed。不得先改 `FeedQuery.cursor` 或恢复 production continuation。
- 只有在新的 owner 明确 snapshot/PIT、TTL、跨进程 state、排序版本和旧 cursor migration 后，才可重新审查
  production authorization；真实数据、propensity、PIT viewer provenance 和 qualification 仍未提供。

## 决定矩阵

| 范围 | 状态 |
|---|---|
| current ranked-cursor abstention | `GO / retain as production fail-closed baseline` |
| in-network composite keyset tuple | `CONDITIONAL GO / offline-shadow; production requires source/index contract` |
| general composite tuple without frozen score | `NO-GO / mutable ordering` |
| opaque replay-state cursor | `NO-GO / missing shared state and PIT lifecycle` |
| cursor-v2 bounded offline fixture | `CONDITIONAL GO / next implementation candidate` |
| real utility/OPE/qualification/promotion/exploration | `UNAVAILABLE / NO-GO / UNAUTHORIZED` |
