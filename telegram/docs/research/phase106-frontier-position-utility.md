# Phase 106: Epsilon-PL Position Utility / Target Distribution Boundary

## Scope and verdict

本阶段只审查 private offline epsilon-Plackett-Luce frontier 是否兑现 Phase 39
承诺的 position-wise synthetic utility 诊断，并厘清它与 target-distribution/OPE
的边界。不修改 Rust 概率 owner、Node OPE 合同、生产 scorer、Promotion、
randomized serving 或 `ml-services/**`。

当前结论：

- `total-only` 仍可作为兼容字段，但不能单独兑现 Phase 39 的 per-slot / total
  诊断承诺。
- 精确的 position-wise expected score vector 是一个 bounded、可证伪、复用现有
  subset-state DP 和 canonical Rust kernel 的离线候选，判定为
  `CONDITIONAL GO`。它只增加 diagnostics，不选择 candidate，不产生 reward 或
  OPE evidence。
- DCG、ERR、RBP 等 rank utility 需要额外的 relevance、calibration、cascade 或
  persistence 合同；当前没有这些输入或产品阈值，判定为 `NO-GO`。
- 将 frontier 输出接入 target-distribution/OPE 也判定为 `NO-GO`。当前 target
  distribution 只有受验证的 policy probabilities，OPE 还需要 logged behavior
  propensity、support、outcome、PIT 和 prediction evidence。
- 当前阶段没有 candidate 被选择：`no_candidate_selected`。保留
  `diagnostics_only_abstention_v1` 是唯一安全结果边界。

全局状态不变：

```text
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
realDatasetEligible = false
real finite-sample inference = UNAVAILABLE
production randomized serving = disabled
Promotion / exploration / Task 9 = NO-GO / UNAUTHORIZED
```

## 当前代码事实与调用图

- `telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/lib.rs`
  以 `#[cfg(test)] mod policy_frontier;` 编译 frontier；图索引中
  `frozen_frontier` 的唯一 caller 是冻结单元测试，没有非测试或 runtime caller。
- `policy_frontier.rs:175-189` 的 `EnumerationStats` 只有
  `expected_total_score`，`SubsetState` 只有 `accumulated_score`。
  `enumerate_configuration` 在每个终点累加
  `state.mass * state.accumulated_score`，因此只能输出总分。
- `evaluate_frontier` 将该总分写入 `FrontierPoint.expected_total_score`，并用它计算
  `synthetic_utility_loss` 和 Pareto frontier；报告仍固定为
  `status="diagnostic_only"`、`real_dataset_eligible=false`、`servable=false`。
- Phase 39 研究文档的最小方案明确列出
  `expected per-slot / total score utility`，但当前实现没有 per-slot 字段。这是
  一个与现有 test-only harness 连续、可量化的合同缺口，不是生产算法缺陷。
- `target_distribution::build_target_distribution_reader_emitting` 验证冻结 source
  manifest、`RandomizedSlateConfigV1`、候选 support 和有序 decision ids，并生成
  `created_from_immutable_inputs=true`、`servable=false` 的 manifest。
  `verify_target_distribution_from_readers` 重新构建 stream、比较 digest/count 和
  high-water diagnostics。两个 public 函数的非测试 inbound caller 均为 0，现有
  caller 是 Rust/Node fixture 与 cross-runtime tests。
- TypeScript OPE v2/v3 需要 verified projection、behavior support、target
  distribution、observed outcome，以及在 DR 路径上的 prediction evidence。frontier
  的 synthetic score 不是 reward，不能填充这些字段。

## 研究问题

1. 在 epsilon 与 temperature 改变 slate 顺序分布时，只有总期望分数是否会隐藏同一
   total 下的前位/后位 trade-off？
2. 能否在现有 subset-state 合并不变的情况下，精确计算每个 served position 的
   expected score，并由位置向量重建 total？
3. DCG、ERR 或 RBP 是否有足够的 relevance、stop-probability 或 persistence 前提，
   可以把当前 logits 当作可解释 rank utility？
4. position-wise synthetic diagnostic 是否能补足真实 OPE 的 reward、propensity、
   support、PIT 或 finite-sample inference 前提？
5. 增加位置向量后，首次 kernel 调用前的 resource preflight、canonical output
   upper bound 和 deterministic digest 应如何保持 fail-closed？

## Primary-source evidence matrix

