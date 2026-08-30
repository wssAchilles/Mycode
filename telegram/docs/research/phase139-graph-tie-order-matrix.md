# Phase 139：Graph Source Tie-Order 矩阵

## 范围与结论

本阶段只处理 Rust graph source 在进入后续 hydration、scoring 和 selector 前的确定性 tie-order。
不改变 graph author rank 的语义，不改 Node 物化查询、feed cursor、general continuation、随机策略、真实数据准入或 promotion。

结论为 `CONDITIONAL GO`：

- 保留 `graphKernelRank ASC` 与 `createdAt DESC` 作为 graph source 的主序。
- 对相同 rank 和时间追加 canonical `postId DESC`、`authorId DESC` tie-break，使同一输入集合产生确定顺序。
- 只在 Rust graph source 的 `sort_graph_candidates` 和其 `cfg(test)` 回归中实现；不复用 serving 的完整 score comparator，因为 graph source 仍须按 graph rank 排序。
- 保留 `ranked_cursor_abstention_v1`。此修复只稳定预选择输入顺序，不能证明跨页 snapshot、mutable score 或 utility。

## 当前代码事实

- `telegram-rust-workspace/crates/telegram-rust-recommendation/src/sources/graph_source/direct.rs:49-144`
  在 `retrieve_direct_candidates` 中先物化帖子、应用 `graphKernelRank`，再调用 `sort_graph_candidates`。
- `direct.rs:283-303` 当前只比较 `graphKernelRank` 和 `created_at`；相等时依赖物化结果的输入顺序。
- `telegram-rust-workspace/crates/telegram-source-primitives/src/graph_kernel.rs:87-113`
  已按 `total_score DESC`、`dominant_score DESC`、`user_id ASC` 稳定产生作者 rank；同一作者的多个帖子仍共享 rank。
- `telegram-clone-backend/src/services/recommendation/providers/graphKernel/authorPostMaterializer.ts:141-248`
  的查询按 `createdAt DESC, engagementScore DESC, _id DESC`，但 Rust candidate 合同没有独立的 engagementScore 字段，不能在 Rust 重建该字段。
- `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/stable_order.rs:12-31`
  的 canonical serving tie-order 是 `createdAt DESC, postId DESC, authorId DESC`（general 还先比较 score）。
- graph source 结果随后进入 `execute_retrieval_stage`、hydration、scoring 和 selector；因此这里的相等顺序可能影响顺序敏感的 diversity/selector 状态，即使候选集合相同。

## 研究问题

1. 同一 graph rank 和时间的候选当前是否依赖数据库/HashMap/物化输入顺序？
2. 哪个 tie-break 方向能与 Rust serving 的既有 canonical order 对齐，同时不改变 graph rank 主语义？
3. 预选择 tie-order 是否会改变候选集合或后续顺序敏感的 scoring/selector 行为，而不只是最终展示顺序？
4. 使用 Rust stable sort 的最小 comparator 扩展，其时间、内存和非有限值风险是什么？
5. 能否把修复限制在 deterministic diagnostics/retrieval order，并明确不解除分页和生产准入边界？

## Primary-source evidence matrix

