# Phase 25: Plackett-Luce / Gumbel-top-k 无放回 slate logging 研究

更新时间：2026-08-10

范围：只研究有序、无放回 slate 的 logging propensity；不改变 scorer、ranker、OPE 或线上策略语义。

## 结论与门禁

**Verdict: CONDITIONAL GO。**

1. 对纯 Plackett-Luce（PL），逐 slot 从剩余候选按正权重归一化采样，与对全部候选的 `log(weight) + Gumbel(0,1)` 做一次有序 top-k 完全同分布。第 `j` 个 slot 的条件 propensity 是剩余集合上的归一化权重；有序 prefix/joint propensity 是这些条件 propensity 的乘积。
2. Gumbel-top-k 是采样实现，不会自动产生可用于 OPE 的 propensity 证据。日志仍必须由未扰动权重和真实 prefix 重算逐 slot 条件概率，并在 log-space 累加 joint/prefix propensity。随机种子、扰动值、最终排名或单个 top-k inclusion probability 都不能替代该证据。
3. 仓库当前策略不是一般意义上的纯 PL，而是**每个 prefix 上 deterministic-top 与 PL categorical 的 epsilon 混合**。只有 `epsilon = 1` 时，它才与一次性 Gumbel-top-k 等价。对 `0 < epsilon < 1`，直接改成一次性 Gumbel-top-k 会改变策略分布、propensity 和 OPE estimand，必须拒绝。
4. 正概率不等于可用的 propensity floor。当前 Rust kernel 对下溢 fail-closed，能避免把数学上的正概率记录成 `0`，但 decision-log 合同只验证 `(0,1]`，没有策略级数值 floor。上线资格仍应要求不可伪造的 `minimumBehaviorPropensity`、`maximumPrefixWeight` 和 full-support 证据。
5. 推荐保持逐 slot conditional logging 为 canonical 语义。若以后为性能引入 Gumbel-top-k，只能作为 `epsilon = 1` 的等价采样后端，且必须通过固定随机性分布检验、逐 prefix propensity 重算、跨运行时 fixture 和版本化 rollout；当前 Phase 25 不应替换现行 sequential kernel。

## 研究问题

1. PL 的逐 slot conditional propensity、ordered prefix/joint propensity 与 Gumbel-top-k 的关系是什么？
2. 哪些条件保证 target 相对于 behavior 的 absolute continuity/full support；正支持与显式 propensity floor 有何区别？
3. 给定 per-slot floor，最大 prefix importance weight 能得到什么可执行上界？
4. 顺序采样、一次性 Gumbel-top-k 和 propensity 重算分别有哪些数值风险与复杂度？
5. 这些结论如何映射到仓库的 canonical owner、日志合同、OPE blocker 和真实证据门禁？

## 概率语义

令候选集合为 `N`，slate 长度为 `k <= |N|`，未扰动 logit 为 `phi_i`，正权重为

```text
w_i = exp(phi_i),  w_i > 0
R_j = N \ {a_1, ..., a_(j-1)}
```

纯 PL 的第 `j` 个 slot 条件概率与 ordered prefix/joint 概率分别为

```text
p_j(a_j | a_<j) = w_(a_j) / sum_(i in R_j) w_i
p(a_1:t)        = product_(j=1..t) p_j(a_j | a_<j)
p(a_1:k)        = product_(j=1..k) p_j(a_j | a_<j)
log p(a_1:t)    = sum_(j=1..t) log p_j(a_j | a_<j)
```

Kool、van Hoof、Welling 的 Gumbel-top-k 定理给出相同的 ordered joint：对独立
`G_i ~ Gumbel(0,1)`，按 `phi_i + G_i` 从大到小取前 `k` 个，所得顺序的概率正是上式乘积。因此：

- **逐 slot propensity**应指 `P(A_j=a_j | A_<j=a_<j)`，不是未条件化的 slot marginal `P(A_j=a_j)`。
- **ordered joint propensity**是条件概率乘积；建议存逐 slot 条件概率并派生 log-joint，而不是只存一个易下溢且难审计的乘积。
- **unordered set propensity**是同一集合所有 `k!` 个可能顺序的 ordered joint 之和，不能用上述某一个乘积代替。本仓库合同是有序 slate，不应混用。
- 一次 Gumbel-top-k 可以产生样本，但 propensity 必须从未扰动权重和实际移除顺序计算；扰动后的 top-k score 不是概率。

