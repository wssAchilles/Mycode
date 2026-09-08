# Phase 53：Replay 配对 delta 与共同资格 request 矩阵

## 范围与结论

本阶段只研究离线 replay 中 baseline/variant 的严格指标资格集合不一致时，先分别做宏平均、再
直接相减所产生的 delta 语义问题。当前唯一非测试消费者仍是
`telegram-clone-backend/src/scripts/evaluateRecsysReplay.ts`；调用链为：

```text
evaluateRecsysReplay.main
  -> evaluateReplayRequests
  -> finalizeMetrics / diffMetrics
```

没有 SpaceService、feed route、selector、worker 或 Promotion caller。结论如下：

- **共同资格 request 的 paired delta：`CONDITIONAL GO`**。在处理每个 request 时记录实际的
  `baselineSummary.strictMetricsEligible && variantSummary.strictMetricsEligible`，只在这个共同
  cohort 上累计两侧严格指标和 request-level difference；没有共同 request 时必须
  `not_evaluable`，不能用零值伪装成零差异。
- **独立宏平均后直接相减：`NO-GO`（严格 comparative delta）**。它可能比较两个不同 request
  集合，把 score provenance/feedback/candidate-set 缺失造成的样本组成变化混入策略差异。
  `baseline` 与 `variantMetrics` 可以继续作为各自 cohort 的 observed summary，但不应再被解释为
  同一 cohort 的 variant delta。
- **全量拒答：`CONDITIONAL GO`**，作为共同 cohort 为空时的 fail-closed 表现；保留 observed
  ranking、coverage 和 reasons，不删除输入候选。
- **pairwise deletion 之外的缺失校正：`NO-GO`**。IPW/AIPW/DR 需要缺失/曝光概率、support、
  MAR 或 reward-model 假设；当前 replay snapshot 没有这些合同。
- **真实 utility、Promotion、production exploration、Task 9：`NO-GO`**。本阶段仍是
  diagnostics-only，不能升级全局状态。

全局状态不变：`selectedMethod=diagnostics_only_abstention_v1`、
`candidateQualificationStatus=not_run`、`realDatasetEligible=false`、real finite-sample
inference `UNAVAILABLE`。

## 当前代码事实

- `evaluateReplayRequests`（`replay/evaluator.ts:89-298`）对每个 request 生成
  `baselineSummary` 和 `variantSummary`，再分别调用 `addRankingSummary(baselineTotals, ...)` 与
  `addRankingSummary(variantTotals, ...)`。`scoreProvenanceComplete` 只影响 variant 的严格资格；
  baseline 的摘要固定传 `true`。
- `summarizeRanking`（`replay/evaluator.ts:400-454`）把
  `feedbackRows/feedbackCandidates` 置空于非 strict request，因此 strict 指标是 request-level
  complete-case 指标。一个缺 target native score 的 request 可以让 variant 不进分母，但 baseline
  仍进自己的分母。
- `finalizeMetrics`（`replay/evaluator.ts:628-644`）用各自 accumulator 的
  `feedbackRequests` 做宏平均分母；`diffMetrics`（`replay/evaluator.ts:677-693`）逐字段执行
  `left.average* - right.average*`，没有 request-id 交集或共同分母。
- `byUserState` 与 `byPipeline` 通过 `finalizeBuckets`（约 `replay/evaluator.ts:781-801`）走同一
  `diffMetrics`，因此也有独立 cohort 相减问题。不能用两个摘要的
  `Math.min(eligibleRequestDenominator)` 推出真正交集；只有循环中的 request-level 布尔值能知道
  是否同时合格。
- `requestDiffLeaders` 只在
  `baselineSummary.strictMetricsEligible && variantSummary.strictMetricsEligible` 时 push，已经
  是共同 cohort 的 paired request delta；它不能修复顶层 `delta` 或 bucket aggregate。
- `averageAuthorDiversityAtK` 与 `averageOonRatioAtK` 目前对每个 request 都累加，双方的 observed
  request 分母相同；其当前差异不由 score provenance gate 直接造成。但若把 paired contract 扩展
  到所有字段，应单独标记这些 observational fields，而不能假设所有字段共享 strict denominator。
- `ReplayEvaluationSummary`（`replay/contracts.ts:207-237`）只有 `baseline`、`variantMetrics`、
  `delta` 和 request leader，没有共同 cohort id/count 或 delta-specific eligibility。当前
  `mergeMetricEligibility` 用两侧分母的 `min/max` 近似合并，不是实际 request intersection。
