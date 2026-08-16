# Phase 43：多样性分层归因与诊断边界

## 代码事实

- `run_local_scorers` 同时被生产 `execute_score_stage`/`execute_ranking_stage` 和
  offline replay 调用；本阶段不改变共享 scorer 语义。
- 多样性处理分布在 `SourceDiversityFactor`、intra-request repetition、listwise
  author/source decay、`AuthorDiversityScorer` 和 selector caps。
- identity key 并不统一：heuristic 使用 `recall_source`，request source key 对新闻
 可能使用 URL host，selector 优先 `recall_source`，最终 news diversity key 还会使用
  domain/cluster/source。
- `ScoreContract` 当前只记录最终 `diversityMultiplier`，不能从已有 breakdown 完整重构
  source、semantic、intra-request 和 listwise 贡献。
- `DiversityStatsSideEffect` 是 live side effect，不是 OPE 或 qualification source；本阶段
  只修复其日志摘要的确定性。

## 研究问题

1. 多层独立乘法是否重复惩罚同一 source/author/topic，而不是一个明确的 marginal objective？
2. source、author、topic、news domain 和 cluster 是否需要一个稳定的 identity owner？
3. candidate pool 变化时，source-share multiplier 的非单调性是否是产品要求，还是应当成为 blocker？
4. 现有 breakdown 是否足以重构每层多样性贡献，还是必须升级生产合同？
5. 在没有真实 feedback、PIT 和目标函数时，是否可以选择新的 diversity estimator？

## Evidence matrix

| 来源 | 前提与结果 | 失败模式 / 复杂度 | 仓库映射与决定 |
|---|---|---|---|
| Jaime Carbonell、Jade Goldstein，1998，*The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing Summaries*，SIGIR，DOI [10.1145/290941.291025](https://doi.org/10.1145/290941.291025)，`full_text` | MMR 用相关性与候选到已选集合的相似度构成显式 greedy marginal objective；需要可解释的 relevance/diversity 权重与相似度。 | 权重和相似度语义由产品任务决定；不能把现有多层 multiplier 直接解释为 MMR。每步需扫描已选集合。 | 作为竞争方案研究；当前没有冻结 relevance、novelty 或目标权重，拒绝实现 estimator。 |
| Rodrygo L. T. Santos、Jie Peng、Craig Macdonald、Iadh Ounis，2010，*Explicit Search Result Diversification through Sub-queries*，ECIR，DOI [10.1007/978-3-642-12275-0_11](https://doi.org/10.1007/978-3-642-12275-0_11)，`full_text` | xQuAD 需要显式 sub-query/aspect 概率和候选对各 aspect 的覆盖估计。 | 当前 candidate 没有由 owner 验证的 intent/aspect 分布；伪造 aspect 会制造新的信任面。 | 作为 aspect-aware 对照；拒绝新增 sub-query contract。 |
| Alex Kulesza、Ben Taskar，2012，*Determinantal Point Processes for Machine Learning*，Foundations and Trends in Machine Learning 5(2–3)，DOI [10.1561/2200000044](https://doi.org/10.1561/2200000044)，`full_text` | DPP 以质量项和相似度 kernel 定义集合分布，需要 PSD kernel、质量标定和集合级目标。 | kernel/质量缺失或不稳定会改变集合语义；当前 selector/score contract 没有 DPP receipt 或资源模型。 | 作为集合级替代方案；拒绝实现或将 synthetic score 称为 utility。 |
| Charles L. A. Clarke、Maheedhar Kolla、Gordon V. Cormack、Olga Vechtomova、Azin Ashkan、Stefan Büttcher、Ian MacKinnon，2008，*Novelty and Diversity in Information Retrieval Evaluation*，SIGIR，DOI [10.1145/1390334.1390446](https://doi.org/10.1145/1390334.1390446)，`full_text` | α-nDCG 等指标需要明确 subtopic 标注和评估分母，才能衡量 novelty/diversity。 | 没有真实 labels、完整 candidate set 或稳定 subtopic 时，分数只能是 observed-set diagnostic。 | 拒绝把 replay rank/分布统计升级为质量或 coverage 证据。 |
| Diagnostics-only abstention，仓库合同 `diagnostics_only_abstention_v1`，`full_text` | 不声明 estimator 适用性、utility、coverage 或 qualification；继续保留 `realDatasetEligible=false`、`candidateQualificationStatus=not_run`。 | 没有候选选择；所有研究结果必须停留在诊断和缺口记录。 | 作为唯一 active method 和 handoff 边界，采用。 |

## 观察到的诊断事实

- source-share factor 仅看 `recall_source`，同一 source 的 score 会随候选池组成变化；例如两个 source-`S`
  候选的 multiplier 为 `0.85`，加入三个 source-`T` 后 share 变为 `0.4`、multiplier 变为 `0.90`。
- 同一 source 还可能经过 intra-request source repeat、listwise source decay 和 selector source cap，
  但这些层没有共同的预算或可重构 receipt。
- listwise source 分组只读取 `recall_source`；当该字段缺失时，不同 news domain 或 retrieval lane
  可能被合并到同一个空 key，而 request source helper 使用不同 fallback。该差异需要先冻结
  source identity 版本，当前不直接修正排序。
- tie sorting 在 `DiversityStatsSideEffect` 只按 count 排序；HashMap 的 equal-count 顺序不是稳定合同，
  会让 live 诊断日志随进程/迭代顺序变化。

## 实施范围与拒绝范围

本阶段只增加按 key 的 lexical tie-break，保持统计值、排序常数和 side-effect 开关不变；增加一个 focused
unit test 锁定 equal-count 摘要顺序。该修复不产生 evidence、candidate applicability、OPE 或 Promotion 能力。

拒绝实现 MMR、xQuAD、DPP、α-nDCG、常数调参、线上探索、真实 utility/coverage、生产 randomized serving、
qualification seed/root、Decision Log 激活和 Task 9。

## 决定

| 范围 | 状态 |
|---|---|
| 多样性 estimator / candidate selection | `NO-GO / no_candidate_selected` |
| replay 多层归因 | `CONDITIONAL GO`，需未来明确 consumer 与 production breakdown 合同 |
| live 诊断日志确定性 | `GO`，只做 lexical tie-break |
| real finite-sample inference / OPE | `UNAVAILABLE / BLOCKED` |
| Promotion / exploration / Task 9 | `NO-GO / UNAUTHORIZED` |