### 仓库现行 epsilon 混合

对 prefix `h = a_<j`，仓库当前行为核为

```text
q_j(i | h) = (1 - epsilon) * 1[i = deterministic_top(h)]
             + epsilon * w_i / sum_(l in R_j) w_l
```

这仍是合法的逐 slot、无放回策略，ordered joint 为 `product_j q_j`。但当
`0 < epsilon < 1` 时，它通常不存在一组固定权重，使整个 joint 等于标准 PL；
`deterministic_top(h)` 随 prefix 改变，混合发生在每个 conditional 上。因此：

- `epsilon = 1`：纯 PL，可用一次性 Gumbel-top-k 等价采样。
- `0 < epsilon < 1`：可对每个 slot 的**混合 categorical**重新做 Gumbel-max，但不能用一次固定 logit 的 Gumbel-top-k 取代全部 slots。
- `epsilon = 0`：确定性策略，不具备对非 deterministic slate 的 full support；仓库当前原语已拒绝该值。

## Full Support、floor 与 prefix weight

### Full support

对目标策略 `pi` 和行为策略 `q`，OPE 所需条件是针对 estimand 的 absolute continuity：

```text
pi(a_1:k | x) > 0  =>  q(a_1:k | x) > 0
```

纯 PL/Gumbel-top-k 在以下条件下对所有**有序且不重复**的长度 `k` slate 有 full support：

- `k <= n`，且每个被视为 eligible 的候选都处于同一明确支持集合；
- 所有未扰动权重严格为正且有限，等价地 logit 有限且没有被数值实现压成零；
- tie-breaking 与候选身份顺序确定且跨运行时一致；Gumbel 连续分布在实数数学中几乎处处无 tie，但有限精度实现仍需规定 tie 行为。

仓库 epsilon 混合在 `epsilon > 0` 且 PL 分量对所有 eligible 候选为正时，同样对全部合法 ordered slate 有 full support。候选过滤、eligibility 漂移、候选池/PIT 不一致、零权重、下溢为零、`k > n`，都会破坏或无法证明支持。

### Propensity floor

设仓库使用温度 `tau > 0`，并做 max-shift：

```text
w_i = exp((z_i - z_max) / tau)
S   = sum_i w_i
```

则对任意可达 prefix 和剩余 action，一个保守的全局 per-slot behavior floor 是

```text
delta = epsilon * w_min / S > 0.
```

若冻结合同还能证明候选数 `n <= n_max`、logit range `z_max-z_min <= Delta_max`，则有更易审计但更松的界：

```text
delta >= epsilon_min * exp(-Delta_max / tau_min_effective) / n_max
```

这里温度方向必须按真实允许区间重新审计；对固定 `Delta > 0`，更小温度使下界更差，所以配置门禁应使用允许的最小正温度。该界只有在候选数、epsilon、温度、logit range、eligibility 与 kernel version 都被证据绑定时才可用于生产资格。

“每个已记录概率大于零”不能替代 floor：它只证明观测路径未出现零，不能证明所有 target-supported prefix 的下界，也不能控制极小 propensity 导致的方差。

### 最大 prefix importance weight

第 `t` 个 ordered prefix 的 importance weight 为

```text
W_t = product_(j=1..t) pi_j(a_j | a_<j) / q_j(a_j | a_<j).
```

若所有 target-supported conditional 都有 `q_j >= delta_j > 0`，由于 `pi_j <= 1`：

```text
W_t <= product_(j=1..t) delta_j^(-1).
```

若只证明统一 floor `delta`，则 `W_t <= delta^(-t)`，从而
`max_(1<=t<=k) W_t <= delta^(-k)`。若直接证明 joint behavior floor `eta_k`，则 full-slate weight 上界为 `1/eta_k`。这些界通常随 slate 长度指数恶化，所以 floor 只是必要门禁，不代表估计器方差可接受；仍需记录实测 `maximumPrefixWeight`、ESS、clipping 影响和 tail diagnostics。

## 实现比较