- `evaluateRecsysReplay.main` 对输入和资源有既有 bounded admission；本问题的最小修复只需一次
  O(requests) paired accumulator，不能引入模型、RNG、propensity estimator、持久化 sink 或无界
  request map。

## 可识别的 estimand

设 request 为 (i)，严格资格指示为 (I^B_i)、(I^V_i)，baseline/variant 的 request-level
metric 为 (M^B_i)、(M^V_i)。当前实现等价于：

```text
B_current = sum(I^B_i * M^B_i) / sum(I^B_i)
V_current = sum(I^V_i * M^V_i) / sum(I^V_i)
delta_current = V_current - B_current
```

当 `I^B` 与 `I^V` 不相等时，这个差值不等于同一 request 集合上的策略对比。严格 paired
comparand 应为：

```text
I_pair_i = I^B_i && I^V_i
delta_pair = sum(I_pair_i * (M^V_i - M^B_i)) / sum(I_pair_i)
```

这不是为了宣称 `delta_pair` 是真实世界 utility；它只是明确的 offline diagnostic estimand。
`delta_pair` 的 denominator 必须是实际共同 request 数，不是两侧 denominator 的 `min()`，也不
是候选数的交集。若共同数为零，返回 `not_evaluable` 并保留 observed counts。

## 研究问题

1. 当 baseline 与 variant strict eligibility 不同，顶层和 bucket delta 应代表各自 cohort 差异，
   还是同一 request 上的 paired policy contrast？
2. 只在共同 strict cohort 上累计，是否足以避免 score provenance、feedback、candidate-set 缺失
   带来的 case-mix 混入，同时保留 baseline/variant 独立 observed metrics？
3. `requestDiffLeaders` 已采用共同资格条件；如何复用这个 request-level gate，使 aggregate 和
   bucket 输出不再用摘要级 `min/max` 猜交集？
4. 对缺失 request 使用 IPW/AIPW/DR 或插补，所需的 missingness/propensity/support/PIT/reward
   model 在当前合同中是否存在？没有时，何种 fail-closed 输出最小且可审计？
5. 最小版本化合同是否只需新增共同 cohort denominator/reason，还是还要把每个 delta 字段的
   estimand 和 observed/eligible 分母显式分离？

## Primary-source evidence matrix

