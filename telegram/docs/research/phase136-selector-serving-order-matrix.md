# Phase 136：Selector 与 Serving 排序合同

## 范围与结论

本阶段只处理 Rust selector 在截断前与 serving 在输出前使用不同 tie-break 的合同漂移。
不恢复 general-feed continuation，不改变 `diagnostics_only_abstention_v1`、真实数据准入、OPE、
随机策略或 promotion 边界。

结论为 `CONDITIONAL GO`：

- 采用 serving 的 canonical 全序作为 selector 的唯一排序实现，避免平局候选在 selector 截断时永久丢失。
- 将 selector policy 升级为 `rust_top_k_selector_policy_v2`，并把该版本加入 serve-cache key namespace，
  使滚动部署期间旧 selector 结果不会与新结果混读。
- 保留 `ranked_cursor_abstention_v1`。selector tie-break 对齐不能解决 createdAt-only cursor、可变 score
  或跨 source snapshot 缺失。

## 当前代码事实

- `selectors/top_k/candidates.rs` 原先使用 `score DESC, createdAt DESC, postId ASC, authorId ASC`
  （in-network 没有 score）；`serving/stable_order.rs` 使用同一主序但 `postId/authorId DESC`。
- `select_candidates_with_report` 在 in-network 路径先排序再 `truncate(target_size)`；general 路径先形成
  有限 window，再由约束状态机选择。serving 只重排已经选出的候选，不能恢复被 selector 丢弃的 ID。
- selector policy 版本只出现在 stage detail/runtime definition，不在结果顶层；serve cache fingerprint
  只由 query 组成。因此只升级 selector 字面量而不改 cache namespace 会留下旧结果混读窗口。

## 研究问题

1. 平局方向是否会改变 selector 的候选集合，而不只是最终展示顺序？
2. selector 与 serving 是否应共享一个 canonical comparator，避免顺序实现再次分叉？
3. policy 版本变化时，现有 cache key/读取合同能否隔离旧结果？
4. 在不恢复 ranked continuation 的前提下，如何验证 tie-break 修复没有伪造 utility 或 snapshot 证据？

## Evidence matrix

| 来源 | 精确元数据与阅读状态 | 对本仓库的约束 |
|---|---|---|
| **cursor.skip()** — MongoDB Documentation Team，living MongoDB Manual，无固定出版年，官方 [文档](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/)，`full_text` | 持续分页的排序应包含唯一字段；重复排序值在写入变化时可能产生不一致顺序。 | `postId/authorId` 必须成为稳定 tie-break；时间字段单独排序不能证明集合一致性。 |
| **Paginate search results** — Elastic Documentation Team，living Elasticsearch Reference，无固定出版年，官方 [文档](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)，`full_text` | `search_after` 必须复用相同 query/sort，并携带上一页最后结果的完整 sort values；没有唯一 tie-break 会 miss/duplicate，PIT 才能固定索引状态。 | selector/serving 应共享完整、确定的顺序；该证据不授权在当前没有 PIT 的系统中恢复 general cursor。 |
| **Row Constructor Comparison** — PostgreSQL Global Development Group，PostgreSQL 15 Reference，无固定出版年，官方 [文档](https://www.postgresql.org/docs/15/functions-comparisons.html)，`full_text` | 行比较按字段从左到右的词典序进行，前缀相等时才比较后续字段。 | 排序和边界必须使用同一字段顺序；不能让 selector 与 serving 各自定义相反的 tie-break。 |
| **Evaluating Top-k Selection Queries** — Surajit Chaudhuri、Luis Gravano，VLDB 1999，官方 [条目](https://www.vldb.org/dblp/db/conf/vldb/ChaudhuriG99.html)，`abstract_or_public_description` | top-k 的候选截断依赖排序谓词；排序合同变化会改变 top-k 集合，而不是只改变显示。 | `target_size < tie group` 时需要 set-level 回归；不把 synthetic 结果解释为 utility。 |

## 方案与决定

| 方案 | 失败模式 | 决定 |
|---|---|---|
| selector 复用 serving canonical comparator，policy v2，cache key 带 policy namespace | 仍不解决 mutable score、跨 source snapshot 和 Date-only cursor | **采用**，这是本阶段最小修复 |
| 只修改 selector tie-break，不升级版本或隔离 cache | 滚动部署期间旧/新集合可能混读，诊断版本不能解释结果来源 | **拒绝** |
| 只新增 offline mismatch fixture，不修 production selector | 能发现漂移但线上仍会丢 tie 候选 | **拒绝为本阶段唯一措施**，保留为未来 cursor-v2 shadow 研究手段 |
| 恢复 general-feed composite/opaque cursor | score 可变且没有共同 PIT/replay state | **NO-GO**，继续 abstention |

## 验收边界

- in-network 与 general 各有一个 `target_size` 小于平局组的回归，断言 selected ID 使用 serving 全序。
- cache key 回归断言包含 `SELECTOR_POLICY_VERSION`；旧版本 key 不可与新版本相同。
- 更新 replay fixture 的 selector policy version 与 manifest digest，保持跨运行时合同一致。
- 只验证 ID 集合、顺序、版本和缓存隔离；不生成 CTR、utility、propensity、support、qualification 或 promotion 证据。