| 维度 | 逐 slot PL / 当前 sequential kernel | 一次性 Gumbel-top-k |
|---|---|---|
| 分布语义 | 直接定义并暴露每个 prefix 的 categorical conditional | 对纯 PL 与左侧同分布；对当前 per-prefix epsilon 混合一般不等价 |
| 逐 slot propensity | 采样时自然得到，最适合作为日志事实 | 必须从未扰动权重和已选 prefix 另算；扰动值不能充当 propensity |
| ordered joint | 条件概率乘积；应累加 log | 同一 PL joint；仍应从 conditionals 累加 log |
| full support | 所有剩余权重正；当前混合还要求 `epsilon > 0` | 所有固定 PL 权重正、Gumbel/排序实现有效；零权重永远不会被抽到 |
| floor | 可由 epsilon、权重范围、候选数推导并逐 slot 审计 | 分布相同则 floor 相同；Gumbel 采样本身不会证明或记录 floor |
| 采样复杂度 | 一般朴素实现 `O(kn)`；维护动态权重树可到 `O(n + k log n)` | 生成 `n` 个 Gumbel 为 `O(n)`；全排序 `O(n log n)`；heap top-k `O(n log k)`，选择加已选排序可做到期望 `O(n + k log k)` |
| propensity 复杂度 | 若保留总权重并逐次减去已选权重，纯 PL 可 `O(n+k)`；但尾部 cancellation 需稳定处理，当前仓库因每 slot 排序/重算更高 | 选完后按顺序维护剩余总权重，纯 PL propensity 可 `O(n+k)`；同样有 cancellation 风险，且不能省略该步骤 |
| 空间 | 朴素 `O(n+k)` | 扰动数组/选择结构通常 `O(n)`，heap 可另加 `O(k)` |
| 主要优势 | 契约直观、逐 prefix 可审计、适合当前混合策略 | 纯 PL 下易并行生成噪声，top-k kernel 可高效，天然无重复 |
| 主要风险 | 重复归一化/扫描成本；直接乘 joint 下溢 | endpoint Gumbel、非有限值、有限精度 tie、只留样本而丢 propensity；误用于 epsilon 混合会改变策略 |

TensorFlow Probability v0.23.0 的成熟官方实现是一个有用参照：采样通过
`argsort(log(scores) + Gumbel)` 实现完整 permutation，`log_prob` 则按重排后的 scores、reverse cumulative sum 和 log-ratio 求和。它证明了“采样路径”和“概率计算路径”应分开。不过其 `validate_args` 默认是 `False`，官方文档明确警告无效输入可能静默产生错误输出；本仓库不应照搬这一默认值。

### 当前仓库的实际复杂度

`randomized_slate::simulate` 在每个 slot 对 remaining candidates 排序，调用共享原语重算全部概率，线性 CDF 扫描，再对 `Vec` 执行 remove。若初始候选数为 `n`、slate 长度为 `k`，当前上界由排序主导：

```text
sum_(j=0..k-1) O((n-j) log(n-j))
```

即 `k << n` 时约 `O(kn log n)`，完整 permutation 时可达 `O(n^2 log n)`；空间约 `O(n+k)`。这不是 PL 必然复杂度，而是当前为 canonical ordering、混合 conditional 和审计诊断选择的实现成本。性能优化不能先于概率合同等价性。

## 数值稳定性与失败模式

### 必须保留的稳定性措施

1. **logit max-shift / log-sum-exp。** 先减最大 logit 可防止 `exp` overflow。计算 propensity/log-joint 时优先 `log_softmax` 或 `logsumexp`，避免先除再取 log。
2. **joint/prefix 用 log-space。** `log W_t` 逐 slot 累加 `log pi - log q`；只有在已检查 `LOG_MIN/LOG_MAX` 后才 exponentiate。clipping 不能掩盖原始 overflow/underflow blocker。
3. **避免剩余质量相减失真。** `W_remaining = W_total - sum(selected weights)` 虽可把纯 PL propensity 降至 `O(n+k)`，但 slate 尾部会发生 catastrophic cancellation。应重算 remaining `logsumexp`，或使用经过验证的 `logdiffexp`/补偿求和；优化前后必须做尾部 prefix fixture。
4. **输入 fail-closed。** 拒绝非有限 logit、非正或非有限温度、无效 epsilon、空支持、`k>eligible_count`、概率质量误差、权重/概率下溢为零。
5. **Gumbel endpoint。** `G=-log(-log U)` 要求 `U` 严格位于 `(0,1)`；实现必须使用库中受支持的 Gumbel sampler或显式开放区间处理，并拒绝非有限扰动。等价 exponential-race key `phi_i-log(E_i)` 也只能通过成熟分布 sampler 生成严格正的 `E_i`。
6. **确定性 tie 与身份绑定。** 有限精度可能令扰动 score 相等；必须以稳定、版本化的 candidate identity 次级排序，且 propensity 始终根据未扰动分布计算。