| 来源 | 精确元数据与阅读状态 | 直接证据与限制 | 仓库映射 | 结论 |
|---|---|---|---|---|
| **Analysis of paired observations** — NIST/SEMATECH e-Handbook of Statistical Methods，2003（网页 2022 更新），NIST，官方 [章节](https://www.itl.nist.gov/div898/handbook/prc/section3/prc311.htm)，`full_text` | NIST 定义第 (i) 个 (Y_i) 与第 (i) 个 (Z_i) 为自然配对，并先计算每个 pair 的 (d_i=Y_i-Z_i)，再对 (d_i) 求均值和方差。 | 配对方法需要同一观测单位；它不证明缺失机制可忽略，也不提供 replay utility 证据。 | request 是自然配对单位；`requestDiffLeaders` 的做法符合该边界，`diffMetrics` 的独立分母不符合。 | 采用实际共同 request 上的 paired accumulator；不从摘要 denominator 推断 pair。 |
| **A comparison of statistical significance tests for information retrieval evaluation** — Mark D. Smucker、James Allan、Ben Carterette，2007，*Proceedings of CIKM 2007*，ACM，623–632，DOI [10.1145/1321440.1321528](https://doi.org/10.1145/1321440.1321528)，`abstract_or_public_description` | 论文比较 TREC retrieval runs 的 paired t、Wilcoxon、sign、bootstrap 与 Fisher randomization，对 run 的 mean-average-precision 差异做统计比较。 | 其结论面向 IR significance test，不会替当前 synthetic replay 建立置信区间或真实 utility；但它把同一评估单位的成对结果作为比较基础。 | replay 的 request-level metric 对应 IR 的 topic-level metric；不同 eligible topic/request 集合不可默认为同一 comparand。 | 支持 paired common-cohort 作为 strict comparative delta 的基础；不采纳独立 cohort 相减。 |
| **The Sixteenth Text Retrieval Conference (TREC 2007)** — Ellen M. Voorhees、Lori P. Buckland（编辑），2008，NIST Special Publication 500-274，官方 [PDF](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-274.pdf)，`abstract_or_public_description` | NIST proceedings 的评估章节报告在 TB queries 上用 one-sided paired t-test 比较 runs，说明系统比较以共同 query/topic 作为配对单位。 | TREC 是 test-collection 评估，不等价于在线曝光或缺失 score；paired test 也不修复错误的 relevance 或 incomplete collection。 | 说明 replay 需要共同 request 合同，而不是分别过滤后用宏平均差值替代。 | 将共同 request denominator 暴露为 contract，而非将其隐含在 `mergeMetricEligibility` 的 min/max 中。 |
| **Inference and missing data** — Donald B. Rubin，1976，*Biometrika* 63(3):581–592，DOI [10.1093/biomet/63.3.581](https://doi.org/10.1093/biomet/63.3.581)，`abstract_or_public_description` | Rubin 的摘要指出，忽略 missing-data process 需要 missing at random、observed-at-random/参数 distinct 等条件；推断通常条件于已观察的 missingness pattern。 | 当前 score provenance/feedback 缺失没有 MAR 证明；complete-case paired delta 是一个条件的共同 cohort 诊断，不是 full-population 无偏估计。 | `ReplayMetricEligibility` 可表达 excluded denominator/reason，但不能宣称缺失已校正。 | 采用 paired complete-case 作为 diagnostics-only；拒绝把它升级为真实 finite-sample inference。 |
| **A Generalization of Sampling Without Replacement from a Finite Universe** — D. G. Horvitz、D. J. Thompson，1952，*Journal of the American Statistical Association* 47(260):663–685，DOI [10.1080/01621459.1952.10483446](https://doi.org/10.1080/01621459.1952.10483446)，`abstract_or_public_description` | 论文针对 unequal selection probabilities 的有限总体抽样，给出需要选择概率的估计框架。 | 只有知道/建模 inclusion probability 才能做这类 missingness correction；当前 replay 没有 score-observation propensity 或 support。 | 输入只有候选 snapshot、labels 和可选 score；Rust probability owner 的 receipt 没有接到该离线 evaluator。 | IPW/HT 作为竞争方案 `NO-GO`；不从 observed request count 推导 propensity。 |
| **Estimation of Regression Coefficients When Some Regressors are not Always Observed** — James M. Robins、Andrea Rotnitzky、Lue Ping Zhao，1994，*Journal of the American Statistical Association* 89(427):846–866，DOI [10.1080/01621459.1994.10476818](https://doi.org/10.1080/01621459.1994.10476818)，`abstract_or_public_description` | 提出的 inverse-probability-weighted estimating equations 在 MAR 且 complete-data observation probability 已知或可参数建模、并有 positivity 时才一致。 | 缺失概率模型、支持下界、PIT 和可验证 outcome/reward model 都不在本合同；把 score fallback 当作 outcome model 不成立。 | OPE/Promotion/Task9 的真实 evidence boundary 仍未满足。 | 不做 IPW/AIPW/DR/插补；共同 cohort 为空时 fail closed。 |

这些来源支持“比较单位必须配对”和“缺失校正需要额外可识别条件”的边界，不构成仓库效果结果。
没有来源能证明当前 synthetic/offline 输入具备真实 utility、coverage、PIT 或 qualification 能力。

## 方案比较

| 方案 | 适用条件与实现形状 | 失败模式 | 决策 |
|---|---|---|---|
| **paired common-cohort accumulator** | 在 request 循环中计算 `pairEligible = baselineSummary.strictMetricsEligible && variantSummary.strictMetricsEligible`；只对 pair eligible request 累计 baseline/variant strict metric totals，delta 用同一 denominator。保存 observed、baseline-only、variant-only、pair counts。 | pair denominator 可能为 0；不能以插补或删候选扩大 cohort；只表达共同 cohort 的条件差异。 | **采用，`CONDITIONAL GO`**；离线 diagnostics-only，O(requests) 额外状态。 |
| **independent macro averages + direct subtraction** | 当前 `finalizeMetrics(baselineTotals)`、`finalizeMetrics(variantTotals)` 后 `diffMetrics(variant, baseline)`。实现最少，但两侧 strict denominator 可不同。 | score provenance gate、feedback 或 candidate-set 缺失改变样本组成；delta 混入 case-mix；bucket 输出复现同一问题。 | **拒绝** strict comparative delta；保留各自 `baseline`/`variantMetrics` 作为带 eligibility 的 observed summaries。 |
| **whole-evaluation refusal** | pair denominator 为 0 或合同版本不兼容时，delta status=`not_evaluable`，保留 observed counts/coverage。 | 丢失可用的 per-request diagnostics；若任何 mismatch 都拒绝，会过度缩小可观测范围。 | **采用为零共同 cohort 的 fallback**，不是常态过滤策略。 |
| **candidate/request filtering without pair contract** | 先删缺分候选或让每一侧独立过滤后再计算。 | 改变候选宇宙、top-K 和 selection event；缺失不随机时不能恢复 full-set estimand。 | **NO-GO**。 |
| **IPW / AIPW / DR / imputation** | 需要 missingness/selection propensity、support/positivity、PIT、MAR 或 reward model；可在有这些 receipt 后研究。 | 当前输入无法识别；模型错误、高方差或 support 破坏会产生虚假 certainty。 | **NO-GO**，不在此阶段引入。 |

## 最小可执行范围

1. **共同资格只在 request 循环决定**：不要从两个 `ReplayMetricEligibilitySummary` 的
   `min/max` denominator 近似交集；用同一个 request 的两个 strict flags 生成 `pairEligible`。
2. **保留独立 observed summaries**：`baseline` 与 `variantMetrics` 继续展示各自 strict cohort、
   excluded counts 和 reasons；不改变 fallback ranking 或 score provenance。它们不再被隐含解释为
   paired comparand。
3. **重定义严格 delta**：顶层 `delta` 的 click/engagement/negative/NDCG/MRR/Recall 等严格字段
   只从 pair accumulator 计算；`delta.metricEligibility` 的 eligible denominator 必须是实际
   pair request count，新增/升级合同以区分“variant-only denominator”与“paired denominator”。
4. **bucket 复用同一 gate**：`byUserState` 与 `byPipeline` 的 delta 不能继续对独立 bucket
   summaries 直接 `diffMetrics`；按 bucket 累计 pair totals，或明确把 bucket delta 标为
   non-comparative observed diagnostic。最小安全选择是复用 pair accumulator。
5. **observational fields 单独标记**：author diversity/OON 当前双方都使用 observed request
   denominator，可继续输出；如果与 strict delta 共用 `ReplayRankingMetrics`，合同需说明这些字段
   的 denominator 不等于 strict pair denominator，避免消费者把所有字段当成同一 estimand。
6. **空交集 fail closed**：pair count 为 0 时保留兼容性数字形状（若现有消费者要求），但 status
   必须 `not_evaluable`，reasons 至少包含双方 eligibility 差异/缺失原因；不得将 `0` 当作无差异。
7. **资源边界**：每个 request 只增加常数次布尔判断和 accumulator 更新，额外内存 O(bucket
   keys)；不引入 per-request unbounded map、RNG、propensity estimator、模型或持久化 sink。

## 验收与边界

- 构造两个完整 labels + complete candidate set 的 request：request A 的 variant native score
  完整，request B 的 variant target score 缺失但 fallback score 存在。断言 baseline/variant 独立
  summaries 的 denominator 可不同，而顶层 strict delta 只包含 request A，且 denominator 为 1。
- 让缺分字段只出现在 top-K 之外；整个 request 仍不进入 variant strict cohort，证明 gate 不是
  top-K-only shortcut。
- 让 baseline 和 variant 都 strict eligible 的两个 request 产生相反 NDCG 变化；断言
  `delta.averageNdcgAtK` 等于 request-level paired differences 的均值，而不是两侧独立宏平均。
- 对 userState/pipeline 分桶构造同样的混合 eligibility；断言 bucket delta 使用各 bucket 的实际
  pair denominator，不能由 bucket 两侧 denominator 的 `min()` 近似。
- pair denominator 为零时，断言 `delta.metricEligibility.status='not_evaluable'` 和显式 reason；
  observed ranking、score provenance、fallback coverage 仍可返回。
- `requestDiffLeaders` 的既有共同资格行为保持不变；baseline、hybrid、industrial 的排序数值和
  Phase 52 score provenance 不回退。
- 实现阶段门槛：focused Vitest、TypeScript `--noEmit`、`git diff --check`；不触碰
  `ml-services/**`，不修改 Rust randomized policy/probability owner。
- 任何 `complete` 只表示共同输入合同满足的 offline diagnostic denominator，不表示真实 utility、
  finite-sample inference、candidate qualification、Promotion 或 production serving。

## 决定

| 范围 | 状态 |
|---|---|
| paired common-cohort strict delta | `CONDITIONAL GO / private offline-only` |
| independent macro subtraction as comparative delta | `NO-GO / unequal request cohorts` |
| independent baseline/variant observed summaries | `GO / retain with explicit eligibility` |
| zero-common-cohort fail-closed output | `CONDITIONAL GO / not_evaluable` |
| candidate filtering to force commonality | `NO-GO / changes candidate universe` |
| IPW/AIPW/DR/imputation | `NO-GO / propensity, support, PIT and missingness assumptions unavailable` |
| real inference / Promotion / exploration / Task 9 | `UNAVAILABLE / NO-GO / UNAUTHORIZED` |
