# Phase 151：In-network 合并 tie-order

## 范围与判定

本阶段只修复 Node Redis in-network 时间线在截断前的同分候选确定性排序。
不改变 Date-only cursor、跨页 snapshot、general ranked continuation、随机策略、
真实数据准入或 promotion 开关。

判定：`CONDITIONAL GO`，只允许把既有 Rust serving 顺序向前传播到 Node 的
候选合并边界；跨请求一致性仍为 `NO-GO`。

## 研究问题

1. Redis 每个作者返回的同分成员在跨作者合并后，当前顺序是否仍由输入顺序决定？
2. 哪个 tie-break 能与 Rust 已有的 in-network canonical order 对齐而不改变时间主序？
3. 修复能否限制在单次候选截断前，并明确不声称修复 Date-only cursor 的跨页遗漏？
4. 哪个最小回归能证明反向 pipeline/author 输入仍得到同一候选顺序？

## 当前代码事实

- `InNetworkTimelineService.getMergedPostIdsForAuthorsWithSummary` 从每个作者的 Redis
  ZSET 读取 `(postId, createdAtMs)`，跨作者只按 `score` 降序排序；同分项依赖 pipeline
  顺序和 JavaScript stable sort。
- 该结果在 `FollowingSource` 中先被 `MAX_RESULTS` 截断并用于 Mongo hydration，
  因此同分顺序会影响候选是否进入后续 pipeline。
- Rust `serving::stable_order::compare_candidates` 已冻结 in-network 顺序为
  `createdAt DESC, postId DESC, authorId DESC`。Phase 139/140 的证据矩阵已记录
  唯一 tie-break 对 top-k 截断和单次重放确定性的必要性。
- Redis/Mongo 没有共同跨请求 PIT；当前 `cursor.getTime() - 1` 仍会排除同一毫秒的
  后续帖子，本阶段不扩大 cursor 合同来掩盖该问题。

## 证据与方案

外部检索跳过：这是由 Phase 139/140 已完成的官方 Rust `sort_by`、Mongo range/sort、
Redis ZSET tie 规则证据直接约束的窄合同对齐，不引入新的算法假设。

| 方案 | 代价与失败模式 | 判定 |
|---|---|---|
| 在 Node Redis merge 末尾追加 `postId DESC, authorId DESC` | `O(n log n)`，不改变时间主序；仍不解决 cursor/PIT。 | **采用** |
| 只保留 `score`，依赖 Redis/pipeline 输入顺序 | 作者顺序、Redis member 顺序或执行计划变化会改变截断集合。 | **拒绝** |
| 直接改为复合生产 cursor 或 opaque serving state | 需要 Node/Rust/Redis/Mongo 共同 PIT、版本和生命周期合同，超出本阶段。 | **NO-GO** |
| 让 Node 重算 Rust 的最终 score | 改变 owner 边界并可能改变排序主语义。 | **拒绝** |

## 最小执行与边界

- Rust 仍是 serving canonical owner；Node 只在 source merge 处复用相同 identity tie-break。
- 只验证单次顺序和截断前的稳定性，不输出 utility、OPE、propensity、support、
  qualification 或 promotion 证据。
- `selectedMethod=diagnostics_only_abstention_v1`、`candidateQualificationStatus=not_run`、
  `realDatasetEligible=false` 保持不变。

## 最终判定

`CONDITIONAL GO`：实施一个 Node Redis in-network merge tie-order 修复，并保留
Date-only cursor 的跨页遗漏作为后续独立合同/研究项。
