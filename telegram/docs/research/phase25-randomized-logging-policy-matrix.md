# Phase 25 Randomized Logging Policy Decision Matrix

更新时间：2026-08-15

## 范围与结论

Phase 25 研究以下问题：有序无放回 slate 的 randomized logging policy、
逐 prefix 与整条 slate propensity、full support、可验证随机性、资源预检，
以及 conservative/budgeted exploration 的适用边界。

在 owner 于 2026-08-13 明确接管原工作树、并将依赖闭包验证后分块提交后，
`baseline_uncommitted` 已解除。当前 decision-complete 结论是：

| 范围 | 判定 |
|---|---|
| 代码与调用图审计 | `GO` |
| 候选算法比较与日志合同研究 | `GO` |
| private epsilon-PL simulator 与 offline target-distribution development baseline | `GO` |
| Phase 25 reduced offline implementation | `GO` |
| Development candidate selection | `selected_for_future_authorization` |
| Development candidate policy | `eligible_pool_epsilon_plackett_luce_v1` |
| Verifiable development artifact | `available / private fixture only` |
| Production logging-policy selection | `NO-GO` |
| Production Decision Log activation | `UNAUTHORIZED / default-off` |
| Phase 25 randomized serving、shadow、online exploration | `NO-GO` |
| Historical real qHat / OPE | `BLOCKED` |
| Real-data finite-sample inference | `UNAVAILABLE` |
| Promotion | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |

owner-approved baseline 已在 `11aee61e` 之前形成可复现提交。随后 Rust V2 在
`0dc456e7` 固化 HKDF/ChaCha20/open53、逐 prefix 与 ordered joint/log-joint propensity、
source/config roots 及 pre-RNG resource receipt；Node V2 在 `acdcb844` 只重放密码学、
结构和资源证据，不复制 epsilon-PL 数学。`afb5139` 又将 JSON 深度、节点、集合、字符串、
重复键与 trailing-data admission 前移到 typed parse 之前，`26adadf` 对齐 Node/Rust 的
UTF-8 epoch 字节边界。固定 fixture 因而可作为 development-only verifiable artifact，
但仍不是生产 randomized logger。

因此 `eligible_pool_epsilon_plackett_luce_v1` 成为唯一
`selected_for_future_authorization` development candidate。该选择不证明 production
commitment 时序、epoch coverage、durable publish、真实 utility 或授权，也不新增没有
消费者的 `not_ready` wrapper。production randomized serving、Decision Log activation、
Phase 25 randomized shadow/online exploration、Promotion 与 Task 9 均未获授权。仓库既有
compare-only Rust shadow 和 deterministic exploration 是 pre-existing boundary，不属于
本阶段 randomized logger。

## 当前代码事实

代码事实通过 `telegram-phase25-current` codebase-memory 图、当前源码与提交历史交叉核对。

### Canonical policy path

| 责任 | 当前 owner | 已确认事实 |
|---|---|---|
| epsilon/PL 概率核 | `telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs` | `compute_full_distribution` 计算逐 prefix epsilon/PL mixture；拒绝空支持、非有限值、下溢和概率质量漂移。 |
| 无放回抽样 | `telegram-rust-recommendation/src/serving/policy/randomized_slate/mod.rs` | 每个 slot 对 remaining candidates 排序、重算分布、按 caller-provided draw 选择并删除 action。非测试 inbound caller 为零。 |
| Rust wire/hash 合同 | `telegram-recommendation-contracts/src/contracts/randomized_slate.rs` | 记录 selected conditional probability、support/digest 和 numerical diagnostics；证据固定为 simulated/non-servable。 |
| Node verifier | `telegram-clone-backend/src/services/recommendation/randomizedSlate/verify.ts` | 逐 prefix 重算 distribution、重放 draw，并核对完整 action identity、selected probability、support 与摘要；仍未获得独立 canonical RNG/commit-reveal 证据。 |
| Rust development receipt V2 | `telegram-recommendation-contracts/src/contracts/randomized_slate/v2.rs` 与 private producer | 从 revealed development seed 重放 canonical RNG 和 epsilon-PL，绑定 selected interval、prefix/support/distribution、joint/log-joint 与资源收据；固定 synthetic/non-servable。 |
| Node development verifier V2 | `randomizedSlate/v2/verifyDevelopmentFixture.ts` | 固定 raw fixture/source roots，重放 SHA/HKDF/ChaCha20/open53、joint 与资源公式；不重算 softmax、epsilon mixture 或 CDF。仅测试 caller。 |
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
V1 simulation 合同没有显式 joint/log-joint 字段，也没有独立 canonical RNG、domain
separator 或 commitment/reveal 证据；private V2 development receipt 已补齐这些字段和重放，
但其 commitment purpose 仍仅为 revealed-development-seed consistency。

### 资源事实

当前硬上限为 2,048 source candidates 与 64 slate positions。令 `e` 为过滤后的 eligible
candidate count，且 `k<=e<=2048`。只计算概率 evaluation：

```text
A(e, k) = sum_(t=0..k-1)(e - t)
        = k*e - k*(k - 1)/2
maximum A(e, k) = A(2048, 64) = 129,056
```

这个数字本身不构成完整 preflight。V1 仍只有 count caps；private V2 已冻结一次 baseline
sort 的保守比较上限、distribution/removal work、raw/canonical/hash/output/allocation/RNG
预算，并在 typed parse 前限制 JSON depth、nodes、collections、strings 和 duplicate keys。
它仍未提供 production memory/concurrency permits、fallible allocation、deadline 或 durable
publication。因此 `2048/64` 不能单独授权真实 logger，V2 receipt 也只能支撑 private
development evidence。

## 研究问题

1. epsilon-PL 是否只有在绑定 epsilon、temperature、candidate count 和 logit range 后，
   才能产生可审计的 propensity floor 与 prefix-weight bound？
2. Gumbel-top-k 能否保持当前 per-prefix epsilon mixture 的 joint distribution，还是只在
   `epsilon=1` 的纯 PL 特例等价？
3. whole-slate uniform mixture、prefix-wise uniform mixture、local swaps 和 interleaving
   分别支持什么 action space 与 estimand？
4. conservative/budgeted bandit 的安全或预算保证是否必须依赖在线 action feedback、
   baseline evidence 和明确的 activation authorization？
5. development V2 即使补齐 canonical draws、joint propensity 与资源 preflight，哪些
   commitment timing、coverage、durability 和 authorization 证据仍必须由未来真实 logger 提供？

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

缺少这些 bounds 时，prefix weight 仍可能指数爆炸。V2 已对固定 complete support fixture
生成 caller-independent canonical draws、逐 prefix 与 joint/log-joint propensity、
development commitment consistency 和完整资源收据；因此可选为 future authorization 的
唯一 development candidate。它没有证明真实配置 floor、生产 commitment 时序或 utility。

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
prefix-wise mixture 是不同 policy，不能共享同一个 epsilon 解释。它仍是未来可与
score-aware mixture 对比的 research option，但 Phase 25 没有真实 utility/support evidence
证明增加第二套 policy 的收益，因此不选择。

### 4. Local swap / interleaving

这两类方法可减少可见 perturbation，适合 pairwise 或 two-ranker comparison；它们对
大多数 ordered slates 赋零概率，不能为通用 slate OPE 提供 absolute continuity。
因此明确拒绝作为 logging policy candidate。

### 5. Conservative / budgeted bandits

CLUCB、CBwK、SEA 和 SafeOpt 的 guarantee 保护对象不同，且都依赖某种真实 online
action/outcome feedback、model assumption 或 active support expansion。当前生产随机化未授权，
deterministic logs 也不识别未选 action。不能把 synthetic regret、调用者布尔值或
simulated propensity 升级为真实安全证据。

## Historical Git Stop Condition (Resolved)

以下内容是 `20bb1f20` 时点的只读审计快照，解释当时为何停止。owner 随后明确接管并
授权提交全部相关 baseline；依赖闭包已按职责提交，re-entry 检查点 `11aee61e` 工作树干净。
`baseline_uncommitted` 不再是 active blocker，但保留原记录以维持决策可追溯性。

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

## Phase 25 Implementation Outcome

现有 randomized policy baseline 已完成所有权确认、分块提交与 focused verification，
因此 development baseline re-entry 为 `GO`。相关提交包括：

```text
561f5cc4 feat(recommendation): 固化随机策略基础合同
804e8c4d fix(recommendation): 拒绝混合概率下溢
5bcedafc feat(recommendation): 接入确定性决策日志
0c4553c3 fix(recommendation): 严格验证随机 slate 证据
63224d61 fix(recommendation): 收紧随机 slate 跨运行时验证
2af446f2 fix(recommendation): 对齐随机 draw 末项边界
4e31fb60 feat(recommendation): 固化可重放随机字节合同
0dc456e7 feat(recommendation): 固化可验证随机日志收据
acdcb844 feat(recommendation): 验证随机日志开发收据
afb5139 fix(recommendation): 前移随机日志输入资源准入
26adadf fix(recommendation): 对齐随机日志纪元字节边界
```

development-only V2 已完成下列闭包：

1. 收口 probability mass tolerance、candidate/slate caps 与 policy semantics 的唯一 owner；
2. 由 canonical Rust sampling loop 生成 development-only evidence；
3. 冻结 development seed reveal-consistency、HKDF/ChaCha20 byte stream、domain separation 和 draw mapping；
4. 记录逐 prefix support/distribution/selected interval，以及 ordered joint log propensity；
5. raw bytes、JSON shape/strings/duplicate keys 在 typed parse 前 admission；算法/输出/hash
   预算在候选分配、sort、RNG 和 policy 前 admission；
6. 以 Rust 为 probability owner，Node 只做严格 receipt/replay verification；
7. 用 immutable cross-runtime vectors 证明 selection、probability、RNG consumption 和摘要稳定；
8. 输出 `selected_for_future_authorization`，但不创建 production activation capability；
9. 保持 `simulated_propensity`、`servable=false`、`realDatasetEligible=false`，无 production caller。

下一授权阶段仍必须独立解决 pre-commit timing、anti-grinding、epoch coverage ledger、
durable create-only publication、真实 utility guard 与 explicit activation authorization。
Phase 25 不为这些未就绪状态创建无消费者 wrapper，也不得以 development artifact 通过替代
真实授权。

## Honest Phase Result

`loggingPolicySelectionStatus` 属于 Phase 25 behavior-policy 选择；现有
`selectedMethod` 属于 finite-sample inference-method 合同。前者只选出 future authorization
的 development candidate，后者继续选择 diagnostics-only abstention，两者不是同一选择面。

```text
phase25OfflineResearchStatus = completed
phase25OfflineDevelopmentStatus = go
loggingPolicySelectionStatus = selected_for_future_authorization
developmentCandidatePolicy = eligible_pool_epsilon_plackett_luce_v1
developmentEvidenceStatus = verified_private_fixture_only
verifiableLoggingArtifactStatus = development_only_available
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

Phase 25 另按下列文档级 report reasons 解释 production 分支停止决定；它们不是新铸造的
machine blocker literals：

```text
production_epoch_commitment_timing_unavailable
production_coverage_ledger_unavailable
durable_logging_publish_unavailable
real_utility_guard_unavailable
real_randomized_propensity_evidence_unavailable
real_full_support_evidence_unavailable
activation_not_authorized
```

本结果是研究决策，不是新的 capability-bearing machine object。现有生产行为、Decision
Log 默认开关、Promotion、Task 9 和历史 inference 合同均未修改。

## Verification Record

owner-approved baseline 分块提交后已记录以下 focused verification evidence：

```text
Rust recommendation tests: 391 passed
Rust recommendation-contracts baseline tests: 55 passed
Rust recommendation-contracts lib gate: 33 passed
Rust component primitives: 10 passed
Phase 25 Node focused gate: 46 passed
Rust V2 recommendation-contracts tests: 56 passed
Rust V2 randomized-slate focused tests: 17 passed
Rust cross-runtime fixture tests: 13 passed
Node V1/V2/Decision Log focused tests: 32 passed
Rust bounded-admission contracts: 59 passed
Rust bounded-admission randomized-slate: 7 passed
Node V2 UTF-8 parity: 10 passed
TypeScript npx tsc --noEmit: passed
cargo fmt --check: passed
strict Clippy gate: passed
cargo metadata --locked --no-deps: passed
git diff --check: passed
```

`Cargo.toml` 与重新生成的 `Cargo.lock` 一致。未运行 `verify_all.sh`，未修改或测试
`ml-services/**`，未 push 或创建 PR。
