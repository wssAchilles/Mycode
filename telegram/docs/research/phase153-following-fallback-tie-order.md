# Phase 153：关注流 fallback tie-order

## 范围与判定

本阶段只修复 Node 关注流 Mongo fallback 在单次取数和合并截断前的同时间排序。
不改变 Date-only cursor、跨请求 snapshot/PIT、Redis 主路径、general ranked continuation、
随机策略、真实数据准入或 promotion 开关。

判定：`CONDITIONAL GO`，仅把真实 Mongo 文档的唯一 `_id` 作为 `postId DESC` tie-break
向 fallback 路径传播；跨请求一致性仍为 `NO-GO`。

## 研究问题

1. fallback 的 Mongo 查询或作者合并是否在 `MAX_RESULTS` 截断前依赖输入顺序处理同一 `createdAt`？
2. Mongo 文档的唯一 `_id` 是否足以复用 Rust 的 `createdAt DESC, postId DESC` 顺序？
3. 修复能否限制在单次 fallback 结果而不伪装解决 Date-only cursor/PIT 边界？
4. 哪个最小回归能证明反向输入顺序不会改变同时间首项？

## 变更前基线与证据

- 变更前，`FollowingTimelineCache.getPostsForAuthors` 的共享查询、作者回填查询和最终数组排序都只使用
  `createdAt DESC`；共享查询结果会先按作者上限聚合，随后才返回给 `FollowingSource` 截断。
- 变更前，`FollowingSource` 的 direct Mongo fallback 只使用 `.sort({ createdAt: -1 })`，结果直接限制为
  `MAX_RESULTS`。当前实现已在这三个查询/合并点增加 `_id DESC`，下述方案即为该修复的边界。
- `Post` 的 Mongo `_id` 对每个文档唯一；Rust serving 的 in-network canonical order 是
  `createdAt DESC, postId DESC, authorId DESC`。唯一 `_id` 已经覆盖 postId 层，authorId 只在
  非唯一 postId 的跨源夹具中才有观测意义。
- Phase 140 的官方 Mongo/Redis/Rust 证据已说明：重复 sort 值需要唯一 tie-break；这不等于
  跨请求 snapshot，也不能修复 `createdAt < cursor` 的同毫秒遗漏。

外部检索跳过：本阶段是已有合同证据约束下的窄排序传播，不引入新的算法或统计假设。

## 方案矩阵

| 方案 | 代价与失败模式 | 判定 |
|---|---|---|
| Mongo sort 增加 `_id DESC`，内存合并同样按 `_id DESC` | 保持时间主序；真实文档唯一键提供确定性单页截断；仍不解决 Date-only cursor/PIT。 | **采用** |
| 继续只按 `createdAt` | 写入顺序、Mongo 执行计划或作者输入顺序可改变截断集合。 | **拒绝** |
| 将 fallback 改为复合生产 cursor/PIT | 需要跨 Redis/Mongo/Node 的版本、快照和生命周期合同，超出本阶段。 | **NO-GO** |

## 验收边界

- 只验证 fallback 单次排序和截断前稳定性，不输出 utility、OPE、propensity、support、
  qualification 或 promotion 证据。
- Rust 仍是 serving canonical owner；Node 仅在 fallback source 边界复用 `postId` tie-break。
- `selectedMethod=diagnostics_only_abstention_v1`、`candidateQualificationStatus=not_run`、
  `realDatasetEligible=false` 保持不变。

## 最终判定

`CONDITIONAL GO`：为 cache/direct fallback 增加 `_id DESC` tie-order 回归，并将同毫秒
Date-only cursor/PIT 风险保留为独立后续合同研究项。