| 来源 | 精确元数据与阅读状态 | 数据 / PIT / support 前提与失败模式 | 仓库映射与决定 |
|---|---|---|---|
| **Cumulated gain-based evaluation of IR techniques** - Kalervo Järvelin, Jaana Kekäläinen, 2002, *ACM Transactions on Information Systems* 20(4):422-446, DOI [10.1145/582415.582418](https://doi.org/10.1145/582415.582418), `abstract_or_public_description` | DCG/NDCG 把位置 discount 与 graded relevance gain 组合成 rank utility；需要固定的 ranked universe 和可解释 relevance judgments。raw model logit 不是自动的 relevance grade。 | 缺 relevance 标定、gain 域或产品 discount 时，改变 discount 会改变 estimand；`2^score-1` 还需要额外数值边界。没有 PIT 或 behavior propensity，DCG 也不是 OPE。 | 作为竞争 rank utility 研究。拒绝将 `scenario.scores` 直接解释为 graded relevance；可保留 exact position vector 作为 score diagnostic。 |
| **Expected reciprocal rank for graded relevance** - Olivier Chapelle, Donald Metlzer, Ya Zhang, Pierre Grinspan, 2009, *Proceedings of the 18th ACM Conference on Information and Knowledge Management*:621-630, DOI [10.1145/1645953.1646033](https://doi.org/10.1145/1645953.1646033), `abstract_or_public_description` | ERR 使用 cascade/stop model，把每个位置的 relevance 转成用户停止概率；需要 calibrated grade-to-stop mapping 和独立用户行为语义。 | 当前 fixture 没有 stop probability、click model 或 user-time outcome；任意映射会制造未经授权的 reward model，且序列项有乘积下溢风险。 | 拒绝实现 ERR；它不能由 epsilon-PL propensity 或 synthetic score 推出。 |
| **Rank-biased precision for measurement of retrieval effectiveness** - Alistair Moffat, Justin Zobel, 2008, *ACM Transactions on Information Systems* 27(1):1-27, DOI [10.1145/1416950.1416952](https://doi.org/10.1145/1416950.1416952), `abstract_or_public_description` | RBP 需要 persistence parameter `p` 和 binary/graded relevance；其 geometric position weighting 表达特定用户浏览假设。 | `p` 没有产品 owner 或 evidence；没有 relevance labels 时只能把 score 当未定义 proxy。不同 `p` 会产生不同 frontier，不能虚构阈值。 | 拒绝作为当前 frontier utility；未来只有在 relevance/persistence 合同冻结后再研究。 |
| **Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms** - Lihong Li, Wei Chu, John Langford, Xuanhui Wang, 2011, *WSDM 2011*:297-306, DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878), [official Microsoft Research PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/Published-3.pdf), `abstract_or_public_description` | Unbiased counterfactual evaluation requires randomized/known logging propensity, target action support and observed reward for the same decision. Deterministic score replay is not a substitute. | 当前 frontier has synthetic score only; target distribution verification has no outcome. Missing PIT, viewer/time provenance and valid behavior logs prevent real utility or finite-sample claims. | Establishes the OPE boundary. Reject connecting position diagnostics directly to OPE or qualification. |
| **Counterfactual Risk Minimization: Learning from Logged Bandit Feedback** - Adith Swaminathan, Thorsten Joachims, 2015, *ICML 2015*, PMLR 37:814-823, [official PMLR page](https://proceedings.mlr.press/v37/swaminathan15.html), `abstract_or_public_description` | IPS/CRM relies on action probabilities, overlap/support and variance control; clipping changes the estimand and does not create missing evidence. | Frontier's minimum joint propensity is a worst-case policy-risk diagnostic, not a sampled behavior propensity or reward estimate. | Adopt only the distinction between support-risk diagnostics and OPE; reject estimator/promotion use. |
| **Diagnostics-only abstention**, repository contract `diagnostics_only_abstention_v1`, `full_text` | Output may be deterministic and useful for engineering comparison while explicitly refusing estimator applicability, real utility, coverage or qualification claims. | No reward, PIT, behavior policy receipt or product threshold is invented. `realDatasetEligible=false` and `servable=false` remain hard boundaries. | Adopt as the active baseline and fallback for every alternative. |

这些来源是方法前提证据，不是仓库效果结果；没有来源证明当前 synthetic fixture 具备真实 utility、
coverage、PIT 或 qualification 能力。

## 方案比较

| 方案 | 可证伪指标与资源 | 失败模式 | 决定 |
|---|---|---|---|
| **当前 total-only** | 继续输出 `expected_total_score`；现有 subset DP 资源不变。可验证总概率质量和总分与 ordered reference 一致。 | 两个配置可能有相同 total、不同 position exposure；不能兑现 Phase 39 的 per-slot 诊断承诺。 | 作为兼容字段保留；单独使用为 `CONDITIONAL NO-GO`。 |
| **exact position-wise expected score** | 增加长度为 `K` 的 `expected_score_by_position`。在 depth `d` 的每个 transition 加总 `next_mass * selected_score` 到位置 `d+1`；最终 `sum(vector)` 必须在 `NUMERIC_TOLERANCE` 内等于 total。令 `n` 为候选数、`K` 为 slate size、`G` 为 configuration 数、`S` 为 scenario 数，现有 probability evaluations 为 `P = sum_{d=0}^{K-1} C(n,d)(n-d)`，总工作为 `O(S*G*(P + K))`，额外统计内存为 `O(K)`，canonical output 上界增加 `O(S*G*K)`。preflight 必须先检查该新增输出预算。 | 仍只是 model-score expectation；不能解释为 user reward、CTR、utility 或 OPE estimand。向量字段改变 report digest，需要更新 contract/golden fixture。 | **CONDITIONAL GO**，下一阶段只在 `cfg(test)` private harness 实现。 |
| **DCG / NDCG** | 对每个位置应用固定 discount 和已定义 gain；需要 relevance labels、gain domain、discount version。 | raw logits 不是 relevance；gain/discount 未定会伪造产品目标，且 NDCG 需要 ideal denominator。 | **NO-GO**。 |
| **ERR** | 需要 calibrated grade-to-stop probability、cascade assumptions 和 sequence outcome。 | 没有 stop model 或 viewer event；不能从 propensity 或 score 推导。 | **NO-GO**。 |
| **RBP** | 需要 persistence `p`、relevance labels 和版本化用户浏览假设。 | 没有 owner threshold；不同 `p` 改变 frontier，容易把诊断变成未经授权的 pass gate。 | **NO-GO**。 |
| **frontier -> target_distribution/OPE bridge** | 需要 immutable logged decisions、behavior propensity、target support、observed outcome、PIT、cluster provenance 和可验证 qHat。 | 当前 frontier 是 test-only synthetic score；target distribution receipt 只证明 policy probability stream，OPE 还会拒绝缺失 outcome/evidence。 | **NO-GO**；不新增 wrapper、receipt、ledger 或 consumer。 |
| **diagnostics-only abstention** | 输出 deterministic vector/frontier 和 resource diagnostics；不输出 candidate qualification、real utility 或 production status。 | 没有产品阈值时只能给 observed frontier，不能选择某个 epsilon/temperature。 | **采用**，作为所有方案的边界。 |

## 最小可执行范围

下一阶段如继续，范围应严格限制为：

1. 在 private `cfg(test)` frontier 中增加 position vector；不改变
   `compute_full_distribution`、epsilon-PL 公式、RNG 或任何 Node 数学。
2. 用现有 subset-state `mass` 做位置贡献累加，不在 state 中复制 ordered path
   history。扩展 test-only ordered reference，逐位置比较 vector、total、概率质量和
   propensity diagnostics。
3. 在首次 kernel 调用前把 `S * G * K` 的最大 position output bytes 纳入 preflight；
   超过上界返回 `resource_limit_exceeded`，不部分返回 report。新增字段参与 canonical
   digest，所有 fixture 失败必须显式更新而不是兼容性忽略。
4. 测试至少覆盖 `slate_size=1`、全 tie、steep score gap、最小正 epsilon、`epsilon=1`
   和资源拒绝；只断言可由确定性输入推出的 vector-sum / reference invariants，不断言
   产品阈值或真实效果。
5. target-distribution/OPE 保持只读边界：不把 vector 写入 target manifest、OPE
   projection、outcome、qHat 或 qualification receipt。

## 验收与未决不确定性

- 验收证据应包括：position vector 与扩展 ordered reference 在容差内相等；vector 求和与
  `expected_total_score` 相等；重复运行 report bytes/digest 相等；resource preflight 在
  kernel 前拒绝；现有 support/propensity mass checks 不回退。
- 不能从 position vector 推断真实 CTR、engagement、coverage、OPE confidence interval、
  candidate qualification 或 promotion threshold。
- 未决问题是产品是否真的需要 rank-position utility，以及若需要，relevance、discount、
  stop 或 persistence 的 owner 与 PIT source 是什么。在这些外部条件出现前，DCG/ERR/RBP
  不可决策。
- 下一最高价值离线实验是 position-vector replay fixture：在同一 frozen scenario/config
  上验证前位与后位期望分数变化可被量化，但只输出 frontier，不选择配置。

## 决定矩阵

| 范围 | 状态 |
|---|---|
| total-only compatibility field | `GO / retain` |
| exact position-wise synthetic score diagnostic | `CONDITIONAL GO / private offline-only` |
| DCG/NDCG, ERR, RBP | `NO-GO / missing relevance or user-model contract` |
| frontier to target-distribution/OPE | `NO-GO / missing outcome, PIT, support and propensity evidence` |
| candidate selection / qualification | `NO-GO / no_candidate_selected` |
| real inference / Promotion / exploration / Task 9 | `UNAVAILABLE / NO-GO / UNAUTHORIZED` |
