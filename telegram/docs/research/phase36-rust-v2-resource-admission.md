# Phase 36: Rust V2 Resource Admission Boundary

更新时间：2026-08-15

## Decision

| 范围 | 判定 |
|---|---|
| 固定 private development fixture 的 RNG、逐 prefix epsilon-PL、joint probability 与完整 replay | `GO` |
| Rust V2 development resource admission 修正 | `GO / narrow contract correction` |
| Production randomized logging | `NO-GO` |
| Production randomized serving、Promotion 与 exploration | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |

本轮不改变 randomized-policy 数学。外部研究予以跳过，因为这是既有资源合同的窄修正；
[Phase 25 Randomized Logging Policy Decision Matrix](phase25-randomized-logging-policy-matrix.md)
仍是算法选择、support、propensity 与生产授权边界的权威 evidence matrix。

## Current Code Facts

- Rust V2 使用 HKDF/ChaCha20/open53 生成 caller-independent development draws，并逐 prefix
  重放 epsilon-Plackett-Luce distribution、selected interval、conditional probability、
  ordered joint/log-joint probability 与 RNG transcript。
- `RandomizedSlateDevelopmentReceiptV2::validate_against_raw` 重放 source/config bindings、
  policy math、资源公式和 receipt 摘要；该能力只对固定 private development fixture 成立。
- `admit_development_input_raw_v1` 在 typed parse 前限制 raw bytes、JSON depth、节点、集合、
  字符串、重复键和 trailing value。
- `simulate_development_v2` 没有非测试 inbound caller；producer、receipt 和 fixture 均保持
  synthetic/development-only，`servable=false`。
- `DevelopmentResourceReceiptV1` 中的资源字段是确定性的 policy-work/admission estimate。
  它们不构成完整 process RSS、实际 allocator 成功、并发占用或端到端 allocation upper bound：
  typed parse、source validation、canonicalization 与不可失败的 Rust collection allocations
  仍存在于该估算边界之外。

因此当前 receipt 可以证明固定输入下的 policy 工作量和既定 admission 公式可重放，不能证明
生产进程在任意负载下的内存、deadline、并发或 durable publication 安全。

## Minimal Correction Scope

本轮确认的最小修正方案是：

1. 复用现有 borrowed `RecommendationDecisionLogV1::deserialize(&Value)` 路径，避免为
   `source_decision_log` 复制完整 `serde_json::Value`。
2. 在昂贵的 source validation/canonicalization 之前执行 candidate、eligible 和 slate
   shape gate，使超出 V2 固定上限的输入在 policy/RNG 工作前 fail closed。
3. 保持 RNG byte stream、prefix 顺序、epsilon-PL 数学、joint/log-joint probability、
   receipt schema 与既有 fixture digest 不变。

前两项修正用于减少不必要的内存复制，并缩短 hostile oversized input 到稳定
`resource_limit_exceeded` 的路径；即使实施，也不会把现有 resource receipt 升级为完整进程
资源证明。

## Deliberate Non-Goals

以下内容本轮不实施：

- 不新增 receipt version，也不迁移既有 fixture 或 digest。
- 不绑定 raw input SHA-256；语义等价但原始字节不同的输入仍不获得 byte-identity 证明。
- 不引入 fallible allocator、RSS accounting、concurrency permit、deadline 或 durable publish
  合同。
- 不增加新的 cross-runtime fixture；现有 Node verifier 继续只验证既定 development artifact
  边界，不成为第二个 epsilon-PL 数学 owner。
- 不接线 runtime Decision Log、randomized serving、Promotion、exploration 或 Task 9。

## Honest State

Phase 36 完成该窄修正后仍固定：

```text
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
Decision Log = default-off
randomized serving = disabled
servable = false
```

Production randomized logging 继续为 `NO-GO`。private development replay 的成功不得解除
finite-sample inference、multiplicity、real evidence、Promotion 或 production authorization
blocker。

## Re-entry Conditions

只有出现真实 production logger consumer 与明确授权后，才应冻结新版本合同，并至少同时处理：

- raw byte identity、commitment timing、epoch coverage 与 durable publication；
- 完整 process/RSS allocation model、fallible allocation、concurrency permit 与 deadline；
- 真实 candidate/support provenance、propensity floor、retention/erasure 与 completeness receipt；
- 独立 cross-runtime fixture 和 rollout/rollback 证据。

在这些条件满足前，不扩展 V2 receipt 的语义，也不把 private development fixture 解释为
production logging capability。
