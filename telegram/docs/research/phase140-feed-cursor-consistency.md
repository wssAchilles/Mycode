# Phase 140：Feed Cursor 一致性研究

更新时间：2026-08-30

## 范围与结论

本阶段研究 feed continuation 在重复时间戳、重复 score、跨请求写入和可变排序分数下的
一致性条件。研究不实现 cursor-v2，不改在线 API、Node/Rust wire contract、Redis/Mongo
查询或 eligibility/promotion 开关。

结论：

- **保留 `ranked_cursor_abstention_v1`：`GO`。** 在没有冻结 score、跨源快照或可重放
  serving state 时，general feed 不返回一个看似可用但无法证明的 continuation。
- **in-network 复合 keyset cursor：`CONDITIONAL GO / offline-shadow only`。** 只有在完整
  sort tuple、唯一 tie-break、query/filter 不变和同一不可变 snapshot 同时存在时，才能声称
  无遗漏、无重复；当前生产链路不满足这些条件。
- **general 复合字段 cursor（无冻结 score）：`NO-GO`。** 把 `score` 放进 token 可以消除
  一部分 tie 问题，却不能抵抗 score 更新、候选删除/插入或排序版本漂移。
- **opaque serving-state cursor 生产化：`NO-GO`。** opaque 只是表示形式；生产化还需要
  跨进程 state owner、PIT/snapshot 生命周期、TTL/GC、权限、容量和回滚合同。
- **私有 bounded offline/shadow 一致性夹具：`CONDITIONAL GO`。** 只比较 ID、顺序、重复/遗漏、
  fingerprint、版本拒绝和资源上限，不输出 utility、OPE、propensity、qualification 或 promotion
  证据。

全局状态保持不变：

```text
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
realDatasetEligible = false
real finite-sample inference = UNAVAILABLE
production randomized serving = disabled
promotion / exploration / Task 9 = NO-GO / UNAUTHORIZED
```

## 当前代码事实

以下事实先由当前唯一 codebase-memory 索引定位，再用源码核对；索引覆盖检查对所列文件均为
`metadata_match`、`no_recorded_issue`，但该信号不是完整性证明。

### Rust serving 合同

