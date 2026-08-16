# Phase 40 Replay Metric Eligibility

## Scope and verdict

本阶段修复的是离线 replay 指标的证据边界，不新增 estimator、candidate、OPE receipt 或生产调用者。当前 replay evaluator 的实际消费者是 `evaluateRecsysReplay.ts` 与 focused tests；没有 SpaceService、route、worker、scheduler、selector 或 Promotion caller。

结论：

- metric eligibility / denominator contract：`GO`，仅 offline diagnostic；
- candidate-set truncation：完整候选集缺失时不进入 full-set feedback 指标；
- counterfactual estimator、cluster bootstrap、confidence sequence：`NO-GO`，继续 abstention；
- `selectedMethod=diagnostics_only_abstention_v1`、`realDatasetEligible=false`、`candidateQualificationStatus=not_run` 保持不变。

## Research questions

1. 缺少反馈或候选集被截断时，request-level macro 指标是否会把“不可评估”压成数值零？
2. NDCG、MRR、Recall 和 negative/click 指标需要哪些完整候选集与标签分母？
3. observed-set 的多样性诊断能否与 full-set quality 指标分开，避免截断集合被解释为全量质量？
4. 是否可以在没有随机 propensity、PIT、viewer/time cluster 和 qHat provenance 时使用 IPS/DR、bootstrap 或 confidence sequence？

## Evidence matrix

| Source | Preconditions and limitations | Repository mapping | Decision |
|---|---|---|---|
| Kalervo Järvelin, Jaana Kekäläinen (2002), “Cumulated Gain-based Evaluation of IR Techniques”, *ACM Transactions on Information Systems* 20(4), 422–446, DOI [10.1145/582415.582418](https://doi.org/10.1145/582415.582418), `abstract_or_public_description` | Graded relevance judgments and a defined judged set are required for DCG/NDCG-style comparisons; an observed truncated set is not automatically the full judged universe. | `replay/evaluator.ts` `ndcgAtK`, `ReplayCandidateSnapshot.candidateSetTotalCount/candidateSetTruncated` | Adopt only the contract distinction: full-set metrics require a complete candidate-set declaration. Do not infer unseen relevance. |
| Alexandre Gilotte, Clément Calauzènes, Thomas Nedelec, Alexandre Abraham, Simon Dollé (2018), “Offline A/B testing for Recommender Systems”, *WSDM 2018*, DOI [10.1145/3159652.3159687](https://doi.org/10.1145/3159652.3159687), `abstract_or_public_description` | Counterfactual estimators need logged randomized behavior, propensity semantics and outcome assumptions; bias/variance tradeoffs remain data-dependent. | Replay evaluator has labels but no randomized propensity, PIT or source receipt; OPE V3 remains synthetic-only. | Reject IPS/DR/NCIS as a Phase 40 fix. They cannot repair missing feedback or candidate-set provenance. |
| Adith Swaminathan, Thorsten Joachims (2015), “Counterfactual Risk Minimization: Learning from Logged Bandit Feedback”, *ICML 2015 / PMLR 37*, 814–823, official [PMLR page](https://proceedings.mlr.press/v37/swaminathan15.html), `abstract_or_public_description` | Propensity-weighted risk and variance bounds assume logged bandit feedback with valid action probabilities and support. | `replay/evaluator.ts` is deterministic snapshot replay; no `logged_randomized` source is accepted. | Reject as estimator; retain only as evidence for the missing-propensity blocker. |
| Diagnostics-only abstention, repository contract (`diagnostics_only_abstention_v1`), `full_text` | Makes no finite-sample or production-quality claim; reports observed diagnostics and explicit missing evidence. | Phase 12–39 qualification/handoff contracts and replay diagnostics. | Keep as the only active method and never clear finite-sample/multiplicity blockers. |

外部研究没有被用来挑选新算法；本次实现是由现有指标合同和已发现的分母错误驱动的窄语义修复。论文只用于确认前提和拒绝越界解释，不构成仓库效果证据。

## Frozen diagnostic contract

本节记录 Phase 40 的历史 `replay_metric_eligibility_v1`；Phase 52 已由 `replay_metric_eligibility_v2` 取代该版本，并新增 variant-specific score provenance 资格条件。

`ReplayRankingMetrics.metricEligibility` 使用版本 `replay_metric_eligibility_v1`：

- `complete`：所有 request 同时具备完整 observed labels 和完整 candidate set；
- `partial`：只有部分 request 满足条件，指标只对 eligible request 求 macro 平均；
- `not_evaluable`：没有 eligible request，数值字段保留兼容性零值，但状态与分母明确说明不可评估；
- `reasons` 按固定顺序记录 `missing_feedback`、`candidate_set_truncated`、`candidate_set_completeness_unverified`；
- `eligibleRequestDenominator` / `eligibleCandidateDenominator` 是实际进入 full-set feedback 指标的分母；
- `excludedRequestCount` 记录被排除的 request；
- `observedRequestDenominator` / `observedCandidateDenominator` 是 author-diversity、out-of-network ratio 等 observed-set 诊断的分母；
- `excludedObservedCandidateCount` 明确只统计已观测 rows，不把未观测候选伪装成已排除样本；
- `observedCandidateSetOnly=true` 表示输入仍可用于 observed-set 诊断，但不得解读为 full-set quality。

只有 exporter 明确标记 `candidateSetCompleteness=complete_v1`、`candidateSetTotalCount` 与 observed candidate 数一致且 `candidateSetTruncated=false` 时才视为完整。缺少该 metadata、总数不一致或显式截断均 fail closed。缺少反馈的 request 同样不进入 click/engagement/negative、NDCG、MRR、Recall 的 full-set 分母。rank-lift leaders 只使用同一 eligible request 集合，并分别输出 eligible、engaged-target 和 clicked-target request 分母。

资源模型沿用已有 bounded replay 输入；本合同只增加 O(requests) counters，不新增随机数、模型训练、持久化 sink 或大规模分配。

## Boundary

所有新字段属于离线 evaluator contract。没有新的 brand、trust root、qualification seed、ledger、production registry 或 runtime route。任何 metric 通过都不能解除：

```text
finite_sample_inference_unavailable
multiplicity_control_unavailable
```