### 失败模式

| 失败模式 | 后果 | 门禁/处置 |
|---|---|---|
| 把 slot marginal 当 conditional | joint 乘积错误，OPE 有偏 | 日志字段与合同明确 `ConditionalOnPriorSlatePrefixV1` |
| 只记录 full-slate joint | 无法审计 prefix、sequential DR 或定位坏 slot | 保留每 slot conditional；joint 作为派生量 |
| 把 unordered set probability 当 ordered propensity | estimand/样本空间错位 | 合同绑定 ordered action keys 与 served position |
| Gumbel-top-k 只保留 noisy scores/seed | 没有可验证 behavior propensity | 从冻结的未扰动权重、candidate pool、prefix 重算并出具 receipt |
| 对 `epsilon<1` 直接用固定 logit Gumbel-top-k | 改变线上策略和所有 propensity | 仅允许 `epsilon=1` 等价后端，否则 NO-GO |
| 数学正权重在 f64 下溢为零 | 假 full support、`log(0)`、无限权重 | 维持 Rust fail-closed；增加显式 floor 证据而非放宽下溢 |
| 直接连乘 joint 或 ratio | underflow/overflow | log-space 累加，越界即 blocker |
| behavior 与 target 候选池/PIT/eligibility 不同 | absolute continuity 不可证 | 绑定 candidate-pool/PIT fingerprint，逐 prefix support audit |
| floor 很小但仍“通过正数校验” | prefix weight 指数爆炸、ESS 坍塌 | 正 floor、最大 prefix weight、ESS 与 clipping sensitivity 联合门禁 |
| Gumbel 实现产生 `+/-inf` 或 tie | 分布/跨运行时重放漂移 | 官方 sampler、finite check、版本化 tie-break、跨运行时 fixture |
| 使用结构化 slate estimator 但假设不成立 | 可能有偏 | Swaminathan 等方法依赖 reward/policy 结构；本结论不以其替代通用 joint IPS |

## 仓库映射

以下事实先由 codebase-memory 图索引确认，再读取具体 symbol/source；图项目名为
`telegram-phase24-current`。

| 责任 | 当前事实 | 文件/符号 | Phase 25 含义 |
|---|---|---|---|
| 概率 canonical owner | `compute_full_distribution` 对 logits 做 max-shift、temperature、`exp`，再混合 deterministic-top 与 PL；任何空支持、非有限数、权重下溢或概率质量误差均 fail-closed | `telegram-rust-workspace/crates/telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs:28` | 保持 canonical；不要在 Gumbel 后端复制另一套概率语义 |
| 无放回 simulation owner | 每 slot 排序 remaining、重算分布、CDF 抽样、记录 selected conditional、remove selected；合同标记 `ConditionalOnPriorSlatePrefixV1`、`without_replacement=true`，输出保持 `servable=false` | `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/policy/randomized_slate/mod.rs:72` | 当前 simulation evidence 是逐 slot conditional，不是直接 joint；这正是应保留的语义，但不能据此声称已进入生产服务路径 |
| canonical owner 调用边界 | 图 inbound trace 显示共享原语同时被 private/test-only `probabilities -> simulate` 与离线 `build_decision_records -> build_target_distribution...` 使用；`simulate` 没有非测试 inbound caller | `compute_full_distribution` 与 `simulate` inbound call graph | 改原语会同时影响 behavior simulation 与 offline target distribution，需共同版本化；不能据此声称 production wiring |
| decision log 最低校验 | randomized `selectionProbability` 仅要求 finite 且在 `(0,1]` | `telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/decision_log.rs:340` | 不能把现有校验声称为 propensity floor；需另有 evidence contract |
| OPE prefix/joint | 按 decision/position 排序，累加 `log(target)-log(behavior)`；检查 log overflow/underflow，派生 prefix/weight 并计算 clipping | `telegram-clone-backend/src/services/recommendation/ope/v2/evaluate.ts:120` | 与本文推荐一致；保留 log-space 与 blocker，不要只传浮点 joint |
| 推断适用性 | 要求 absolute continuity、`behaviorPropensityFloor in (0,1]` 和正且有限的 `maximumImportanceWeight`，否则不适用 | `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/evaluate.ts:149` | Gumbel 后端不能绕过这些门禁 |
| Phase 21 evidence envelope | 真实观测 envelope 的 `maximumPrefixWeight`/`minimumBehaviorPropensity` 为 `null`，full-support/randomized-propensity flags 为 `false` | `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/v11/evidenceEnvelope/index.ts:262` | 当前没有真实证据，不能据数学推导自行宣告 production-ready |
| Phase 22 real intake | 合同显式保留上述四个 support 字段，当前 intake 固定为 false/null，并拒绝 caller 自报 attestation | `telegram-clone-backend/src/services/recommendation/ope/inference/qualification/v12/realEvidenceIntake/index.ts:56` | Phase 25 应接入可信 producer/receipt，而不是放宽 intake |

