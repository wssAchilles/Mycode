# Phase 52：Replay Score Provenance 与缺分评估边界

## 范围与结论

本阶段只研究离线 replay 中“目标 variant 的 native score 缺失，但 scorer 借用其他 score 或
`-baselineRank` 继续排序”的语义。当前唯一非测试消费者是
`telegram-clone-backend/src/scripts/evaluateRecsysReplay.ts`；调用链为：

```text
evaluateRecsysReplay.main
  -> evaluateReplayRequests
  -> rerankReplayCandidates
  -> scoreReplayCandidate
```

没有 SpaceService、feed route、selector、worker 或 Promotion caller。结论如下：

- **score provenance 诊断：`CONDITIONAL GO`**。允许保留现有 fallback 排序，但必须逐候选记录
  实际 score 来源，并把 fallback 覆盖率作为诊断，不作为质量或资格化证据。
- **严格 score-backed 指标：`CONDITIONAL GO`**。只有整个 request 的候选集都具备该 variant
  所要求的 native score，且现有 feedback/candidate-set 条件同时满足时，才进入该 variant 的
  严格指标分母；缺失 request fail closed 并保留分母。
- **候选过滤：`NO-GO`（严格指标）**。删除缺分候选会改变候选宇宙和 top-K 分母，除非另有
  明确定义的 filtered-universe 合同；当前 `complete_v1` 合同不允许这样解释。
- **IPS/DR、真实 utility、Promotion、production exploration：`NO-GO`**。当前没有随机 logging
  propensity、support、PIT、viewer/time provenance 或真实反馈证据。

全局状态不变：`selectedMethod=diagnostics_only_abstention_v1`、
`candidateQualificationStatus=not_run`、`realDatasetEligible=false`、real finite-sample
inference `UNAVAILABLE`。

## 当前代码事实

- `ReplayCandidateSnapshot` 中 `score`、`weightedScore`、`pipelineScore` 均为可选字段；
  `loggingReadiness.requestsMissingScore` 只检查三者任意一个 finite，不能证明某个 variant 的
  目标 score 存在。
- `scoreReplayCandidate` 的 `trace_final_score_v1` 按
  `score -> weightedScore -> pipelineScore -> -baselineRank` 回退；
  `trace_weighted_score_v1` 按
  `weightedScore -> score -> pipelineScore -> -baselineRank` 回退。
- `hybrid_signal_blend_v1` 与 `industrial_guardrail_blend_v1` 也会把缺失数值信号当作零或前一层
  fallback；这可作为启发式排名诊断，但不是 native score 证据。
- `evaluateReplayRequests` 的 `strictMetricsEligible` 目前只要求完整 feedback attribution 和
  `candidateSetCompleteness=complete_v1`；它没有检查 variant-specific score applicability，因而
  完整 labels + 完整 candidate set 仍可能把 baseline fallback 报成 score-backed `complete`。
- `trace_final_score_v1` 与 `trace_weighted_score_v1` 的 score fallback 只影响离线 evaluator；
  不存在生产 runtime caller。`evaluateRecsysReplay.ts` 已将输入限制为
  `32 MiB / 1 MiB 行 / 8,192 requests / 2,048 candidates-per-request / 65,536 candidates /
  topK 1,000`。

## 研究问题

1. 当目标 score 缺失而 scorer 借用其他 score 或 baseline rank 时，输出是否仍代表原目标
   variant，还是已经变成一个未命名的混合策略？
2. 在没有额外缺失机制假设时，删除缺分候选能否保持 full candidate-set 的 NDCG、MRR、Recall
   和 negative/click 分母语义？
3. 对 fallback 排序保留显式 provenance，是否能提供有用的 observed diagnostic，同时避免把
   fallback 结果解释成 native-score 质量证据？
4. 缺少 randomized propensity、support、PIT 和可验证反馈 join 时，IPS/DR 或缺失数据校正能否
   将缺分问题升级为 finite-sample utility 或 qualification？
5. 最小 provenance 是否应覆盖“适用 variant、实际字段、fallback 层级、request 计数、candidate
   计数和严格指标分母”，并且在现有输入上保持 O(total candidates) 资源上界？

