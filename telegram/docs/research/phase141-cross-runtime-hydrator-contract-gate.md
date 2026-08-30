# Phase 141：跨运行时 Hydrator 与候选字段合同门禁

更新时间：2026-08-30

## 范围与结论

本阶段只记录 Rust 与 Node recommendation runtime 之间的合同漂移，不启用新的
hydrator、过滤器或评分语义，也不改变在线请求/响应 schema。该问题不是当前
diagnostics-only 结果的可安全小修复：补齐字段会让现有 Rust 过滤器看到此前在 Node
边界被剥离的数据，补齐 hydrator 则会改变候选特征和失败路径。

结论：**当前阶段 `NO-GO` 直接修复，`CONDITIONAL GO` 作为 live qualification 的发布
前置门禁。** 在完成下面的 parity、往返、失败闭合和部署兼容验收前，不得把该链路当作
可用的真实候选资格或生产排序依据。

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

以下事实先由当前唯一 codebase-memory 索引定位，再用源码核对；覆盖检查对所列文件没有
记录问题，但该信号不是完整性证明。

### Hydrator catalog 漂移

| 运行时 | 当前合同 | 证据 |
|---|---|---|
| Rust | `CANDIDATE_HYDRATOR_NAMES` 导出 10 个名称：`AuthorInfoHydrator`、`UserInteractionHydrator`、`VideoInfoHydrator`、`HasMediaCandidateHydrator`、`VideoDurationCandidateHydrator`、`EngagementCountsCandidateHydrator`、`QuoteCandidateHydrator`、`MutualFollowJaccardCandidateHydrator`、`TweetTypeMetricsCandidateHydrator`、`FollowingRepliedUsersCandidateHydrator`。 | `telegram-rust-workspace/crates/telegram-component-primitives/src/candidate_hydrators.rs:3-27` |
| Node | `buildRecommendationHydrators()` 只注册 `AuthorInfoHydrator`、`UserInteractionHydrator`、`VideoInfoHydrator`。 | `telegram-clone-backend/src/services/recommendation/internal/componentCatalog.ts:166-172` |
| Rust → Node | live ranking hydration 会把配置中的候选 hydrator 名称发送到 Node `/hydrate`。 | `telegram-rust-workspace/crates/telegram-rust-recommendation/src/pipeline/executor/ranking_stage.rs:69-104` |
| Node 失败语义 | `resolveHydrators` 对其 catalog 外的名称抛出 `unknown_hydrator:<names>`；当前路由没有把未知名称转换为可验证的 stage receipt。 | `telegram-clone-backend/src/services/recommendation/internal/adapterService.ts:779-797`、`telegram-clone-backend/src/routes/recommendationInternal.ts:67-71` |
| 运行归属 | Rust manifest 将 candidate hydrators 标记为 Node provider、critical，fallback 为 `stage_detail`。 | `telegram-rust-workspace/crates/telegram-rust-recommendation/src/candidate_pipeline/manifest.rs:49-60` |

因此，未来一旦启用真实 ranking，Rust 默认配置会请求 Node 当前不存在的 7 个名称；这
是 qualification 前的 release blocker，而不是应在本阶段悄悄改成“忽略未知组件”的兼容性
行为。

### 候选字段往返漂移

Rust `RecommendationCandidatePayload` 支持而 Node `RecommendationCandidatePayload`、Zod
schema、serializer/deserializer 均未声明的字段至少包括：

```text
topicIds, hasMedia, mediaType, videoDurationMs, authorBlocksViewer,
languageCode, isSubscriptionOnly, postType, mutualFollowJaccard,
followingReplied
```

Node 的 Zod object 默认会剥离这些未知键。Rust 本地 pre-score filters 已读取其中的
`topicIds`、`authorBlocksViewer`、`isSubscriptionOnly` 等字段；因此把字段加入 Node
合同不是无害的透传修复，而可能直接改变过滤结果、候选数量和降级统计。`mediaType` 的
枚举值还必须保持 Rust 的 `none|photo|video|gif|mixed` wire 表示。

证据：

- Rust 字段定义：`telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/candidate.rs:161-272`。
- Node interface/schema：`telegram-clone-backend/src/services/recommendation/rust/contracts.ts:106-169,548-631`。
- Node stage request 在 `/hydrate`、`/filter`、`/score` 前复用该 schema：`telegram-clone-backend/src/routes/recommendationInternal.ts:67-71`。

## Qualification 前置验收

在任何 `candidateQualificationStatus` 变更、真实 ranking 或 production exploration 之前，
必须由 Rust 作为行为 owner、Node 作为合同/receipt owner 完成以下门禁：

1. **Catalog parity**：由同一版本化清单或双端 fixture 比较 Rust 配置名称与 Node 可执行名称；未知、重复、顺序漂移必须在请求前 fail closed，并带可检索的版本/组件列表。
2. **Candidate round-trip**：构造包含上述 10 个字段及 `MediaType` 每个枚举值的 fixture，验证 Rust → Node `/hydrate` → `/filter` → `/score` → Rust 的字段保留、默认省略和类型错误；禁止未知字段静默丢失而仍报告成功。
3. **Semantic ownership**：逐字段标注产生方、读取方、默认值和过滤/评分影响；若恢复字段会激活已有 Rust 逻辑，必须有 before/after 离线基线和明确回滚开关。
4. **Version/deployment compatibility**：请求、响应、catalog 和候选 schema 需要可检测的版本握手；滚动发布期间旧 Node/新 Rust 与新 Node/旧 Rust 均须有确定的拒绝或兼容结果。
5. **Failure and observability**：未知组件、字段类型错误、部分 hydrator 失败和 stage 超时都要进入结构化 stage detail/receipt，不能把原候选伪装成已完成 hydration；资源上限和 fallback 结果必须可审计。
6. **Bounded end-to-end evidence**：只在 private/offline 或明确 shadow harness 中运行有限候选夹具，检查字段 digest、stage 数量、顺序、重复/遗漏和错误分类；不将其解释为 utility、OPE、propensity、真实数据资格或 promotion 证据。

## 本阶段决定

- **接受**：保留当前 Node schema 与 Rust catalog 不变，先把 parity 与 round-trip 作为 live qualification 的硬门禁。
- **拒绝**：现在直接扩展 Node schema、补齐 7 个 Node hydrator、忽略未知名称、或把字段剥离改成静默兼容；这些动作都会扩大生产行为面，且当前没有 real dataset、PIT、propensity、support 或可回滚证据。
- **后续最小实现顺序**：先建立版本化 catalog/字段 fixture 和 fail-closed preflight，再由各自 owner 分批实现 provider 与字段映射，最后才评估是否进入候选资格流程。

本记录跳过外部算法研究：变更对象是跨运行时合同和发布门禁，不是 scorer、ranker、policy、
OPE 或统计推断语义。
