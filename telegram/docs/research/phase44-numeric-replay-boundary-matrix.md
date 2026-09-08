# Phase 44：数值可表示性与 Replay Score Provenance 边界

## 代码事实

- `compute_full_distribution` 是 epsilon-Plackett-Luce 唯一概率数学入口。它先做
  support、epsilon、temperature 和 finite-logit 校验，再以 max-shift 计算指数权重；任一
  weight、概率或概率质量非有限/非正/下溢时 fail closed。
- 概率质量容差固定为 `1e-12`，累加顺序稳定；当前 `simulate`、target-distribution
  wrapper 和 V2 development receipt 均没有生产 randomized-serving caller。
- V2 development path 在构造 RNG 和调用 kernel 前完成 raw JSON、结构、资源和 work-unit
  admission；最大 `2048 × 64` 配置的 candidate work 为 `4,581,408`，低于 `5,000,000`
  上限。
- V2 的 joint probability 乘积下溢使用 `underflow_log_only`，不伪造有限 joint；log-joint
  仍由逐 prefix receipt 重放验证。该语义没有被 OPE 或 Promotion 用来解除真实推断 blocker。
- replay `trace_final_score_v1` 和 `trace_weighted_score_v1` 在缺少全部适用 score 时回退到
  `-baselineRank`。`loggingReadiness.requestsMissingScore` 会报告缺口，但当前
  `metricEligibility` 只检查 feedback attribution 与 candidate-set completeness，因此完整
  labels + 完整 candidate set 仍可能得到 `complete`，实际排序却等同 baseline。

## 研究问题

1. 在 `n <= 2048`、`k <= 64`、finite logits、`epsilon > 0` 和 `temperature > 0` 下，
   `score gap / temperature` 与 epsilon 的联合可表示正概率域是否应成为独立 diagnostic envelope？
2. 固定输入顺序的 f64 质量累加在最大 support 下是否仍满足 `1e-12` 质量合同？
3. `underflow_log_only` 是否被任何下游消费者误读为 finite joint，或被用于行为 propensity？
4. trace variant 缺分时，baseline fallback 是否应继续作为排序诊断，还是应在新的 score-provenance
   contract 中排除严格指标？
5. 新 score-provenance reason 是否值得升级现有 `replay_metric_eligibility_v1`，还是应等到
   trace variant 成为决策/发布输入后再版本化？

## Evidence matrix

本阶段不改变排序或概率算法，研究重点是现有合同和消费者追踪，因此不追加外部算法论文；这是由既有
Rust canonical kernel、V2 receipt 和 replay readiness 合同直接约束的机械边界审查。

| 方案 | 前提 / 失败模式 | 仓库映射 | 决定 |
|---|---|---|---|
| 现有 max-shift epsilon-PL | finite logits、正 epsilon/temperature；极端 `gap / temperature` 或极小 epsilon 可能下溢。 | `randomized-policy-primitives/src/epsilon_plackett_luce.rs` | 继续采用 fail-closed；不引入 log-domain V3。 |
| 调整 epsilon/temperature 下界 | 需要产品或资格化 owner 的阈值，并会改变 probability bytes、golden digest 和 receipt。 | `RandomizedSlateConfigV1`、V2 receipt | 拒绝自选阈值；仅记录未来 numeric envelope 研究项。 |
| trace score fallback | 保留 ranking 诊断可运行性，但缺分时可能伪装成 score-backed variant。 | `variantScorer.ts`、`evaluator.ts`、`evaluateRecsysReplay.ts` | 当前保留并由 readiness 报告；不把它称为真实 score 证据。 |
| variant-specific score eligibility | 需要新 reason/version、部分缺分规则、聚合和 mixed-denominator 合同。 | `ReplayMetricEligibility` | `CONDITIONAL GO`，仅在 trace variant 成为决策输入前另阶段实施。 |
| diagnostics-only abstention | 不声明概率适用性、utility、coverage 或资格化。 | `diagnostics_only_abstention_v1` | 继续作为唯一 active method。 |

## 资源与失败条件

- V2 资源模型保持现状：raw/output `32 MiB`、hash `512 MiB`、allocation `128 MiB`、work
  `5,000,000`；超限必须在 RNG/kernel 前阻断。
- 继续把概率乘积下溢表示为 log-only；禁止把 underflow 转成零概率、有限 joint 或 behavior
  propensity。
- numeric envelope 若未来实现，必须复用 canonical kernel、先做 checked preflight、private
  diagnostic-only，且不得修改 V1/V2 golden bytes。
- score provenance 若未来实现，必须保留 trace fallback 的 diagnostics 语义，同时使缺失适用
  score 的 request 不进入严格 score-backed 指标；baseline/hybrid 不能被误伤。

## 决定

| 范围 | 状态 |
|---|---|
| epsilon-PL 数值核修复 | `NO-GO / 无已证生产缺陷` |
| numeric admissibility audit | `CONDITIONAL GO / private diagnostic-only` |
| trace score provenance contract | `CONDITIONAL GO / future versioned contract` |
| candidate selection / qualification | `NO-GO / no_candidate_selected` |
| real finite-sample inference / Promotion | `UNAVAILABLE / NO-GO` |
| production randomized serving / exploration / Task 9 | `NO-GO / UNAUTHORIZED` |