| 文件与符号 | 当前事实 | 对 cursor 的含义 |
|---|---|---|
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/stable_order.rs:1-31`，`compare_candidates` / `sort_candidates_stably` | in-network 顺序为 `createdAt DESC, postId DESC, authorId DESC`；general 顺序为 `score DESC, createdAt DESC, postId DESC, authorId DESC`。 | 这是单次 serving 的确定性顺序，不等于跨请求 snapshot。general 的第一排序键是可变 score。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/pipeline/executor/serving_stage.rs:32-91`，`execute_serving_stage` | 先排序、dedup、按 `limit` 截断，再从最终候选调用 `build_next_cursor`。 | cursor 只能代表已经经过当前请求 serving 的结果；被 selector/dedup 丢弃的候选不可能由后续页恢复。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/cursor.rs:9-15`，`build_next_cursor` | 只返回最后候选的 `DateTime<Utc>`，没有 `score`、`postId`、`authorId` 或 snapshot 句柄。 | 生产 cursor 不是完整 tuple，也不是 replay state。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/cursor.rs:13-26`，`ranked_cursor_requires_abstention` | `!in_network_only && has_cursor` 时要求 abstain；in-network continuation 不触发这一 guard。 | general ranked continuation 已显式 fail closed；in-network 仍承受 Date-only/source merge 风险。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/pipeline/executor/cache_replay.rs:138-162`，`enforce_ranked_cursor_abstention` | general cache replay 清除 `has_more`/`next_cursor`，写入 `ranked_cursor_abstention`。 | cache 命中不会绕过 general continuation 门禁。 |
| `telegram-rust-workspace/crates/telegram-rust-recommendation/src/pipeline/executor/response/mod.rs:185-324`，`build_ranked_cursor_abstention_result` / `build_terminal_abstention_result` | 构造空 candidates、`has_more=false`、`next_cursor=None` 的 terminal result，不运行 retrieval/ranking。 | 这是资源近似 `O(1)` 的生产安全降级，不是质量结果。 |

### Node/data-source 合同

| 文件与符号 | 当前事实 | 对 cursor 的含义 |
|---|---|---|
| `telegram-clone-backend/src/services/recommendation/types/FeedQuery.ts:147-238`，`FeedQuery` | `cursor?: Date`，wire 层传一个 ISO 时间字符串。 | Node contract 无法表达完整 tuple、ordering version 或 PIT。 |
| `telegram-clone-backend/src/services/recommendation/feed/rustFeedRuntime.ts:84-106`，`resolvePrimaryRustFeed` | general query 有 cursor 时直接返回 `ranked_cursor_abstention` page meta，不调用 Rust。 | 当前 general production path 不承诺 continuation。 |
| `telegram-clone-backend/src/services/recommendation/InNetworkTimelineService.ts:129-183,204-240`，`getMergedPostIdsForAuthorsWithSummary` | 对每个作者执行 Redis `zrevrangebyscore`，cursor 上界为 `cursor.getTime() - 1`；Node 合并后只按 `score` 降序，未追加 `postId`/`authorId` tie-break。 | Redis 的 member tie 规则没有被跨作者 merge 保留；同时间 score 会依赖输入顺序。 |
| `telegram-clone-backend/src/services/recommendation/sources/FollowingSource.ts:52-79,105-121`，`FollowingSource.getCandidates` | 优先读 Redis ID 再用无 session 的 Mongo `$in` hydration；直接 fallback 只按 `createdAt DESC`，边界为 `createdAt < cursor`。 | Redis 和 Mongo 不是共同 PIT；fallback 与 Rust tuple 不同构。 |
| `telegram-clone-backend/src/services/recommendation/sources/FollowingTimelineCache.ts:55-115`，`FollowingTimelineCache.getPostsForAuthors` | cache 刷新查询和合并结果都只按 `createdAt DESC`；cursor 过滤为 `p.createdAt < cursor`。 | 同 timestamp 的候选可在页边界被永久跳过；cache TTL 还会改变候选集合。 |
| `telegram-clone-backend/src/services/recommendation/sources/ColdStartSource.ts:121-148`，`findPosts` | cursor 只过滤 `createdAt < cursor`，查询排序却是 `createdAt DESC, engagementScore DESC, _id DESC`。 | 排序 tuple 与边界谓词不一致；engagement/score 变化会移动候选。 |

### 离线夹具与诊断边界

- `telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/cursor_consistency.rs:4-44`
  定义私有 `CursorMode`、`CursorKey` 和 `Cursor`；in-network key 是
  `(created_at_ms, post_id, author_id)`，general key 还包含 `score`。
- `:64-110` 使用同一字段顺序排序和比较 cursor；`:154-199` 在 page 前检查
  `version`、`mode`、`ordering_fingerprint`，再按 keyset 过滤。
- `:223-232` 的 `legacy_date_only_remaining` 明确展示 Date-only 边界会遗漏同 timestamp
  尾部；`:268-335` 覆盖冻结 in-network 无重复/无遗漏、general score mutation、版本/模式
  漂移拒绝；`:338-348` 覆盖资源和重复 ID 输入拒绝。
- 该模块只在 `cfg(test)` 中编译，没有 production caller。其 fingerprint 和
  `stable_order_key` 都是诊断身份，不是跨进程候选 remainder、PIT 或 immutable evidence。

## 研究问题

1. 在不可变/PIT snapshot 下，完整复合 keyset cursor 为什么能覆盖重复 timestamp 而不产生
   omission/duplicate？需要哪些唯一性、排序和索引条件？
2. 当 score 会变化且没有 PIT 时，复合字段 cursor、opaque serving-state cursor 和
   fail-closed abstention 各自需要什么支持、兼容和失败语义？
3. Redis sorted set 与 Mongo 查询在重复 score/时间戳、写入交错和 snapshot 边界下分别保证什么，
   哪些保证不能跨存储拼接？
4. 在没有 immutable evidence、propensity、support 和 real data 的 diagnostics-only 阶段，
   哪些 offline/shadow 断言是安全的，哪些会越界成为 utility/OPE/qualification 声明？

## 关键推导：冻结 snapshot 下的复合 keyset

设一次请求的不可变候选集合为 `S`，排序 key 为唯一的全序 `K(x)`。对于降序 in-network，
可用：

```text
K_in(x) = (createdAt(x), postId(x), authorId(x))
```

其中每个字段按 `DESC` 比较；general 还需：

```text
K_general(x) = (score(x), createdAt(x), postId(x), authorId(x))
```

第一页返回 `S` 中按 `K` 排序的前 `k` 项，并把最后一项的完整 `K` 放进 cursor。后续页使用
与排序方向相反的严格 lexicographic boundary，例如降序三元组可展开为：

```text
createdAt < c.createdAt
OR (createdAt = c.createdAt AND postId < c.postId)
OR (createdAt = c.createdAt AND postId = c.postId AND authorId < c.authorId)
```

在 `S`、过滤条件、排序版本和比较规则都不变时，严格 boundary 把全序分成已返回前缀和剩余
后缀；因此同一 ID 不会跨边界重复，也不会因 timestamp 相等而遗漏。这是由 PostgreSQL
row-constructor 的左到右词典序规则推导出的数学性质，不是当前生产链路已经具备的保证。

要把该推导升级为跨请求保证，还必须满足：

- tuple 最终唯一；若 `postId` 全局唯一，`authorId` 是防御性字段，否则还要继续加唯一键；
- 后续请求复用完全相同的 query/filter/order/version；
- 查询谓词和 `ORDER BY` 字段方向逐项匹配，并有 supporting compound index；
- `S` 来自同一不可变 snapshot/PIT。仅有 tuple 而允许插入、删除或 sort key 更新，只能保证
  某些 append-only/immutable-key 情形，不能保证完整 snapshot；
- cursor version 不匹配、旧 Date-only cursor 或 snapshot 过期时必须 reset 或 abstain，不能
  猜测缺失字段。

## 来源与证据矩阵

阅读状态说明：`full_text` 表示已阅读官方页面/论文全文；`abstract_or_public_description`
表示只使用官方摘要或公开描述，未把摘要外的实验细节当作证据。

| 问题 | 来源（exact title / authors / year / venue or institution / DOI or official link / 状态） | 核心思想与支持条件 | PIT / snapshot | propensity / support | 限制与失败模式 | 对应仓库文件 | 采用或拒绝 |
|---|---|---|---|---|---|---|---|
| Q1 | **9.24. Row and Array Comparisons** — PostgreSQL Global Development Group，2022（PostgreSQL 15 Reference Manual），官方 [文档](https://www.postgresql.org/docs/15/functions-comparisons.html)，`full_text` | row constructor 的 `< <= > >=` 按字段从左到右比较，前缀相等才检查后续字段；要求对应 operator 可用于 B-tree operator class。 | 不提供跨请求 snapshot；只给 tuple 比较语义。 | 不涉及。 | 任一 key 为 null 或比较器不成全序都会削弱边界；需要与 `ORDER BY`/索引保持同构。 | offline `CursorKey`/`compare_candidate_to_cursor_key`；未来 source query predicate。 | **采用**作为复合 keyset 的形式化基础；不把它当 PIT 实现。 |
| Q1/Q3 | **13.2. Transaction Isolation** — PostgreSQL Global Development Group，2022（PostgreSQL 15 Reference Manual），官方 [文档](https://www.postgresql.org/docs/15/transaction-iso.html)，`full_text` | Repeatable Read 在事务内从同一 snapshot 读取；Read Committed 的连续 SELECT 可看到不同数据。 | Repeatable Read 提供事务级稳定视图，但长事务、重试和资源占用仍需处理。 | 不涉及。 | snapshot 不会自动跨服务/Redis/Mongo；只在同一数据库事务边界内成立。 | Node source 没有共享 DB session；Rust serving 是 HTTP 请求级。 | **采用**“排序正确还需要稳定视图”；拒绝把单次 Mongo/Redis 读取当作等价 PIT。 |
| Q1/Q3 | **cursor.skip() (mongosh method)** — MongoDB Documentation Team，n/a（living MongoDB Manual，访问 2026-08-30），官方 [文档](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/)，`full_text` | 重复 sort 值在持续写入时可能产生不一致顺序；排序应包含唯一字段；range query 用 `$lt/$gt` 加最后值可避免深 offset 扫描。 | 该页不提供跨请求 snapshot；普通 cursor 受并发写入影响。 | 不涉及。 | `_id` 通常随时间增长但并非严格单调；唯一 tie-break 仍不能冻结集合。 | `FollowingSource`、`FollowingTimelineCache`、`ColdStartSource` 的 Date-only boundary/sort。 | **采用**唯一 tie-break 和 range predicate 结论；拒绝用 Mongo sort 单独恢复在线 cursor。 |
| Q3 | **Read Isolation, Consistency, and Recency** — MongoDB Documentation Team，n/a（living MongoDB Manual，访问 2026-08-30），官方 [文档](https://www.mongodb.com/docs/manual/core/read-isolation-consistency-recency/)，`full_text` | 非 point-in-time read 可看到读取期间的更新；cursor 在索引字段被并发修改时可能返回同一文档两次；建议使用 read isolation。 | `readConcern: snapshot` 可返回特定时间点的 majority-committed 数据，但仅适用于规定的 transaction/`find`/`aggregate` 场景，并受历史窗口和 majority 条件约束。 | 不涉及。 | causal session 不是 isolation；跨 shard/跨存储仍需共同 owner。 | 当前 `Post.find(...).lean()` 调用不绑定 snapshot session；Redis hydration 也不绑定 Mongo snapshot。 | **采用**其失败模式和 snapshot 前提；当前阶段不启用新的 read concern。 |
| Q1/Q2/Q3 | **Paginate search results** — Elastic Documentation Team，n/a（living Elasticsearch Reference，访问 2026-08-30），官方 [文档](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results)，`full_text` | `search_after` 必须复用相同 query/sort，并携带最后 hit 的全部 sort values（含唯一 tie-break）；refresh 之间会改变页间顺序。 | PIT 固定 index state；后续请求必须使用最新 PIT ID，结束后应删除 PIT；keep-alive 是额外生命周期成本。 | 不涉及。 | PIT 只覆盖该 index；不覆盖 Node/Mongo/Redis 的候选、权限或 score 服务。 | Rust `build_next_cursor` 丢失 tuple；Node 多 source 没有共同 PIT。 | **采用**tuple + PIT 的必要条件；拒绝据此直接打开 production general continuation。 |
| Q3 | **ZRANGE** — Redis Documentation Team（Redis Ltd），n/a（living Redis Command Reference，访问 2026-08-30），官方 [文档](https://redis.io/docs/latest/commands/zrange/)，`full_text` | sorted set 成员唯一；按 score 排序；同 score 按二进制字典序，`REV` 时 tie 反向；BYSCORE 默认闭区间，可用 `(` 排除边界；复杂度 `O(log(N)+M)`，大 offset 需遍历前置成员。 | 命令级读取语义；没有跨请求 retained snapshot/PIT。 | 不涉及 propensity；member uniqueness 是数据结构约束，不是 action support。 | score 用 double（精确整数范围受 2^53 限制）；`ZADD/ZINCRBY` 更新 score 会改变位置；字典序不是业务 post/author tuple。 | `InNetworkTimelineService` 的 `zrevrangebyscore`、Node `scored.sort` 和 `cursor-1`。 | **采用**score/tie/boundary/cost 事实；拒绝把 Redis member tie 当 Rust canonical order。 |
| Q3 | **Transactions** — Redis Documentation Team（Redis Ltd），n/a（living Redis command documentation，访问 2026-08-30），官方 [文档](https://redis.io/docs/latest/develop/using-commands/transactions/)，`full_text` | `MULTI/EXEC` 将已排队命令串行执行，其他客户端不会插入事务中；Redis 不提供 rollback。 | 这是执行原子性，不是可供下一 HTTP 请求持有的 PIT；文档未定义 retained read snapshot。后一句是基于 API 边界的仓库推论。 | 不涉及。 | pipeline/transaction 不能跨 Redis 与 Mongo，也不能阻止下一页请求看到后续 score 更新。 | 每作者 pipeline 读取后再 Node merge；没有跨请求 state。 | **采用**“命令串行不等于跨页快照”；拒绝为当前 path 增加事务以冒充 cursor-v2。 |
| Q2 | **GraphQL Cursor Connections Specification** — Relay/GraphQL maintainers，n/a（living specification，访问 2026-08-30），官方 [规范](https://relay.dev/graphql/connections.htm)，`full_text` | 客户端把 cursor 当 opaque string 原样回传；连接分页要求 page-to-page edge ordering 一致，`hasNextPage` 表示同一连接仍有 edge。 | 规范不规定 PIT、state 存储、TTL、签名或 mutable-data 处理；opaque 本身不是 snapshot。 | 不涉及。 | 若底层集合/排序变化，opaque token 仍可能失效；语义必须由服务端另行定义。 | Node `FeedQuery.cursor` 与 Rust `stable_order_key` 都没有 state reference。 | **采用**表示层/ordering 约束；拒绝把 base64/签名 DateTime 误称 serving-state。 |
| Q2 | **arrayConnection.ts**（GraphQL Relay reference implementation）— GraphQL Relay maintainers，n/a（living source，访问 2026-08-30），官方 [源码](https://github.com/graphql/graphql-relay-js/blob/main/src/connection/arrayConnection.ts)，`full_text` | 参考实现把 array offset 编码进 cursor，并明确把静态 array 作为该分页模型的前提。 | 不提供跨请求 PIT；静态 array 前提由调用方负责。 | 不涉及。 | 插入、删除或重排会使 offset 指向不同 edge；base64/opaque 包装不能修复 mutable collection。 | Node source fallback 与 Rust serving 没有 immutable array/version state。 | **采用**其对 offset 方案的限制说明；拒绝把 offset/base64 当作在线 cursor 修复。 |
| Q4 | **Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms** — Lihong Li、Wei Chu、John Langford、Xuanhui Wang，2011，WSDM 2011，297–306，DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878)，官方 [Microsoft Research PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/Published-3.pdf)，`full_text` | 离线 bandit replay 面对 partial labels；要评估未实际展示的 action，需要随机 logging/已知 action probability 和可比的反馈。 | 论文讨论日志时间/事件，而非数据库 PIT；不能替代 immutable source receipt。 | 明确依赖 logging probability 与 action support；无 support 的 action 没有 counterfactual feedback。 | replay 结果不自动覆盖动态候选、无放回 slate、删除/插入或真实 viewer provenance。 | 当前 synthetic fixture 只有结构性 candidate/order；没有 real impression log/propensity。 | **采用**作为“无 propensity/support 只能做结构诊断”的边界证据；拒绝生成 OPE 数值。 |
| Q4 | **Counterfactual Risk Minimization: Learning from Logged Bandit Feedback** — Adith Swaminathan、Thorsten Joachims，2015，ICML 2015，PMLR 37:814–823，官方 [PMLR 页面](https://proceedings.mlr.press/v37/swaminathan15.html) 与 [PDF](https://proceedings.mlr.press/v37/swaminathan15.pdf)，`abstract_or_public_description` | CRM 使用 propensity scoring，并需控制 inverse-propensity estimator 的方差；这是 logged bandit evidence 的统计方法，不是 synthetic ranking digest。 | 不定义数据库 PIT；仍要求同一可解释的 logged event/context。 | 需要 behavior policy probability 和足够 support；概率缺失或极小会带来不可控方差。 | 摘要未证明本仓库数据满足 assumptions；不能把 simulated draw 当真实 logging policy。 | Rust randomized policy contract 虽有 private synthetic receipt，但当前 feed continuation 没有 real propensity。 | **采用**支持/方差门槛；拒绝把 cursor fixture 升级成 finite-sample inference。 |

## 三种 cursor 方案与竞争方案

| 方案 | 必需合同与资源 | 没有这些条件时的失败 | 本阶段决定 |
|---|---|---|---|
| 复合 keyset cursor | `cursorVersion`、`orderingVersion`、完整 tuple、query/filter fingerprint；每个 source 使用同方向谓词和 compound index；in-network 至少 `(createdAt, postId, authorId)`，general 还要冻结 `score`。 | equal timestamp/score、排序版本或 filter 变化会 miss/duplicate；score update 会让同一候选跨边界移动；旧 Date-only token 无法无损升级。 | `CONDITIONAL GO`，只做 private offline/shadow。 |
| opaque serving-state cursor | token 引用或签名 immutable ordered IDs/scores、剩余位置、query/filter digest、ordering version、权限上下文和 PIT/state；跨 replica 共享，带 TTL/GC、容量、撤销和恢复合同。 | state eviction/expiry、跨进程不一致、候选删除、权限变化、PIT 过期或 token replay；只存 hash/stable key 不足以恢复 remainder。 | production `NO-GO`；可作未来 offline replay harness 对照组。 |
| fail-closed abstention | 发现 general cursor 无法证明稳定时，返回 terminal empty continuation、`has_more=false`、`next_cursor=None` 和可观测 reason。 | 可用性降低，但不伪造“还有下一页”的保证；它不能修复 in-network source-level Date-only 风险。 | production `GO`，继续保留。 |
| 只加 score fence / 只把 DateTime base64 | O(1) token，几乎没有 state 成本。 | equal score、score update、refresh、fallback 或 query change 仍可遗漏/重复；签名只能防篡改。 | `NO-GO`。 |
| offset/base64（竞争方案） | 需要底层数组/结果集静态，或额外保存数组版本。GraphQL Relay 的官方参考实现明确注明 array-offset 分页只在 array static 时成立。 | 插入/删除会移动 offset；opaque 编码不改变这个事实，深页还会增加扫描。 | `NO-GO`，不作为本仓库 cursor 修复。 |

### mutable score 的关键推论

即使 general cursor 携带 `(score, createdAt, postId, authorId)`，如果下一请求重新计算 score：

- 页后一项的 score 上升到边界之前，可能插入已返回前缀，造成重复或顺序漂移；
- 已返回项的 score 下降到边界之后，可能再次满足查询，或挤出原本应返回的项；
- 新候选、删除、权限过滤和 source fallback 会改变 candidate universe。

因此 general cursor 至少需要 immutable ordering version、保存 replay remainder，或明确 abstain。
完整 tuple 只能解决 tie-breaking，不能凭空制造 snapshot guarantee。

## Redis 与 Mongo 的仓库映射

### Redis

1. `ZRANGE/ZREVRANGEBYSCORE` 的 score tie 是 member 字典序；当前 Rust serving 要求
   `postId/authorId` 的业务顺序，Node merge 却只比较 numeric `score`，因此相同 score 的跨作者
   顺序未定义为 Rust canonical order。
2. `cursor.getTime() - 1` 只排除严格更晚/相等的时间分数，不携带 member tie；同一毫秒的成员
   可能被边界跳过。
3. Redis pipeline 或 `MULTI/EXEC` 可保证命令执行不被其他命令插入，但不产生一个后续 HTTP 请求
   可继续使用的 retained snapshot；Redis 与随后 Mongo hydration 也不共享视图。
4. score 更新会改变 sorted-set 位置，double 精度和大 offset 成本也不能被业务层忽略。

### Mongo

1. `createdAt` 重复时，仅按时间 sort 不能保证持续写入期间的重复值顺序；官方建议包含唯一字段。
2. 正确的单源 keyset 需要 `ORDER BY` 与边界谓词同构，例如降序 `(createdAt, _id)` 配套
   `$or`/`$lt` 条件，并配 compound index。
3. 普通读取在并发更新/删除/插入下不是 point-in-time；官方记录了 cursor duplicate 和 missing
   matching document 的情形。`readConcern: snapshot` 只在特定 transaction/find/aggregate
   场景建立快照，并有 majority/history-window 成本。
4. 当前 Node 路径没有把 Redis、Mongo hydration、Rust retrieval 放进同一 session/PIT；所以
   source-level 结果不能拼成一个不可变 feed snapshot。

## Diagnostics-only 安全范围

### 允许的 offline/shadow 断言

将来若继续，只允许在 private Rust `cfg(test)` 或明确标记的 shadow harness 中：

1. 构造小型 frozen candidate universe，覆盖相同 timestamp、相同 score、跨 source duplicate、
   insert/delete、filter 变化和 score mutation。
2. 用完整 tuple + `orderingVersion` + query/filter fingerprint 分页，并把拼接页与一次性冻结
   全排序对比：`duplicate_rate`、`omission_rate`、`order_mismatch_rate`、`has_more` 真实性。
3. 对旧 Date-only cursor、版本/模式/fingerprint 不匹配、PIT/state 过期和超资源输入执行
   `not_evaluable`/abstention；不猜测缺失 tuple 字段。
4. 记录 candidate/order digest、cursor bytes、replay-state bytes、页数和峰值缓冲等结构性
   诊断；所有上限必须是有限且可测试的。
5. Rust 保持排序/概率/RNG 的唯一 owner；若未来有 Node receipt，Node 只验证 schema、digest、
   resource receipt 和状态，不复制 Rust comparator、概率或 RNG。

### 明确禁止的越界解释

- 不把 frozen fixture 的“无重复/无遗漏”称为线上 feed quality、CTR、utility 或 user safety；
- 不在没有真实 impression/action log、logging propensity、support、PIT viewer/time provenance
  和 immutable source receipt 时运行 IPS/DR/CRM 或 finite-sample inference；
- 不把 `stable_order_key`、cache fingerprint、Decision Log/trace 或 synthetic receipt 当作
  authoritative evidence、candidate qualification 或 promotion root；
- 不修改 `FeedQuery.cursor`、恢复 general continuation、启用 exploration/randomized serving，
  或改变 `selectedMethod`/eligibility flags；
- 不以“opaque”或“signed”作为 snapshot、完整性、可回滚或跨存储一致性的替代品。

## Repo-specific feasibility

| 维度 | 当前证据 | 结论 |
|---|---|---|
| 数据与 PIT | Rust 只生成 DateTime next cursor；Node 只持有 `Date`；Redis、Mongo、Rust 没有共同 PIT/state owner；真实 immutable evidence 不可用。 | 在线 cursor-v2 不可授权；offline frozen fixture 可行。 |
| 顺序与 ownership | Rust `stable_order` 是 serving 顺序 owner；Node source 自己有 Redis/Mongo 查询排序；随机概率/RNG 仍由 Rust owning rule 管理。 | 不能在 Node 复制 Rust comparator，也不能在 Rust 假设 Node source 已冻结。 |
| 延迟/内存 | stateless tuple token 的每请求状态近似 `O(1)`，但 compound index 和 source merge 有成本；opaque state 按 remainder `O(R)`，还需 TTL/GC/PIT keep-alive；abstention 近似 `O(1)`。当前 fixture 限制 16 candidates/8 page size。 | 先做 bounded offline 资源断言；不为线上 state 引入未经批准的 Redis schema。 |
| fallback | Redis miss 会进入 in-process cache 或 Mongo direct fallback；来源、排序和 freshness 可变。 | fallback 只能作为可观测降级，不能作为跨页一致性证据。 |
| observability | `stable_order_key`、`ranked_cursor_abstention` 和 source stage details 可说明当前路径/顺序身份。 | 记录 mismatch/rejection reason；不把 digest 当 replay state 或 evidence brand。 |
| rollback/兼容 | 生产仍是 Date-only API；新 tuple 若直接替换会遇到旧 token、滚动部署和客户端缓存。 | 未来必须 version namespace、旧 token 明确 reset/abstain、双读隔离和回滚测试；本阶段不改 API。 |
| authorization | 当前 flags 固定 `diagnostics_only_abstention_v1`、`not_run`、`false`；无 real data/propensity/support。 | 只有结构性 offline/shadow GO；utility/OPE/qualification/promotion 均 NO-GO。 |

## 最小后续计划（不在本阶段实现）

1. 先扩展现有私有 Rust fixture 的 source merge、filter mutation、state expiry 和 resource
   assertions；保持 `CursorError::NotEvaluable` fail closed。
2. 若要评估 production composite cursor，先由 owner 定义 source-by-source compound index、
   PIT/state 生命周期、排序版本、权限/删除语义和旧 cursor migration；完成后重新过 research
   gate。
3. 只有在 real immutable evidence、viewer/time provenance、logging propensity、support、
   outcome join 和 rollback authorization 完整后，才重新审查 OPE/qualification；论文结果不
   替代仓库实证。

## 最终判定

| 范围 | 判定 |
|---|---|
| 当前 general `ranked_cursor_abstention_v1` | `GO / retain as production fail-closed baseline` |
| in-network composite keyset | `CONDITIONAL GO / offline-shadow only` |
| general composite tuple without frozen score | `NO-GO` |
| opaque serving-state cursor in production | `NO-GO / missing shared owner and PIT lifecycle` |
| bounded offline cursor-consistency fixture | `CONDITIONAL GO` |
| online cursor/API or source query change in this phase | `NO-GO` |
| real utility/OPE/propensity/qualification/promotion/exploration | `UNAVAILABLE / NO-GO / UNAUTHORIZED` |