## 证据矩阵

| 来源 | 核心证据 | 假设/适用范围 | 已知限制/失败点 | 仓库映射 | 决策 |
|---|---|---|---|---|---|
| Plackett (1975) | 在 permutation 空间定义按剩余对象逐次归一化的模型，是 PL joint product 的原始统计来源 | 有限对象集合；正参数；有序 permutation | 原文不讨论现代 logging、float 数值或 OPE support 门禁 | 共享 epsilon-PL 原语、逐 slot simulator | **采用模型语义；适配为 prefix contract** |
| Kool, van Hoof, Welling (2019)，正文与补充定理 1 | ordered Gumbel-top-k 是 categorical 的 exact sample without replacement；某顺序概率等于剩余域条件概率之积 | `k<=n`；独立 Gumbel；有限 log-weight；纯 PL | 不覆盖仓库的 per-prefix deterministic/PL mixture；采样定理本身不提供 logging receipt | 可作为 `epsilon=1` 的候选采样后端 | **条件采纳；当前不替换** |
| Kool, van Hoof, Welling (2020) | JMLR 全文再次推导 joint=conditional product，并明确 PL、Gumbel-top-k 与 weighted reservoir sampling 的数学等价 | 可枚举有限域，或具有可利用因子结构的序列域；纯 PL | 平铺 Gumbel-top-k 仍需遍历全域；结构化线性复杂度不能外推到任意 scorer | 支撑分布等价与复杂度边界 | **采纳等价结论；拒绝无条件复杂度外推** |
| TensorFlow Probability `PlackettLuce` v0.23.0 | 官方实现用 `log(scores)+Gumbel` 排序采样，用 reverse cumulative sum 单独计算 log-prob | 完整 permutation、正 scores；启用验证时检查正值 | `validate_args=False` 默认可让无效输入静默失败；全排序 `O(n log n)`；不是 epsilon mixture | 数值/实现对照，不是新 canonical owner | **借鉴路径分离；拒绝默认宽松校验** |
| Swaminathan et al. (2017) | 通用 full-slate IPS 面临组合 action space 和高样本需求；结构化 estimator 的无偏性需要额外条件 | ordered slate；论文特定的 reward/policy 结构假设 | 结构假设违反时不能把实验表现当无偏保证；不能替代 support/floor 证据 | OPE qualification、最大 prefix weight/ESS 门禁 | **采用风险结论；不在本阶段采用其 estimator** |

## 来源登记

### S1. Plackett 原始论文