## Evidence matrix

| 来源 | 精确元数据与阅读状态 | 前提、限制与失败模式 | 仓库映射 | 结论 |
|---|---|---|---|---|
| **Cumulated Gain-Based Evaluation of IR Techniques** — Kalervo Järvelin、Jaana Kekäläinen，2002，*ACM Transactions on Information Systems* 20(4):422–446，DOI [10.1145/582415.582418](https://doi.org/10.1145/582415.582418)，`abstract_or_public_description` | DCG/NDCG 依赖有定义的相关性判断和固定的 ranked retrieval universe；排序改变就改变被评估的 retrieval function。 | `replay/evaluator.ts` 的 `ndcgAtK`、`candidateSetCompleteness`、`candidateSetTotalCount`。 | 采纳“先固定候选宇宙，再解释排名”的边界；不把 fallback 排序称为 native variant。 |
| **Inference and Missing Data** — Donald B. Rubin，1976，*Biometrika* 63(3):581–592，DOI [10.1093/biomet/63.3.581](https://doi.org/10.1093/biomet/63.3.581)，`abstract_or_public_description` | 忽略缺失机制需要 MAR 等条件与参数可区分性；complete-case filtering 不是无条件无偏的修复。当前没有 score 缺失机制或可识别性证明。 | 缺分候选的删除会让候选组成与缺失状态相关；`ReplayMetricEligibility` 不能默认为可忽略缺失。 | 拒绝 candidate filtering 作为严格修复；采用 request-level abstention 并显式报告缺分分母。 |
| **Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms** — Lihong Li、Wei Chu、John Langford、Xuanhui Wang，2011，*WSDM 2011*:297–306，DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878)，官方 [Microsoft Research PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/Published-3.pdf)，`abstract_or_public_description` | Replay 只保留目标 action 与 logged action 可比的事件，并依赖随机或已知 propensity、support 和展示 action reward；这支持“严格匹配/拒答”，不是任意删除候选。 | 当前 replay 没有 target-vs-logged action、propensity 或 impression contract；只有 snapshot 候选与可选 score。 | 采纳“证据不匹配就不进严格分母”；拒绝把 score 缺失候选过滤后假装 full-set 可比。 |
| **Unbiased Learning-to-Rank with Biased Feedback** — Thorsten Joachims、Adith Swaminathan、Tobias Schnabel，2017，*WSDM 2017*:781–789，DOI [10.1145/3018661.3018699](https://doi.org/10.1145/3018661.3018699)，`abstract_or_public_description` | Propensity-weighted correction 需要可识别的 observation/click propensity 与 action support；过滤或只看 observed rows 不能替代它。 | 当前 replay snapshot 没有随机曝光概率、position propensity 或完整 impression log。 | 仅作为缺 propensity 的拒绝证据；不引入 propensity estimator。 |
| **Doubly Robust Policy Evaluation and Learning** — Miroslav Dudík、John Langford、Lihong Li，2011，*ICML 2011*:1097–1104，官方 [ICML PDF](https://icml.cc/2011/papers/554_icmlpaper.pdf) 与 [Microsoft Research page](https://www.microsoft.com/en-us/research/publication/doubly-robust-policy-evaluation-and-learning-2/)，`abstract_or_public_description` | DR 需要 logged action reward、propensity/support，并依赖 logging-policy model 或 reward model 至少一侧可验证；两侧错误、support 破坏或高方差会失效。 | OPE V3 没有 real logged action、PIT、propensity 或可验证 reward model；trace fallback 不是 DR reward model。 | 作为竞争方案拒绝；不能用另一个 pipeline score 静默冒充 native variant 或 DR correction。 |
| **Counterfactual Risk Minimization: Learning from Logged Bandit Feedback** — Adith Swaminathan、Thorsten Joachims，2015，*ICML 2015 / PMLR 37*:814–823，官方 [PMLR 页面](https://proceedings.mlr.press/v37/swaminathan15.html) 与 [PDF](https://proceedings.mlr.press/v37/swaminathan15.pdf)，`abstract_or_public_description` | CRM/IPS 依赖 logged bandit action probability、support 和方差控制；没有行为策略概率时不能从 replay labels 推导 counterfactual risk。 | Rust 是概率/RNG/joint propensity 唯一 owner，但本 evaluator 没有随机 policy receipt 或 PIT 对齐。 | 拒绝 IPS/DR/CRM 作为本阶段缺分补救；保留 diagnostics-only abstention。 |
| **Retrieval Evaluation with Incomplete Information** — Chris Buckley、Ellen M. Voorhees，2004，*SIGIR 2004*:25–32，DOI [10.1145/1008992.1009000](https://doi.org/10.1145/1008992.1009000)，官方 [NIST record](https://www.nist.gov/publications/retrieval-evaluation-incomplete-information)，`abstract_or_public_description` | 这是 incomplete relevance judgments 而非 missing score；其结论说明标准指标对观测不完整不鲁棒。将其类比到 score provenance 只能支持 coverage/diagnostic，不可直接推导 full metric。 | `ReplayMetricEligibility` 已把 missing feedback 与 candidate-set completeness 分开；本阶段再分离 score provenance。 | 采纳“缺失证据先报告 coverage”；拒绝把不完整观测压成 full-set utility。 |
| **PROV-DM: The PROV Data Model** — Luc Moreau、Paolo Missier（编辑），2013，W3C Recommendation，官方 [dated recommendation](https://www.w3.org/TR/2013/REC-prov-dm-20130430/)，`full_text` | provenance 将 entity、activity、agent 与 derivation 关联；它能说明值如何生成，不能证明值的 utility、无偏性或真实资格。 | `scoreSource` 只能是可审计的派生来源，不得成为 trust root、approval brand 或 qualification receipt。 | 采纳最小派生链：variant 要求的字段、实际采用字段、fallback reason、request/candidate 计数。 |

这些来源支持证据边界，不构成仓库效果结果。没有外部论文可证明当前 synthetic/offline 输入具备
真实 utility、coverage、PIT 或 qualification 能力。

## 方案比较

| 方案 | 适用条件与指标 | 失败模式 | 决策 |
|---|---|---|---|
| **严格 abstention** | 对 `trace_final_score_v1` 要求每个候选 `score` finite；对 `trace_weighted_score_v1` 要求每个候选 `weightedScore` finite。所有候选（不只是 top-K）均满足，且 labels 与 candidate set 仍完整时才进入严格 NDCG/MRR/Recall/negative/click。 | 分母减少，可能 `partial` 或 `not_evaluable`；若只检查 top-K，会让未入选缺分候选在重排中被错误忽略。 | **采用**，作为唯一 score-backed 指标门槛。 |
| **candidate filtering** | 先删除缺分候选，再在剩余集合计算；只能定义为另一个 filtered-universe observed diagnostic。 | 改变 candidate set、top-K 和 selection event；缺失与来源/位置相关时产生选择偏差；与 `complete_v1` 不兼容。 | **拒绝**严格指标；不在当前合同新增 filtered target。 |
| **fallback + explicit provenance** | 保留现有排序可运行性；为每个候选标记 `native_<field>` 或 `fallback_<field>/<baseline_rank>`，并聚合 fallback candidate/request rate。 | provenance 只说明采用了什么，不能补回缺失 native score、propensity 或真实 label；混合排序不得进入 native variant 质量分母。 | **采用为 diagnostics-only**，适配现有 bounded replay。 |
| **independent aggregate delta** | 分别对 baseline 与 variant 的 eligible request 求宏平均，再直接相减。 | score provenance 只在 variant 侧缺失时，两侧分母和 request 集合不同；差值混合了策略变化与样本组成变化。 | **拒绝**，不得把不配对的 aggregate difference 作为 variant delta。 |
| **paired common-eligible delta** | 在同一 request 集合上累计 baseline/variant 严格指标；观察性 author/OON 指标仍可保留全量诊断。 | 没有共同 eligible request 时只能返回兼容性零值与 `not_evaluable`；不能通过删候选或缺失插补扩大集合。 | **采用**，复用现有 per-request eligibility，额外 O(requests) accumulator。 |
| **diagnostics-only abstention** | 输出 observed ranking、fallback coverage、source counts、request/candidate 分母和 eligibility reasons；不输出 finite-sample utility/pass。 | 数值字段可能保留兼容性零值，消费者若忽略 status/reasons 仍会误读。 | **继续采用**，并把 score provenance 纳入 reason/version。 |

## 最小可执行范围

1. **Variant-specific applicability**：新增私有判定，不复制 Rust 算法；只检查该 variant 的
   native score 字段是否 finite。`baseline_rank_v1` 不受 score 缺失影响；hybrid/guardrail 的
   缺失信号继续只作为 fallback diagnostic，不冒充 native score。
2. **Provenance**：在 replay ranking 行或等价 summary 中记录实际 score source，至少区分
   `native_score`、`native_weighted_score`、`fallback_score`、`fallback_pipeline_score`、
   `fallback_baseline_rank` 和 `missing_default`；未知来源 fail closed。输入字段名不能由调用者
   自报为“native”。
3. **Eligibility**：若任一候选缺少该 variant 的 native score，严格 score-backed 分母排除该
   request，并记录独立 reason（需要新版本化的 eligibility contract，不能把它塞进旧 reason
   而不改版本）。observed ranking 与 fallback coverage 仍可返回。
4. **指标**：保留 `eligibleRequestDenominator`、`eligibleCandidateDenominator`、
   `excludedRequestCount`；baseline/variant 的严格 delta 只在共同 eligible request 集合上累计，
   没有共同集合时输出兼容性零值和 `not_evaluable`。新增的 fallback rates 只作为诊断。没有产品
   owner 阈值时输出 frontier，不生成 pass gate。
5. **资源与失败条件**：每个候选只需一次 finite/source 判定，新增计算为
   `O(C_total)`，额外计数器为 `O(1)`；若保留 per-candidate provenance，额外存储为
   `O(C_total)`，其中 `C_total <= 65,536` 由现有 replay CLI admission 约束。不得在该路径创建
   RNG、propensity estimator、模型、持久化 sink 或无界 map。输入资源、variant 校验和已有
   bounded sort 保持不变；未知 variant、非 finite score、缺失候选集合同均 fail closed。

## 验收与边界

- 最小回归必须构造一个完整 labels + 完整 candidate set，但目标 native score 缺失、其他 score
  存在的 request；它必须保持可观察的 fallback ranking，同时严格 score-backed status 为
  `partial`/`not_evaluable`，并显示实际 fallback source 与分母。
- 另一个 request 需证明“只 top-K 有 native score、候选集其余部分缺失”仍被排除，防止 candidate
  filtering 或 top-K-only shortcut。
- 混合 native/fallback requests 必须证明 delta 使用共同 eligible 分母，而不是把两侧不同宏平均直接相减；共同分母为零时 strict delta 保持零值并标记 `not_evaluable`。
- `baseline_rank_v1` 的现有行为必须不受影响；`hybrid_signal_blend_v1` 和
  `industrial_guardrail_blend_v1` 仍只能声明 diagnostics。
- focused Vitest、TypeScript `--noEmit`、Rust fmt/Clippy/Cargo locked 检查和 `git diff --check`
  是实现阶段门槛；本研究阶段不修改 Rust owner。
- 此阶段任何 `complete` 都只表示输入合同满足并已选择的离线诊断分母，不表示真实 utility、
  finite-sample inference、candidate qualification、Promotion 或 production serving。

## 决定

| 范围 | 状态 |
|---|---|
| score provenance diagnostic | `CONDITIONAL GO / private offline-only` |
| variant-specific strict denominator | `CONDITIONAL GO / versioned eligibility contract` |
| candidate filtering for strict metrics | `NO-GO / changes candidate universe` |
| fallback as native utility evidence | `NO-GO / provenance is not evidence` |
| IPS/DR/CRM or missingness correction | `NO-GO / propensity and support unavailable` |
| candidate selection / qualification | `NO-GO / no_candidate_selected` |
| real inference / Promotion / exploration / Task 9 | `UNAVAILABLE / NO-GO / UNAUTHORIZED` |