| 来源 | 精确元数据与阅读状态 | 对本仓库的约束 |
|---|---|---|
| **slice::sort_by** — Rust Documentation Team，living Rust standard library reference，无固定出版年（访问 2026-08-30），官方 [文档](https://doc.rust-lang.org/std/primitive.slice.html)，`full_text` | `sort_by` 是稳定排序，复杂度为 `O(n log n)`；比较器必须形成一致的全序，否则结果未指定。相等元素会保留输入顺序。 | 当前 comparator 返回 `Equal` 的 tie 依赖上游输入；追加唯一字符串键可以把该分支变成确定全序，且不需要新依赖。graph rank 已由合同约束为有限数值。 |
| **Row Constructor Comparison** — PostgreSQL Global Development Group，PostgreSQL 15 Reference，无固定出版年（访问 2026-08-30），官方 [文档](https://www.postgresql.org/docs/15/functions-comparisons.html)，`full_text` | 行比较从左到右，前缀相等时才比较后续字段；这种词典序支持一致的排序与索引行为。 | graph source 应保持 `rank → createdAt → postId → authorId` 的字段顺序，不能把 tie-break 提前改变 rank 语义。 |
| **Paginate search results** — Elastic Documentation Team，living Elasticsearch Reference，无固定出版年（访问 2026-08-30），官方 [文档](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)，`full_text` | 稳定分页/排序需要复用完整 sort values 和唯一 tie-break；refresh/PIT 问题另属 snapshot 生命周期。 | 采纳唯一 tie-break 对单次排序确定性的结论；不把本阶段的 comparator 改动解释成 cursor 或 snapshot 修复。 |
| **Evaluating Top-k Selection Queries** — Surajit Chaudhuri、Luis Gravano，VLDB 1999，第 25 届 VLDB，397–410，官方 [条目](https://www.vldb.org/dblp/db/conf/vldb/ChaudhuriG99.html)，`abstract_or_public_description` | top-k 的 range/排序谓词决定返回的 top-k 集合；排序合同变化可能影响截断集合。 | graph source 顺序在 selector 截断前，因此需要 ID 顺序回归，而不能只验证最终 serving 展示。 |

## 方案比较

| 方案 | 失败模式/成本 | 决定 |
|---|---|---|
| 在 graph comparator 末尾追加 `postId DESC, authorId DESC` | `O(n log n)` 稳定排序，无额外长期状态；不改变 rank/date 主序。仍不解决 mutable score 或分页 snapshot。 | **采用（CONDITIONAL GO）** |
| 复用 `serving::compare_candidates` | serving comparator 以最终 score 为首键，会覆盖 graph rank 语义，可能改变 graph source 的作者召回优先级。 | **拒绝** |
| 只保留 stable sort，依赖物化输入顺序 | HashMap、数据库执行计划或缓存命中可改变相等元素输入顺序，无法保证跨运行重放。 | **拒绝** |
| 改 Node 物化查询并同步新增 engagementScore 合同 | 触及 Node/Rust 跨语言合同和更多字段；当前问题可由已有 candidate identity 字段解决。 | **拒绝为本阶段范围** |
| 恢复 production composite/opaque feed cursor | 需要共同 PIT/replay state，且 general score 可变；超出本阶段并违反现有 abstention 边界。 | **NO-GO** |

## 仓库可行性与安全边界

- Rust 是随机化政策、候选顺序和 serving comparator 的 canonical owner；本阶段只改 Rust，不让 Node 重新实现排序。
- `post_id` 与 `author_id` 在 candidate 合同中均为非可选字符串，适合作为确定性 tie-break；不引入哈希或时间戳猜测。
- `sort_by` 已存在，候选数量受 graph/materializer 上限约束；追加两个字符串比较不会改变资源上限或缓存 key。
- 只验证 ID 顺序、主序保持、重复输入的确定性；不生成 CTR、utility、propensity、support、qualification 或 promotion 证据。
- 对现有 Date-only cursor、跨 source snapshot、score mutation 和 `ranked_cursor_abstention_v1` 保持原行为；这些问题仍需单独的 cursor 研究和授权。

## 最小执行与验收

1. 在 `sort_graph_candidates` 追加 `post_id DESC`、`author_id DESC`。
2. 添加一个 `cfg(test)` 回归：相同 rank/时间、反向输入的候选得到相同 `post_id` 顺序；同时断言更高 rank 和更新日期仍优先。
3. 运行 graph source/Rust recommendation focused tests、`cargo fmt --all -- --check`、locked Clippy/Cargo tests 和 diff check。
4. 独立复核后提交；不修改任何 feed cursor 或实验开关。

## 最终判定

`CONDITIONAL GO`：接受一个只影响 graph source 单次输入确定性的 Rust comparator 修复；生产 ranked continuation、探索、真实数据准入和 promotion 仍保持原有 fail-closed/未授权状态。
