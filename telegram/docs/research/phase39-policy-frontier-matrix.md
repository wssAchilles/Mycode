# Phase 39：Epsilon-PL Utility / Support Frontier

## 代码断点

- Rust `telegram-randomized-policy-primitives::compute_full_distribution` 是
  epsilon-Plackett-Luce 条件分布的唯一数学实现。
- `telegram-rust-recommendation::serving::policy::randomized_slate` 已有 bounded
  V1/V2 synthetic simulator，输出 ordered actions、逐 slot conditional
  propensity、support 和 numerical diagnostics；没有非测试 runtime caller。
- 当前没有真实 randomized log、PIT snapshot、viewer/time provenance 或可用于
  OPE 的 reward source。本阶段只做 deterministic synthetic frontier，不把结果
  解释为真实 utility、coverage、qualification 或 production evidence。

## 研究问题

1. 在固定 score vector 和 slate size 下，epsilon 与 temperature 如何同时改变
   expected slate utility、最小 conditional propensity 和最大 inverse joint
   weight？
2. epsilon-PL 与 Gumbel-top-k、uniform-support mixture 的无放回语义和支持条件
   有何差异，是否值得在仓库增加第二个 policy candidate？
3. 如何在没有真实 reward 的情况下定义可证伪、可复现的 synthetic diagnostic
   指标，而不把它升级为 OPE 或 qualification gate？
4. exact enumeration 的 candidate count、prefix count、probability evaluations
   和 memory upper bound 如何在首次 kernel 调用前计算？

## Evidence matrix

| 来源 | 前提与核心结果 | 复杂度 / 失败模式 | 仓库映射与决定 |
|---|---|---|---|
| Wouter Kool, Herke van Hoof, Max Welling, 2019, *Stochastic Beams and Where To Find Them: The Gumbel-Top-k Trick for Sampling Sequences Without Replacement*, ICML 36, PMLR 97:3499-3508, [官方全文](https://proceedings.mlr.press/v97/kool19a.html), `full_text` | Gumbel-Max 可扩展到无放回 top-k；需要可重放随机数和 factorized sequence distribution。论文讨论采样和序列搜索，不提供本仓库的 source/PIT/propensity receipt。 | 需要额外 Gumbel transcript、浮点 tie/排序合同；若与现有 epsilon-PL 并列会产生第二个 policy owner。 | 作为竞争 baseline 研究；拒绝实现第二候选，保留 Rust epsilon-PL 唯一 owner。 |
| Adith Swaminathan, Thorsten Joachims, 2015, *Counterfactual Risk Minimization: Learning from Logged Bandit Feedback*, ICML 32, PMLR 37:814-823, [官方全文](https://proceedings.mlr.press/v37/swaminathan15.html), `full_text` | Propensity scoring 的方差和 overlap 会直接影响 counterfactual risk；需要真实 logged bandit feedback、正确 propensity 和 reward 语义。 | 极小 propensity 会导致高方差；不能从 synthetic score 或 deterministic log 推出真实 risk。 | 采用“记录 frontier 的 inverse-joint-weight 风险诊断”这一指标动机；拒绝将其当 OPE/qualification。 |
| Branislav Kveton, Zheng Wen, Azin Ashkan, Csaba Szepesvari, 2015, *Tight Regret Bounds for Stochastic Combinatorial Semi-Bandits*, AISTATS 18, PMLR 38:535-543, [官方全文](https://proceedings.mlr.press/v38/kveton15.html), `full_text` | 组合 semi-bandit 假设在线重复决策和选中 item 的反馈，分析 regret 与 gap、动作数和 horizon。 | 不适用于当前离线 synthetic 单次 slate；需要 online feedback，不能证明本仓库 finite-sample inference。 | 拒绝实现 UCB/bandit learner；仅采用 score-gap 作为 frontier scenario 维度。 |
| Diagnostics-only abstention, repository contract `diagnostics_only_abstention_v1`, current code, `full_text` | 不声明 estimator 适用性、真实 utility 或 coverage；所有 synthetic output 保持 `servable=false`、`realDatasetEligible=false`。 | 没有 policy quality claim；只报告可重放的 deterministic metrics。 | 作为唯一结果边界和 baseline，保留。 |

## 采用的最小方案

实现一个 private offline exact-enumeration diagnostic，仅调用
`compute_full_distribution`，不复制 epsilon-PL 数学。固定小型 score scenarios、
epsilon/temperature grid 和 slate size；枚举所有 ordered prefixes，计算：

- expected per-slot / total score utility（只称 synthetic score utility）；
- minimum conditional propensity；
- minimum ordered-joint propensity；
- maximum inverse ordered-joint propensity；
- exact probability-mass error；
- frontier membership（utility 越高且 inverse-joint risk 越低者保留）。

不设置产品阈值，不生成 candidate selection、qualification、real evidence 或
production status。配置总数、排列数、prefix evaluations、canonical output bytes
和 estimated work units 在第一次 probability-kernel 调用前检查；超限稳定返回
`resource_limit_exceeded`。

## 拒绝范围

- 不实现 Gumbel-top-k、uniform mixture、UCB、CRM learner 或新的 public estimator。
- 不增加 bootstrap、真实 reward、PIT、viewer provenance、qualification seed、
  ledger、route、worker 或 runtime caller。
- frontier 结果不能解除 `finite_sample_inference_unavailable`、
  `multiplicity_control_unavailable` 或 `candidateQualificationStatus=not_run`。

## 决定

`CONDITIONAL GO`：exact frontier 诊断是 bounded、可证伪、复用 canonical Rust
kernel 的安全离线工作；只有 frontier 指标和资源合同完成后才可宣称本阶段
offline development 完成。它不改变 randomized logging 的未来授权状态。
