# Phase 25 Randomized Logging Policy Decision Matrix

更新时间：2026-08-10

## 范围与结论

Phase 25 研究以下问题：有序无放回 slate 的 randomized logging policy、
逐 prefix 与整条 slate propensity、full support、可验证随机性、资源预检，
以及 conservative/budgeted exploration 的适用边界。

本阶段的 decision-complete 结论是：

| 范围 | 判定 |
|---|---|
| 代码与调用图审计 | `GO` |
| 候选算法比较与日志合同研究 | `GO` |
| Phase 25 工程实现 | `NO-GO / baseline_uncommitted` |
| Logging policy selection | `no_logging_policy_selected` |
| Production Decision Log activation | `UNAUTHORIZED / default-off` |
| Randomized serving、shadow traffic、production exploration | `NO-GO` |
| Historical real qHat / OPE | `BLOCKED` |
| Real-data finite-sample inference | `UNAVAILABLE` |
| Promotion | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |

这不是对 epsilon-Plackett-Luce、uniform-support mixture 或可验证随机合同的
理论否定。阻断来自当前工程基线：canonical Rust 实现与 contracts 仍有大量
未跟踪文件，而 tracked Cargo/module wiring 又混有其他用户改动。继续实现会依赖
不可复现的数学基线，或复制第二套排序、抽样和 prefix 概率 owner。

因此本阶段只提交研究证据与诚实决策，不新增 candidate、machine wrapper、
seed/root/ledger、runtime switch、route、worker、scheduler、selector 或 Promotion API。

## 当前代码事实

代码事实先通过 `telegram-phase24-current` codebase-memory 图确认，再与当前工作树和
Git 状态交叉核对。

### Canonical policy path

| 责任 | 当前 owner | 已确认事实 |
|---|---|---|
| epsilon/PL 概率核 | `telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs` | `compute_full_distribution` 计算逐 prefix epsilon/PL mixture；拒绝空支持、非有限值、下溢和概率质量漂移。 |
| 无放回抽样 | `telegram-rust-recommendation/src/serving/policy/randomized_slate/mod.rs` | 每个 slot 对 remaining candidates 排序、重算分布、按 caller-provided draw 选择并删除 action。非测试 inbound caller 为零。 |
| Rust wire/hash 合同 | `telegram-recommendation-contracts/src/contracts/randomized_slate.rs` | 记录 selected conditional probability、support/digest 和 numerical diagnostics；证据固定为 simulated/non-servable。 |
| Node verifier | `telegram-clone-backend/src/services/recommendation/randomizedSlate/verify.ts` | 检查 schema、摘要、support、epsilon-mixture 关系和 diagnostics，但不重放 Rust PL 权重、CDF 或 draw selection。 |
| Runtime Decision Log | `telegram-clone-backend/src/services/recommendation/decisionLog/write.ts` | 由 feed path 调用，但只有环境变量严格等于 `true` 才开启；当前只生成 deterministic behavior，propensity 为 not evaluable。 |
| Synthetic trajectory consumer | `offlinePrediction/streamingV2/trajectory` | 消费 Node randomized-slate verifier；图中无生产 inbound caller。 |

当前 runtime 事实不能被混写：Decision Log 确有 route/`SpaceService` caller，但它默认
关闭且只记录 deterministic behavior；randomized-slate simulator、Target/PIT、Prediction、
OPE 与 Promotion 路径仍停留在 tests/synthetic/offline 边界。

### 当前策略数学

对 prefix `h` 的 remaining set `R(h)`，当前核定义：

```text
q(i | h) = (1 - epsilon) * I(i = deterministic_top(h))
           + epsilon * PL(i | R(h), temperature)
```

有序 slate `a_1:k` 的正确 behavior propensity 是：

```text
P(a_1:k) = product_(t=1..k) q(a_t | a_<t)
log P(a_1:k) = sum_(t=1..k) log q(a_t | a_<t)
```

逐 slot conditional probability、未条件化的 position marginal、任意位置 inclusion
probability 和 ordered joint probability 是四种不同对象，不能共用一个含糊字段。
当前合同没有显式 joint/log-joint 字段，也没有 RNG seed、algorithm、domain separator
或 commitment/reveal 证据。

### 资源事实

当前硬上限为 2,048 source candidates 与 64 slate positions。令 `e` 为过滤后的 eligible
candidate count，且 `k<=e<=2048`。只计算概率 evaluation：

```text
A(e, k) = sum_(t=0..k-1)(e - t)
        = k*e - k*(k - 1)/2
maximum A(e, k) = A(2048, 64) = 129,056
```

这个数字不构成完整 preflight。每个 slot 还运行 `sort_unstable`，比较次数没有冻结为
合同；raw/decoded bytes、JSON depth、canonical bytes、hash bytes、PRNG retries、
output records/bytes、allocation、concurrency 与 deadline 也没有统一 admission receipt。
因此现有 `2048/64` count cap 不能证明请求在首次解析、大分配或随机调用前可达。

## 研究问题

1. epsilon-PL 是否只有在绑定 epsilon、temperature、candidate count 和 logit range 后，
   才能产生可审计的 propensity floor 与 prefix-weight bound？
2. Gumbel-top-k 能否保持当前 per-prefix epsilon mixture 的 joint distribution，还是只在
   `epsilon=1` 的纯 PL 特例等价？
3. whole-slate uniform mixture、prefix-wise uniform mixture、local swaps 和 interleaving
   分别支持什么 action space 与 estimand？
4. conservative/budgeted bandit 的安全或预算保证是否必须依赖在线 action feedback、
   baseline evidence 和明确的 activation authorization？
5. caller-provided draws、部分 Node verification、缺失 joint propensity/resource preflight，
   加上 `baseline_uncommitted`，是否使所有当前 candidate 都工程不可达？

## Evidence Matrix

详细逐来源笔记见：

- [PL / Gumbel-top-k](phase25/plackett-luce-gumbel.md)
- [Uniform support / swap / interleaving](phase25/uniform-swap-interleaving.md)
- [Conservative bandit / safe exploration](phase25/conservative-bandit.md)
- [Verifiable logging contract](phase25/verifiable-logging-contract.md)

| 来源 | 阅读状态与前提 | 失败模式与仓库映射 | 决策 |
|---|---|---|---|
| R. L. Plackett, *The Analysis of Permutations*, 1975, *Journal of the Royal Statistical Society. Series C (Applied Statistics)* 24(2), DOI [10.2307/2346567](https://doi.org/10.2307/2346567) | `abstract_or_public_description`；正权重、有限对象、有序 permutation。 | 原始模型不提供现代 logging receipt、float 边界或 production support 证明。 | 采用 successive conditional/joint-product 语义。 |
| Wouter Kool, Herke van Hoof, Max Welling, *Stochastic Beams and Where To Find Them: The Gumbel-Top-k Trick for Sampling Sequences Without Replacement*, 2019, ICML/PMLR 97, [官方全文](https://proceedings.mlr.press/v97/kool19a.html)，无正式 DOI | `full_text`；独立 Gumbel、有限 log-weight、纯 PL、`k<=n`。 | 一次性 Gumbel-top-k 不等价于当前 `0<epsilon<1` 的 per-prefix deterministic/PL mixture；采样结果也不自动形成 propensity receipt。 | 仅保留为 `epsilon=1` 的未来实现候选，不替换当前核。 |
| Lihong Li, Wei Chu, John Langford, Xuanhui Wang, *Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms*, 2011, WSDM, DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878) | `full_text`；随机 logging、已知概率、i.i.d. event、bounded reward；主分析为 single action。 | deterministic logger 对未选 action 没有 support；单 action replay 不能直接外推到 no-repeat slate。 | 采用 support litmus test，不把它当随机化授权。 |
| Adith Swaminathan, Akshay Krishnamurthy, Alekh Agarwal, Miroslav Dudík, John Langford, Damien Jose, Imed Zitouni, *Off-policy Evaluation for Slate Recommendation*, 2017, NeurIPS 30, [官方全文](https://proceedings.neurips.cc/paper_files/paper/2017/file/5352696a9ca3397beb79f116f3a33991-Paper.pdf)，无正式 DOI | `full_text`；ordered slate、logging-policy probability、absolute continuity；低方差结构化 estimator 另需 reward structure。 | full-slate IPS 可有组合方差；不能把 position marginal 或未经证明的 additive reward 当通用 joint evidence。 | 采用 joint propensity/support 要求；不采用新 estimator。 |
| Filip Radlinski, Thorsten Joachims, *Minimally Invasive Randomization for Collecting Unbiased Preferences from Clickthrough Logs*, 2006, AAAI, [官方全文](https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/AAAI06FairPairs.pdf) | `full_text`；相邻 pair randomization 和 click preference 假设。 | 只覆盖局部 permutation，不能识别任意 target slate value。 | 仅保留 pairwise diagnostic；拒绝作为 OPE logger。 |
| Katja Hofmann, Shimon Whiteson, Maarten de Rijke, *A Probabilistic Method for Inferring Preferences from Clicks*, 2011, CIKM, DOI [10.1145/2063576.2063618](https://doi.org/10.1145/2063576.2063618) | `full_text`；两 ranker、interleaving distribution、click attribution。 | estimand 是 ranker preference，不是任意 policy value；support 受两条输入 ranking 限制。 | 仅保留 ranker-comparison diagnostic。 |
| Filip Radlinski, Nick Craswell, *Optimized Interleaving for Online Retrieval Evaluation*, 2013, WSDM, DOI [10.1145/2433396.2433429](https://doi.org/10.1145/2433396.2433429) | `full_text`；固定 rankers、feasible interleaving set、credit/fidelity constraints。 | 不提供 full ordered-slate support，且本阶段没有 online comparison 授权。 | 拒绝作为 logging candidate。 |
| Abbas Kazerouni, Mohammad Ghavamzadeh, Yasin Abbasi-Yadkori, Benjamin Van Roy, *Conservative Contextual Linear Bandits*, 2017, NeurIPS 30, [官方全文](https://proceedings.neurips.cc/paper_files/paper/2017/file/bdc4626aa1d1df8e14d80d345b2a442d-Paper.pdf)，无正式 proceedings DOI | `full_text`；linear realizability、bounded feature/parameter/reward、sub-Gaussian noise、baseline action、连续在线反馈；主算法假设已知 expected baseline reward，Section 4 扩展到未知情形。 | 保证是 cumulative expected reward，不是 request-level safety；deterministic logs 无法识别 baseline feature subspace 外的 reward。 | 只保留 synthetic comparator；production `NO-GO`。 |
| Rolf Jagerman, Ilya Markov, Maarten de Rijke, *Safe Exploration for Optimizing Contextual Bandits*, 2020, *ACM TOIS* 38(3), DOI [10.1145/3385670](https://doi.org/10.1145/3385670) | `full_text`；stochastic actions、exact propensity/overlap、online feedback、反复训练/OPE 与 guarded deployment。 | SEA 最终需要真实 deployment 扩展 support；当前权限与数据均不满足。 | 拒绝当前采用。 |
| Hugo Krawczyk, Pasi Eronen, *HMAC-based Extract-and-Expand Key Derivation Function (HKDF)*, 2010, IETF RFC 5869, DOI [10.17487/RFC5869](https://doi.org/10.17487/RFC5869) | `full_text`；HKDF extract/expand、固定 salt 与 length-framed context。 | HKDF 不证明 seed 预先存在、decision context 唯一或 coverage 完整。 | 未来 V1 采用 HKDF-SHA-256 domain separation。 |
| Yoav Nir, Adam Langley, *ChaCha20 and Poly1305 for IETF Protocols*, 2018, IETF RFC 8439, DOI [10.17487/RFC8439](https://doi.org/10.17487/RFC8439) | `full_text`；固定 key/nonce/counter/byte order 与 normative vectors。 | 重用 key/nonce 会重复 stream；库 RNG wrapper 不一定等同 RFC byte contract。 | 未来 V1 采用固定 RFC 8439 byte stream。 |
| Sharon Goldberg, Leonid Reyzin, Dimitrios Papadopoulos, Jan Vcelak, *Verifiable Random Functions (VRFs)*, 2023, IRTF RFC 9381, DOI [10.17487/RFC9381](https://doi.org/10.17487/RFC9381) | `full_text`；unique pseudorandom output 与 public proof。 | VRF 不证明 policy math、support、coverage completeness 或资源可达，且扩大 key/cross-runtime surface。 | V1 延后，仅在需要即时公开验证时重审。 |
| Diagnostics-only abstention | 不声称 causal identification、coverage 或 production safety。 | 不能估计 unsupported counterfactual，但不会制造证据。 | 当前唯一有效 active state。 |

## Candidate Comparison

### 1. Current epsilon-Plackett-Luce

数学语义清楚，且在 `epsilon>0`、所有 eligible PL weight 为正时具有 full support。
但“观测路径上的概率为正”不等于全配置 propensity floor。可执行 floor 至少还要绑定：

```text
epsilon_min
temperature_min
maximumLogitRange
maximumCandidateCount
eligible-support identity/version
```

缺少这些证据时，prefix weight 仍可能指数爆炸。当前实现还缺 joint propensity、
canonical RNG、complete replay 和完整资源 preflight，因此只保留 diagnostic baseline。

### 2. Gumbel-top-k

纯 PL 下，一次 `log(weight)+Gumbel` 的 ordered top-k 与 successive sampling 同分布。
当前策略却在每个 prefix 混合 deterministic top 与 PL categorical：

- `epsilon=1`：可作为纯 PL 的等价 sampling backend；
- `0<epsilon<1`：一次固定-logit Gumbel-top-k 会改变 policy distribution；
- 任意 epsilon：noisy scores、seed 或 final ranking 都不能代替逐 prefix propensity。

因此不选择为当前 candidate。

### 3. Uniform-support mixture

对 `N` 个 eligible items 与长度 `K` 的 ordered no-repeat slate，记
`(N)_K=N!/(N-K)!`：

```text
whole-slate uniform mixture minimum joint probability = epsilon / (N)_K
prefix-wise uniform mixture minimum joint probability = epsilon^K / (N)_K
```

uniform component 的 floor 更透明，但仍随 slate 长度组合或指数恶化。whole-slate 与
prefix-wise mixture 是不同 policy，不能共享同一个 epsilon 解释。它是未来最值得与
score-aware mixture 对比的 candidate，但当前不能跨过 Git baseline 与 runtime 授权门禁。

### 4. Local swap / interleaving

这两类方法可减少可见 perturbation，适合 pairwise 或 two-ranker comparison；它们对
大多数 ordered slates 赋零概率，不能为通用 slate OPE 提供 absolute continuity。
因此明确拒绝作为 logging policy candidate。

### 5. Conservative / budgeted bandits

CLUCB、CBwK、SEA 和 SafeOpt 的 guarantee 保护对象不同，且都依赖某种真实 online
action/outcome feedback、model assumption 或 active support expansion。当前生产随机化未授权，
deterministic logs 也不识别未选 action。不能把 synthetic regret、调用者布尔值或
simulated propensity 升级为真实安全证据。

## Git Stop Condition

独立 Git 审计确认以下核心实现不是可复现的 committed baseline：

- `telegram-randomized-policy-primitives/**`；
- randomized-slate 与 decision-log Rust contracts；
- private Rust randomized-slate simulator；
- offline target-distribution crate/implementation；
- 部分 Node/Rust tests、fixtures 与 Decision Log writer。

与此同时 workspace manifests、contracts wiring 和 policy module wiring 已有 tracked 修改，
其中还包含 Tokio、graph batch、fingerprint 等无关用户工作。只提交 tracked wiring 会产生
缺模块基线；整文件提交又会误带用户改动。

这个 `baseline_uncommitted` 是目标流程中的显式停止条件。当前没有安全的隔离实现面：

- Node-only logger 只能格式化 caller-supplied JSON，无法证明来自 canonical sampler；
- 独立 Rust binary 无法调用 private `simulate`，复制排序/抽样/prefix math 会产生第二 owner；
- 修改 canonical `simulate` 或 contracts 会直接叠加在未跟踪用户基线上。

因此本阶段不创建 vacuous `not_ready` wrapper，也不提交或接管上述文件。

## Future Re-entry Gate

只有现有 randomized policy baseline 经独立所有权确认并形成可复现提交后，Phase 25
implementation 才可重新评估为 `CONDITIONAL GO`。届时最小范围是：

1. 收口 probability mass tolerance、candidate/slate caps 与 policy semantics 的唯一 owner；
2. 在 canonical Rust sampling loop 内接入 development-only evidence sink；
3. 冻结 seed commitment/reveal、HKDF/ChaCha20 byte stream、domain separation 和 draw mapping；
4. 记录逐 prefix support/distribution/selected interval，以及 ordered joint log propensity；
5. 在首次 full parse、allocation、sort、hash 或 RNG 前完成精确 resource admission；
6. 以 Rust 为 probability owner，Node 只做严格 receipt/replay verification；
7. 用 immutable cross-runtime vectors 证明 selection、probability、RNG consumption 和摘要稳定；
8. 保持 `simulated_propensity`、`servable=false`、`realDatasetEligible=false`，无 production caller。

未来一个阶段最多选择一个 private candidate；在这些 gate 完成前，不预选 epsilon-PL、
uniform-support 或任何 conservative bandit。

## Honest Phase Result

`loggingPolicySelectionStatus` 属于 Phase 25 behavior-policy 选择；现有
`selectedMethod` 属于 finite-sample inference-method 合同。前者没有选出 policy，后者继续
选择 diagnostics-only abstention，两者不是同一选择面。

```text
phase25OfflineResearchStatus = completed
phase25EngineeringStatus = not_run_baseline_uncommitted
loggingPolicySelectionStatus = no_logging_policy_selected
developmentEvidenceStatus = not_run
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
realDatasetEligible = false
runtimeActivationStatus = activation_not_authorized
```

两个既有 inference blockers 保持：

```text
finite_sample_inference_unavailable
multiplicity_control_unavailable
```

Phase 25 另按下列文档级 report reasons 解释停止决定；它们不是新铸造的 machine
blocker literals：

```text
baseline_uncommitted
no_logging_policy_selected
real_randomized_propensity_evidence_unavailable
real_full_support_evidence_unavailable
activation_not_authorized
```

本结果是研究决策，不是新的 capability-bearing machine object。现有生产行为、Decision
Log 默认开关、Promotion、Task 9 和历史 inference 合同均未修改。

## Verification Record

以下 focused diagnostics 已在当前工作树运行，用于检查被审计草稿的局部行为；它们不证明
Git ownership，也不能解除 `baseline_uncommitted`：

```text
cargo test -p telegram-randomized-policy-primitives
3 passed

cargo test -p telegram-recommendation-contracts --test randomized_slate_contract
16 passed

cargo test -p telegram-rust-recommendation randomized_slate
11 passed; 378 filtered out

vitest: decisionLogContract + randomizedSlateSimulationContract + decisionLogWrite
3 files; 26 tests passed
```

研究文档另经代码围栏配对、trailing-whitespace、`git diff --check` 与 staged path 审计。
未运行 `verify_all.sh`，未修改或测试 `ml-services/**`。