- **准确标题：** *The Analysis of Permutations*
- **作者：** R. L. Plackett
- **年份：** 1975
- **Venue：** *Journal of the Royal Statistical Society. Series C (Applied Statistics)*, 24(2), 193-202
- **DOI：** [10.2307/2346567](https://doi.org/10.2307/2346567)
- **官方链接：** [Oxford Academic article record](https://academic.oup.com/jrsssc/article/24/2/193/6953554)
- **阅读状态：** `abstract_or_public_description`（出版社记录和摘要可读；正文受访问限制）。本文所用明确 PMF/采样公式另由 S3 官方实现文档交叉确认。

### S2. Gumbel-top-k 原始论文与证明

- **准确标题：** *Stochastic Beams and Where To Find Them: The Gumbel-Top-k Trick for Sampling Sequences Without Replacement*
- **作者：** Wouter Kool, Herke van Hoof, Max Welling
- **年份：** 2019
- **Venue：** Proceedings of the 36th International Conference on Machine Learning, PMLR 97, 3499-3508
- **DOI：** 未分配/官方 PMLR 页面未列 DOI
- **官方链接：** [PMLR paper page](https://proceedings.mlr.press/v97/kool19a.html)，[official supplementary proof](https://proceedings.mlr.press/v97/kool19a/kool19a-supp.pdf)
- **阅读状态：** `full_text`（正文与补充证明）。补充材料定理 1 明确给出 ordered sample without replacement 及逐剩余集合乘积公式。

### S3. TensorFlow Probability 成熟官方实现

- **准确标题：** `tfp.distributions.PlackettLuce` / `plackett_luce.py`
- **作者/维护者：** TensorFlow Probability Authors
- **年份：** 2019（源文件版权年份；审阅固定 tag `v0.23.0`）
- **Venue：** TensorFlow Probability 官方 API 文档与官方 GitHub 实现
- **DOI：** 不适用
- **官方链接：** [API documentation](https://www.tensorflow.org/probability/api_docs/python/tfp/distributions/PlackettLuce)，[v0.23.0 source](https://github.com/tensorflow/probability/blob/v0.23.0/tensorflow_probability/python/distributions/plackett_luce.py)
- **阅读状态：** `full_text`（文档与实现）。审阅了 PMF、sequential sampler 描述、Gumbel 排序采样、`_log_prob`、`_sample_n` 和参数校验。

### S4. Gumbel-top-k / PL 等价的 JMLR 扩展

- **准确标题：** *Ancestral Gumbel-Top-k Sampling for Sampling Without Replacement*
- **作者：** Wouter Kool, Herke van Hoof, Max Welling
- **年份：** 2020
- **Venue：** *Journal of Machine Learning Research* 21(47), 1-36
- **DOI：** 未分配/官方 JMLR 页面未列 DOI
- **官方链接：** [JMLR paper page](https://www.jmlr.org/papers/v21/19-985.html)，[official full text](https://www.jmlr.org/papers/volume21/19-985/19-985.pdf)
- **阅读状态：** `full_text`。Eq. (8)-(12) 给出 conditional product，并明确其为 PL、Gumbel-top-k 与 weighted reservoir sampling 的共同分布；复杂度结论仅在可利用模型结构时成立。

### S5. Slate OPE 原始论文

- **准确标题：** *Off-policy evaluation for slate recommendation*
- **作者：** Adith Swaminathan, Akshay Krishnamurthy, Alekh Agarwal, Miroslav Dudík, John Langford, Damien Jose, Imed Zitouni
- **年份：** 2017
- **Venue：** Advances in Neural Information Processing Systems 30 (NIPS 2017)
- **DOI：** 未分配/官方 proceedings 页面未列 DOI
- **官方链接：** [NeurIPS proceedings](https://papers.nips.cc/paper_files/paper/2017/hash/5352696a9ca3397beb79f116f3a33991-Abstract.html)，[official paper PDF](https://papers.nips.cc/paper_files/paper/2017/file/5352696a9ca3397beb79f116f3a33991-Paper.pdf)
- **阅读状态：** `full_text`。这里只采用其对通用 full-slate IPS 组合困难与结构假设的分析，不把论文 estimator 视作当前仓库的已验证替代品。

## 最小可执行后续范围

1. 不改采样算法，先定义可信 support-evidence producer：绑定 kernel/config version、candidate/PIT fingerprint、`epsilon`、temperature、candidate count、observed/declared logit range、`minimumBehaviorPropensity` 和 `maximumPrefixWeight`。
2. 对每条 ordered slate 同时验证：逐 slot conditional 与冻结 kernel 重算一致；log-joint 等于 conditional logs 之和；无重复 action；target-positive 的每个 prefix/action 都有 behavior support。
3. 若评估纯 PL Gumbel 后端，只允许 `epsilon=1`，并在 shadow 中做 exact small-n 枚举、经验频率、逐 permutation PMF、跨运行时 tie/seed fixture、floor/prefix-weight 一致性和性能基准。
4. promotion 必须 fail-closed：任一 non-finite、underflow、质量误差、support drift、receipt binding mismatch 或 floor/weight 证据缺失，都保持 `servable=false`；rollback 回现行 sequential kernel。

上述范围不需要改变 algorithm semantics，且不会把论文结果误报为仓库线上收益。真正的 GO 需要仓库 fixture、基线、shadow evidence 和可信真实 evidence intake 共同建立。
