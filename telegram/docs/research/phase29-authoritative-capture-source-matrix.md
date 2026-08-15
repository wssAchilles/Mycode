# Phase 29 Authoritative Capture Source Decision Matrix

更新时间：2026-08-15

## 结论

Phase 29 对真实 viewer/time capture source 的判定为 `NO-GO`。当前仓库没有能同时证明
decision-viewer 原子绑定、eligible-decision 完整性、PIT、key epoch、retention/erasure 和
不可变发布的 source owner。新增 branded wrapper 只会重新包装调用者声明，因此不实施。

本阶段只实施现有边界修复：伪名密钥副本在所有退出路径清零，Decision Context 对 hostile
getter 稳定 fail closed，并恢复 OPE V2 synthetic fixture 与随机日志 brand 边界的一致性。

## 代码事实

- `recordServedFeedTrace` 分别 best-effort 写 RecommendationTrace 和 Decision Log，异常只告警；
  两次写入不原子，也没有 authoritative eligible-decision denominator。
- RecommendationTrace 使用 Mongo upsert，保存原始 `userId` 和候选身份；没有 TTL、
  erasure receipt、epoch close 或 append-only root。
- Decision Log 默认关闭且只持久化 `deterministic_top_k`；Randomized Slate V2 仍是
  private development fixture，不能作为真实 runtime propensity。
- `recommendation_viewer_pseudonym_v1` 只绑定 viewer、key version 和 capture epoch，
  不绑定 request、decision、source row 或 dataset root。
- Decision Context V1 验证 PIT 顺序和 cohort 内一一映射，但其 source hash、pseudonym 和
  dependence status 都来自调用者。
- Prediction V3 已有 synthetic viewer-cluster holdout consumer，但固定
  `realDatasetEligible=false`；Prediction V4 只接受 Phase 18 frozen synthetic membership。
- Phase 22 intake 的九个真实 evidence roots 仍全部为 `null`。

## 研究问题

1. 哪个 serving completion owner 能原子绑定 decision log、viewer pseudonym 和 PIT context？
2. 如何用 epoch high-watermark 证明 eligible decision 没有被选择性遗漏？
3. key version、capture epoch、rotation 和 erasure 如何避免拆分同一 viewer cluster？
4. source provenance 如何贯穿 Decision Context、cross-fit receipt、Prediction 和 OPE？
5. records、bytes、cryptographic work 和 publication 如何在首次 source scan 前完成 admission？

## Evidence Matrix

| 来源 | 前提与失败模式 | 仓库映射 | 决策 |
|---|---|---|---|
| Simson Garfinkel 等，*De-Identifying Government Datasets: Techniques and Governance*，2023，NIST SP 800-188，[DOI 10.6028/NIST.SP.800-188](https://doi.org/10.6028/NIST.SP.800-188)，`full_text` | 去标识化需要用途、攻击面、治理和生命周期；伪名不等于匿名或来源证明。 | 当前伪名 receipt 不绑定 decision/source/dataset。 | 采用风险边界；拒绝把 pseudonym brand 提升为 viewer provenance。 |
| Lily Chen、Elaine Barker、Allen Roginsky、Robert Keyes、Richard Lee、Angela Coker，*Recommendation for Key Management: Part 1 — General*，2020，NIST SP 800-57 Part 1 Rev.5，[官方](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final)，`full_text` | 需要访问控制、轮换、销毁、责任和生命周期；调用者自报 key version 不构成治理。 | 仓库没有 capture key registry、rotation schedule 或 erasure owner。 | 拒绝真实 capture activation；保留 development-only HKDF/HMAC。 |
| MongoDB，*TTL Indexes* 与 *Expire Data from Collections by Setting TTL*，MongoDB Documentation，[官方](https://www.mongodb.com/docs/manual/core/index-ttl/)，`full_text` | TTL 后台删除有延迟，不能证明即时擦除、join horizon 或 capture completeness。 | RecommendationTrace 没有 TTL；直接新增索引可能删除既有数据。 | 拒绝把 TTL 当 evidence contract；等待 owner 冻结 retention horizon。 |
| Ben Laurie、Adam Langley、Emil Eiksson、Aram Hovsepyan，*Certificate Transparency Version 2.0*，2021，IETF RFC 9162，[官方](https://www.rfc-editor.org/rfc/rfc9162.html)，`full_text` | Append-only proof 需要 durable operator、checkpoint、监控和已知输入集合。 | Atomic sink 能证明已发布文件，不知道遗漏了哪些 eligible decisions。 | 未来可用于 epoch ledger；当前拒绝新增 self-consistency ledger。 |

Phase 29 没有改变算法语义，也没有发现 Phase 26 primary-source matrix 之外的新证据问题，因此
不追加外部研究。

## 方案比较

| 方案 | Consumer closure | 真实 provenance | 判定 |
|---|---|---|---|
| Immutable canonical NDJSON + create-only publish | 可机械进入 Decision Context；Prediction 仍需 target/outcome/PIT roots | 缺 authoritative source receipt 和 epoch denominator | `NO-GO` |
| Mongo snapshot + manifest | 可读取现有 trace | mutable、default-off、无 retention/completeness | `NO-GO` |
| Deterministic fixture-only source | 已进入 Decision Context → Prediction V3 | 明确 synthetic-only | `GO / 已存在，不重复实现` |
| Diagnostics-only no-build | 不新增能力 | 不虚构 provenance | `采用` |

## 资源可达性

Prediction V3 当前最多消费 64 decisions，因此未来最小 artifact 至少有 `N + 2 <= 66`
records。若沿用 1 MiB 单行上限：

```text
66 * (1,048,576 + LF) = 69,206,082 bytes
```

这超过 Phase 22 的 32 MiB 总上限。要保持 66-record grammar，统一 worst-case record 上限最多
为 508,399 bytes；而最大 Decision Log 可能包含 2,048 candidates，因此未来合同需要拆分
candidate records或进一步收紧 support cap。资源计划还必须由已验证 source manifest 提供；
在 Mongo 中先 count 或读取第 65 条都已经发生 source scan，不能满足零扫描 preflight。

## Future Re-entry Gate

只有同时存在以下事实时才重启该分支：

1. owner-approved retention、erasure、join horizon 和 key lifecycle；
2. serving completion boundary 的原子、不可变 capture owner；
3. epoch open/close/high-watermark 与 eligible/accepted/rejected denominator；
4. bounded grammar、source manifest、create-only publish 和 reconciliation；
5. Decision Context successor 与 Prediction receipt 保留同一 source root。

在此之前保持：

```text
captureSourceStatus = unavailable
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
finite_sample_inference_unavailable
multiplicity_control_unavailable
```

Randomized serving、Promotion、production exploration 和 Task 9 的授权状态不变。
