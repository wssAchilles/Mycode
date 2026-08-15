# Phase 31 Snapshot-Bounded Diagnostic Source

更新时间：2026-08-15

## 结论

Phase 31 对已有 replay exporter 的 source read 加固为 `GO`，范围仍是
`diagnostic_only_unverified_source`。本阶段保证入选 trace、Decision Log 和 outcome action
从同一 MongoDB snapshot session 读取，并消除一次性 materialize 全部 trace 的客户端内存路径。

Authoritative capture source 仍为 `NO-GO`。当前 serving completion 是 fire-and-forget，缺少
eligible-decision denominator、retention/erasure owner 和响应前持久化授权；一致快照不能重建从未写入的决策。

本阶段不改变 scorer、ranker、policy、OPE 或统计推断语义，因此不追加算法论文研究。隐私与
来源治理继续引用 Phase 26、29 的 NIST SP 800-188、NIST SP 800-57、MongoDB TTL 和 RFC 9162
evidence matrix。

## 代码事实

- `recordServedFeedTrace` 在 page 构造后以 `void` 调用，trace 和 Decision Log 写入失败只告警。
- `RecommendationTrace` 是保存原始 identity 的可变 upsert 文档，没有 TTL 或 epoch completeness root。
- replay exporter 是唯一 consumer-backed offline source reader；没有 route、worker、scheduler 或 runtime caller。
- Phase 22 real intake 的九个真实 evidence root 仍全部为 `null`。
- MongoDB/Mongoose 已在 graph generation 和 embedding audit 中使用 session-bound snapshot read 模式。

## 研究问题

1. 如何让 trace 与 outcome action 在同一 PIT 视图中读取？
2. 如何避免最多 8,192 个完整 trace 同时进入 Node 堆？
3. 如何在不复制 evaluator 或 outcome 数学的情况下保持原输出？
4. 哪些 source binding 漂移必须在 outcome 查询和发布前拒绝？
5. 一致快照能否证明 capture completeness 或 real-evidence eligibility？

## Evidence Matrix

| 来源 | 前提与限制 | 仓库映射 | 决策 |
|---|---|---|---|
| MongoDB, Inc., *Read Concern `snapshot`*, MongoDB Manual v8.2, [官方](https://www.mongodb.com/docs/v8.2/reference/read-concern-snapshot/), `full_text` | 支持同一时间点的 majority-committed snapshot；读取超过 snapshot history window 时可能终止。 | exporter 对同一 session 的 trace/action 查询顺序执行；任何 session/query 失败 whole-export fail closed。 | 采用 snapshot session；不把它解释为 completeness proof。 |
| MongoDB, Inc., *ClientSessionOptions*, Node.js Driver API, [官方](https://mongodb.github.io/node-mongodb-native/7.0/interfaces/ClientSessionOptions.html), `full_text` | `snapshot:true` 使 session 内读取使用同一 snapshot，且与 causal consistency 互斥。 | `mongoose.startSession({snapshot:true, causalConsistency:false})`，所有 source query 显式绑定该 session。 | 采用；禁止并行使用 session。 |
| MongoDB, Inc., *Perform Long-Running Snapshot Queries*, MongoDB Manual, [官方](https://www.mongodb.com/docs/manual/tutorial/long-running-queries/), `full_text` | snapshot read 仍受可用历史窗口和部署拓扑约束。 | 不加入 fallback 到普通 read；部署不支持时稳定失败。 | 采用 fail-closed 边界。 |

## 方案比较

| 方案 | 优点 | 失败模式 | 决策 |
|---|---|---|---|
| 全量 `.lean()` 后再归因 | 查询少 | 最多 8,192 个完整 trace 与全部 actions 同时驻留 | 拒绝 |
| 长 multi-document transaction 内写外部 spool | 单一 PIT | transaction retry/时限与外部文件副作用难以组合 | 拒绝 |
| snapshot session + 流式 aggregate + per-decision action query | 同一 PIT、单 trace 客户端峰值、复用现有 output spool | 查询次数增加；snapshot history 过期会失败 | 采用 |
| 响应前 awaited immutable capture | 可建立 authoritative completion fact | 改变生产延迟和可用性，需要 retention/key/activation owner | 当前 `NO-GO` |

## 冻结合同

```text
sourceRead = mongodb_snapshot_session_v1
maximumRequests = 8,192
maximumCandidatesPerRequest = 2,048
maximumTotalCandidates = 65,536
maximumOutcomeActionsPerRequest = 4,096
maximumOutcomeActions = 131,072
maximumRecordBytes = 1,048,576
maximumArtifactBytes = 33,554,432
```

- aggregate 先选最新 `N` 条，再按 `(decisionAt, _id)` 升序流式输出，`batchSize=1`。
- trace 与 action 查询必须绑定同一 snapshot session，且不得并行执行。
- 每条 trace 必须满足 `requestId`、`decisionId` 和 `decisionLogV1Sha256` 与 canonical Decision Log 一致。
- schema、binding、candidate/action 资源或 snapshot 失败均在 final publish 前拒绝。
- viewer/author 继续使用不同输入域的 HKDF/HMAC 伪名；密钥环境变量读取后立即删除，Buffer 最终清零。
- final artifact 继续使用 canonical spool、create-only atomic publish、`0600` 和 durability reconciliation。

## 诚实边界

本阶段只限制客户端同时持有一个 trace 和一个 decision 的 action batch；JavaScript 对象开销、单个
MongoDB 文档解码成本和服务端排序资源没有被精确 byte permit 覆盖。更重要的是，查询仍只看已存在
且具有 `decisionLogV1.decisionAt` 的文档，无法证明未落库决策的数量。

因此不得创建 evidence brand、Phase 22 root、viewer/time provenance、candidate qualification 或
Promotion capability。要重启 authoritative capture 分支，仍需 owner 批准响应前 fail-closed capture、
retention/erasure、key lifecycle 和 epoch denominator。

## 状态

| 范围 | 状态 |
|---|---|
| Phase 31 offline diagnostic development | `GO` |
| Snapshot-consistent selected-source read | `READY / diagnostic only` |
| Authoritative capture source | `NO-GO / activation contract missing` |
| Real viewer/time provenance | `NOT READY` |
| Candidate qualification | `not_run` |
| Selected method | `diagnostics_only_abstention_v1` |
| Production randomized serving / Promotion / exploration | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |
