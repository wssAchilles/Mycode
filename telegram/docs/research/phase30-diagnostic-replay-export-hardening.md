# Phase 30 Diagnostic Replay Export Hardening

更新时间：2026-08-15

## 结论

Phase 30 对已有 replay exporter 的加固为 `GO`，但范围仅为受限的离线 diagnostic artifact。
真实 capture provenance、retention/erasure、eligible-decision completeness 和 downstream
evidence binding 仍为 `NO-GO`。

本阶段不改变 scorer、ranker、policy、OPE 或统计推断语义，因此不追加外部算法研究。隐私与
发布决策继续采用 Phase 26 和 Phase 29 已记录的 NIST SP 800-188、NIST SP 800-57、
MongoDB TTL 与 RFC 9162 证据。

## 代码事实

- `exportRecsysReplayRequests.ts` 是手工 CLI；没有 route、worker、scheduler 或 runtime caller。
- `evaluateRecsysReplay.ts` 和 replay evaluator 不读取 `request.userId`，因此 viewer 伪名化不改变排序数学。
- evaluator 使用 `authorId` 计算作者多样性；Phase 30 对 viewer 和 author 使用不同输入域的稳定伪名。
- `postId`、`requestId`、`decisionId` 仍保留，因为 replay join 和 attribution 需要它们；产物不是匿名数据。
- exporter 继续读取 mutable、default-off 的 RecommendationTrace，不能证明 source completeness 或 PIT provenance。

## 研究问题

1. 如何在不改变 replay 数学的前提下移除直接 viewer/author identity？
2. 如何避免普通覆盖写、部分文件和未等待 flush？
3. 如何限制 requests、candidates、actions、records、line bytes 和 total bytes？
4. publish point 后 durability 未确认时，调用方需要哪些 reconciliation 元数据？
5. 当前加固能否授予 real evidence 或 qualification 能力？

## 方案比较

| 方案 | 优点 | 失败模式 | 决策 |
|---|---|---|---|
| 保留普通 `createWriteStream` | 改动最少 | 覆盖目标、权限依赖 umask、部分文件、无 digest/caps | 拒绝 |
| 在脚本内重写临时文件与 rename | 可原子替换 | 重复已有实现，rename 会覆盖，发布语义漂移 | 拒绝 |
| 复用 canonical spool + create-only atomic sink | 0600、canonical、hash/count、caps、fsync、reconciliation | 不能证明 Mongo source 完整性 | 采用 |
| 新增 manifest/evidence brand | 可保存 metadata | 当前 evaluator 不消费，会形成无消费者信任面 | 拒绝 |

## 冻结边界

```text
defaultRequests = 2,000
maximumRequests = 8,192
maximumCandidatesPerRequest = 2,048
maximumTotalCandidates = 65,536
maximumOutcomeActions = 131,072
maximumRecordBytes = 1,048,576
maximumArtifactBytes = 33,554,432
```

- pseudonym key、key version 和 capture epoch 在 Mongo 连接前 fail closed；不回退到原始 viewer ID。
- 输出目标存在时拒绝覆盖；最终文件继承 `0600`。
- publish 前失败时 final path 不可见。
- hard-link 后 durability 未确认时 final path 可能可见；输出 target path、SHA-256、record count 和 reason，要求显式 reconciliation。
- 输出固定记录 `diagnostic_only_unverified_source`，不创建 machine evidence brand。

## 残余风险

Mongo query 仍会在 candidate-count 检查前把最多 8,192 个完整 trace 文档 materialize 到内存。
因此 32 MiB 是 artifact cap，不是 source-memory admission。解决该问题需要 cursor/chunked outcome join，
属于后续独立性能与数据源改造，不能在本阶段虚构为已关闭。

保留的 post/request/decision 标识仍可关联内容和请求。没有 retention owner、erasure workflow、
immutable source receipt 和 epoch denominator 前，本产物不得进入 Phase 22 real intake、Prediction/OPE
真实 evidence、sealed qualification 或 Promotion。

## 状态

| 范围 | 状态 |
|---|---|
| Diagnostic replay export | `GO / bounded and pseudonymized` |
| Authoritative capture source | `NO-GO` |
| Real viewer/time provenance | `NOT READY` |
| Candidate qualification | `not_run` |
| Selected method | `diagnostics_only_abstention_v1` |
| Production randomized serving / Promotion / exploration | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |

