# Phase 25 Conservative Bandit and Safe Exploration Research

## Scope and verdict

Phase 25 asks whether conservative or budgeted contextual bandits, safe
exploration, or a no-randomization baseline fit a stage that has only
offline/synthetic evidence and explicitly forbids production exploration.

The split verdict is:

- **GO** for offline/synthetic algorithm simulation, invariant testing,
  contract design, and comparison against the deterministic baseline;
- **GO** for retaining the deterministic no-randomization policy as the only
  production behavior;
- **NO-GO** for deploying CLUCB, contextual bandits with knapsacks (CBwK), SEA,
  or any other live exploration policy;
- **NO-GO** for claiming real-world safety, uplift, regret, resource-feasibility,
  or off-policy identifiability from the current synthetic evidence;
- **NO-GO** for treating simulated propensity as logged behavior propensity.

This is not a rejection of conservative bandit research. It is a boundary
decision: every examined method obtains information by taking actions online
and observing their outcomes. The current phase forbids that intervention and
has no evaluable production propensity/support evidence. Synthetic runs can
test code and numerical invariants, but cannot satisfy those missing premises.

## Code-derived facts

Codebase-memory was used before external research to identify the canonical
owners, defaults, call paths, data contracts, fallback behavior, and production
boundary.

### Existing exploration scorer is deterministic, not an online bandit

- Rust `bandit_exploration_plan` is owned by
  `telegram-rust-recommendation/src/pipeline/local/scorers/exploration.rs`.
  It is called by `bandit_exploration_scorer` and
  `run_fused_interest_exploration_group`.
- The scorer flag defaults to enabled. Its default `epsilon` is `0.08`, capped
  at `0.35`; its uncertainty weight defaults to `0.3`, capped at `0.7`; and its
  risk ceiling defaults to `0.58`.
- `apply_bandit_exploration` derives successes and failures from aggregate item
  counters and score fields. `thompson_sample` is a Beta mean/variance
  approximation driven by stable request/post jitter. It applies a bounded
  score multiplier and records breakdown diagnostics.
- This path does not update an online posterior from the reward caused by the
  chosen action, does not sample from a logged stochastic behavior policy, and
  does not emit a selection probability. It is therefore a deterministic
  exploration-flavored reranking heuristic, not CLUCB, CBwK, or SEA.

### Decision Log and support contract

- `isRecommendationDecisionLogV1Enabled` is default-off and is enabled only
  when `RECOMMENDATION_DECISION_LOG_V1_ENABLED === 'true'`.
- `buildRecommendationDecisionLogV1` always emits
  `behaviorPolicyKind: 'deterministic_top_k'`. Each served action emits
  `behaviorPropensity.status: 'not_evaluable_deterministic'` with reason
  `deterministic_top_k_no_logged_probability`.
- The Rust `PropensityEvidence` contract distinguishes
  `LoggedRandomized { selection_probability }`,
  `NotEvaluableDeterministic`, and `UnknownSupport`. Logged probability must be
  finite and in `(0, 1]`.
- The offline target-distribution builder fails closed on incomplete support,
  a truncated candidate pool, count or digest mismatch, duplicate identities,
  missing eligible logits, or an invalid slate prefix. These checks preserve
  evidence integrity; they do not create counterfactual support.

### Randomized slate is explicitly non-servable simulation

- `serving/policy/randomized_slate::simulate` mixes a deterministic baseline
  order with Plackett-Luce probabilities, samples without replacement from
  supplied uniform draws, and records conditional probabilities and numerical
  diagnostics.
- It accepts only a complete, untruncated, digest-valid candidate pool sourced
  from deterministic behavior. Source behavior already marked randomized is a
  blocker.
- Its output is `evidence_kind: simulated_propensity` and `servable: false`.
  The code has test/synthetic callers; it is not a production behavior-policy
  authorization surface.

### Evaluation and promotion boundary

- Frozen multiway DGP and score surfaces are synthetic. Current real full
  support, real qHat, and real score-surface evidence remain unavailable.
- Promotion readiness remains fail-closed through blockers including missing
  confidence evidence or unavailable multiplicity control, and Task 9 remains
  unauthorized. Rollback evidence and independent approval are separately
  required and digest-bound.
- Therefore the repository has useful offline contracts and synthetic policy
  machinery, but no authorized production exploration loop, no real randomized
  behavior log, and no evidence that would justify a live safety claim.

## Research questions

1. What does each candidate actually constrain: cumulative baseline-relative
   reward, instantaneous safety, a consumable resource budget, or policy-level
   expected reward?
2. Which online observations, baseline facts, model assumptions, and support
   conditions are necessary for its guarantee?
3. Can deterministic production logs or simulated propensities identify a
   different policy when production randomization is prohibited?
4. What computation and operational state would the repository need, and how
   can the method fail despite its theorem?
5. What is the smallest Phase 25 scope that advances design without weakening
   the existing production, promotion, and fail-closed boundaries?

## Evidence matrix

| Source and reading status | Safety/resource definition and required evidence | Propensity/support and compute | Repository decision |
|---|---|---|---|
| Abbas Kazerouni, Mohammad Ghavamzadeh, Yasin Abbasi-Yadkori, Benjamin Van Roy, **“Conservative Contextual Linear Bandits”**, 2017, *Advances in Neural Information Processing Systems 30*, [official proceedings](https://proceedings.neurips.cc/paper_files/paper/2017/hash/bdc4626aa1d1df8e14d80d345b2a442d-Abstract.html), [arXiv DOI 10.48550/arXiv.1611.06426](https://doi.org/10.48550/arXiv.1611.06426), `full_text` | CLUCB keeps cumulative expected reward above a fixed fraction of cumulative baseline reward uniformly over time, with high probability. It assumes contextual linear realizability, bounded features/parameters/reward, conditionally sub-Gaussian noise, a baseline action, and sequential chosen-action rewards. The main algorithm assumes known expected baseline rewards; Section 4 extends the treatment to unknown baseline reward. | CLUCB does not need propensity for its own online update, but obtains feature support by actively choosing actions. It maintains ridge/confidence matrices and performs optimistic plus worst-case action/confidence optimization each round. | **NO-GO live.** Offline simulation may test the budget inequality and fallback-to-baseline logic, but deterministic logs do not identify reward parameters outside the baseline feature subspace. |
| Shipra Agrawal, Nikhil R. Devanur, Lihong Li, **“An efficient algorithm for contextual bandits with knapsacks, and an extension to concave objectives”**, 2016, *29th Annual Conference on Learning Theory*, PMLR 49:4-18, [official proceedings](https://proceedings.mlr.press/v49/agrawal16.html), `full_text` | CBwK constrains cumulative consumption of one or more finite resources over a horizon. It requires online contexts and chosen-action reward/consumption feedback, fixed budgets, and a policy-class optimization oracle. A resource budget is not a guarantee against user harm or reward degradation. | The algorithm deliberately explores and repeatedly invokes an optimization oracle; its runtime is efficient in policy-space size under that oracle model, but still adds online state, confidence calculations, and resource accounting. It does not solve deterministic-log support. | **NO-GO live.** The repository has no authorized exploration budget or versioned online consumption-feedback contract. Use only as a synthetic comparator if a concrete resource is defined; do not relabel a quality-risk ceiling as a knapsack budget. |
| Rolf Jagerman, Ilya Markov, Maarten de Rijke, **“Safe Exploration for Optimizing Contextual Bandits”**, 2020, *ACM Transactions on Information Systems* 38(3), Article 24, DOI [10.1145/3385670](https://doi.org/10.1145/3385670), [author manuscript](https://www.jagerman.nl/pdf/jagerman-2020-safe-exploration.pdf), `full_text` | SEA starts with a deployed baseline, trains a candidate counterfactually, and switches only when the candidate lower confidence bound clears the deployed policy upper confidence bound. Its safety is policy-level expected reward under its confidence assumptions, not per-action or realized per-user safety. It requires an active sequence of deployments, contexts, immediate rewards, stochastic actions, and repeated learning/evaluation. | Logs contain `(context, action, reward, propensity)`; IPS learning and OPE divide by propensity and require overlap. Naive repeated evaluation over all history is quadratic in rounds; sufficient-statistic aggregation helps only in suitable discrete spaces, and each round still needs training and confidence computations. | **NO-GO live.** A fixed deterministic baseline has no evidence for unseen actions, so a genuinely different policy cannot clear the gate without unsupported modeling assumptions. SEA also eventually deploys a changed policy to expand support, which this phase forbids. |
| Lihong Li, Wei Chu, John Langford, Xuanhui Wang, **“Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms”**, 2011, *Proceedings of the Fourth ACM International Conference on Web Search and Data Mining (WSDM)*:297-306, DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878), [official author-hosted paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/Published-3.pdf), `full_text` | Replay evaluation is unbiased under randomized logging and its stationarity/data assumptions. It accepts an event only when the evaluated policy chooses the action that the randomized logger selected. This protects users during offline evaluation but presupposes that exploration already occurred in data collection. | Uniform random logging supplies known nonzero action probabilities/support. A fixed deterministic logger accepts only policies matching its action on each context; alternatives receive no counterfactual reward and effective sample size collapses. Compute is a streaming replay, but data efficiency falls with action-space size/mismatch. | **Adopt as the support litmus test, not as permission to randomize.** Current production records fail its randomized-logging premise. Simulated probabilities cannot replace factual exposure probabilities. |
| Alex Strehl, John Langford, Lihong Li, Sham M. Kakade, **“Learning from Logged Implicit Exploration Data”**, 2010, *Advances in Neural Information Processing Systems 23*, [official proceedings](https://proceedings.neurips.cc/paper/2010/hash/c0f168ce8900fa56e57789e2a2f2c9d0-Abstract.html), [arXiv DOI 10.48550/arXiv.1003.0120](https://doi.org/10.48550/arXiv.1003.0120), `full_text` | A sequence of possibly deterministic policies can collectively imply exploration if policy variation supplies action support. The theorem assumes stationary i.i.d. contexts/rewards, an estimable average logging policy, a finite policy class in its stated result, and a support threshold. Unsupported policies are intentionally underestimated. | “No randomized logger” does not mean “no support needed.” One fixed deterministic policy still gives zero support to alternatives. Propensity estimation and clipped/thresholded importance weighting trade bias/conservatism against variance; learning/evaluation cost grows with policy/action complexity. | **Conditional future comparator only.** It is relevant if immutable historical policy variation and estimated support are proven. The current fixed deterministic behavior does not meet that condition. |
| Yu-Xiang Wang, Alekh Agarwal, Miroslav Dudík, **“Optimal and Adaptive Off-policy Evaluation in Contextual Bandits”**, 2017, *Proceedings of the 34th International Conference on Machine Learning*, PMLR 70:3589-3597, [official proceedings](https://proceedings.mlr.press/v70/wang17a.html), `full_text` | OPE requires target-policy absolute continuity with respect to the logging policy. IPS is unbiased but can have high variance; direct modeling can be biased; doubly robust estimators can still have high variance; SWITCH trades large-weight variance for reward-model bias. | Importance ratios must be finite. Deterministic logging makes the ratio undefined for every target action outside baseline support. No estimator recovers an unidentified counterfactual merely by adding a model or clipping weights. | **Adopt the fail-closed support rule.** OPE must abstain outside observed support; synthetic qHat or a simulated target distribution cannot authorize promotion. |
| Yanan Sui, Alkis Gotovos, Joel W. Burdick, Andreas Krause, **“Safe Exploration for Optimization with Gaussian Processes”**, 2015, *Proceedings of the 32nd International Conference on Machine Learning*, PMLR 37:997-1005, [official proceedings](https://proceedings.mlr.press/v37/sui15.html), `full_text` | SafeOpt samples only points whose lower confidence bound exceeds a safety threshold and expands a reachable safe set under Gaussian-process/RKHS regularity and calibrated confidence assumptions. It requires noisy online observations at sampled points and an initial known-safe seed set. | Kernel/GP inference and confidence-bound optimization grow with observations and candidate points; sparse approximations change the evidence contract. Safety can fail under kernel misspecification, poor confidence calibration, nonstationarity, or an invalid safe seed. | **Reject for Phase 25.** It is a useful competing notion of pointwise threshold safety, but the repository has neither a validated GP safety model nor authorization to sample new points. It solves a different problem from baseline-relative ranking quality. |

No source permits synthetic propensity, deterministic score jitter, or an
offline reward model to substitute for factual online exposure and feedback.
Where a paper gives a high-probability guarantee, that guarantee is conditional
on its stated model, noise, support, confidence, and sequential-observation
assumptions; it is not a generic “safe in production” label.

## Direct comparison

| Approach | What is protected | How it learns | Current support | Main cost | Phase 25 state |
|---|---|---|---|---|---|
| CLUCB | Cumulative expected reward relative to baseline | Executes optimistic actions when a confidence-set budget clears; otherwise baseline | Requires online feature excitation, not logged propensity | Per-round confidence matrices and optimistic/pessimistic optimization | Synthetic design `GO`; production `NO-GO` |
| CBwK | Aggregate consumable resource budget | Executes policies and observes reward plus resource consumption | Requires online action/reward/consumption feedback | Repeated policy-oracle calls and resource state | Synthetic comparator only; production `NO-GO` |
| SEA | Expected reward of each deployed policy relative to incumbent | Counterfactual training/OPE, then guarded deployments that gather new support | Requires exact propensities and overlap | Repeated training and high-confidence OPE; naive history scan is quadratic | Production `NO-GO` |
| SafeOpt | Per-sample threshold under a GP model | Samples within and expands an estimated safe set | Requires initial safe seed and online noisy safety observations | GP/kernel updates and acquisition optimization | Rejected for current ranking contract |
| Deterministic no-randomization baseline | Operational behavior stability; no exploration exposure | Does not learn counterfactual action effects | Only its chosen action is supported unless historical policy variation proves more | Existing scoring cost; no exploration control plane | Production `GO`; improvement claims outside support `NO-GO` |

The deterministic baseline is therefore the only approach compatible with the
current production prohibition. Its price is explicit: it prevents exploration
harm but also prevents nonparametric identification of unseen-action value. That
is preferable to manufacturing confidence from unsupported data.

## Safety constraints and required future contracts

### Constraint semantics must be versioned

A future proposal must choose exactly one primary constraint and must not mix
the following meanings:

- CLUCB cumulative expected reward budget;
- stage-wise or per-action reward threshold;
- SEA policy-level expected-reward replacement gate;
- CBwK cumulative resource consumption;
- hard product rules such as eligibility, abuse, privacy, and content safety.

The first four are statistical/optimization constraints. None supersedes hard
product rules. Expected-reward constraints also do not guarantee realized
safety for every user or every request.

### Minimum online feedback contract

Before any later online exploration proposal can be evaluated, immutable logs
must bind at least:

- context and point-in-time feature versions;
- complete eligible candidate/action set and exclusions;
- chosen action or ordered slate, including prefix semantics;
- behavior policy ID/version/config digest and exact factual propensity;
- reward definition, observation window, censoring/delay status, and attribution;
- baseline action and baseline expected-reward evidence where required;
- resource consumption and remaining budget where CBwK is proposed;
- request, decision, user/privacy-safe unit, timestamp, and serving owner;
- rollback version, monitoring state, and explicit production authorization.

Delayed, missing, or multiply attributed feedback must not be silently treated
as zero reward. Policy changes, reward changes, and logging changes require new
versions and must break incompatible evidence chains.

### Propensity and support gates

- A factual behavior probability must be produced by the policy that actually
  served the action. Recomputing it later or simulating from a deterministic
  decision is insufficient.
- Target support must be contained in behavior support at the relevant context,
  slate prefix, and position. Unsupported mass is an abstention, not a large
  finite weight.
- Minimum propensity, maximum realized importance ratio, effective sample size,
  candidate-pool completeness, and truncation must be explicit gates.
- If deterministic policy variation is proposed as implicit exploration, the
  average logging-policy estimator, stationarity interval, support threshold,
  and propensity uncertainty must be sealed and independently validated.

## Computation and failure modes

### CLUCB

- **Cost:** per-round feature/reward state, `d x d` confidence-matrix maintenance,
  confidence evaluation over actions, and optimistic plus pessimistic
  optimization.
- **Failures:** nonlinear/misspecified reward, nonstationarity, adversarial or
  delayed noise outside the model, wrong bounds or confidence level, inaccurate
  baseline evidence, tiny safety tolerance causing long baseline-only periods,
  intractable action optimization, and interpreting expected cumulative safety
  as pointwise or realized safety.

### CBwK

- **Cost:** policy-oracle optimization, online reward/consumption estimators,
  dual/resource state, and hard accounting over the horizon. Large contextual
  policy classes make the oracle the practical bottleneck.
- **Failures:** undefined resource semantics, stochastic or delayed consumption
  not represented in the model, budget/horizon drift, multiple constraints with
  poor feasibility margin, oracle approximation error, and treating budget
  feasibility as user-quality safety.

### SEA

- **Cost:** repeated stochastic-policy training and high-confidence OPE. Naive
  full-history recomputation is quadratic; sufficient statistics are practical
  only for compatible finite context/action representations.
- **Failures:** missing or incorrect propensities, positivity violation, tiny
  propensities and high variance, candidate reuse/overfit, loose bounds that
  permanently retain the baseline, adaptive multiple comparisons, feedback or
  reward drift, delayed/censored labels, and assuming a policy-level expected
  reward gate protects every request.

### Deterministic baseline

- **Cost:** no new exploration infrastructure; it retains current serving cost.
- **Failures:** support collapse and no counterfactual identification outside the
  chosen action, selection bias in supervised reward models, inability to detect
  a better unsupported policy, drift hidden by aggregate item counters, and a
  misleading appearance of “bandit learning” from deterministic jitter.

## Competing approaches and rejection reasons

### Stage-wise/GP safe exploration

SafeOpt protects an instantaneous threshold rather than CLUCB's cumulative
budget. That sounds closer to request-level safety, but it still requires online
safe-set expansion plus immediate safety feedback. The repository has no
validated GP safety response surface, initial safe-set proof for changed
rankings, or production sampling authorization. It is rejected rather than
adapted because its central evidence-producing action is forbidden.

### Direct reward modeling without randomization

A supervised/direct model could score every candidate offline, but its
counterfactual values outside logging support are extrapolations. OPE research
shows the bias/variance tradeoff; it does not grant identification. This option
is rejected as a promotion or safety mechanism. A direct model may remain a
synthetic diagnostic only, with no real-uplift claim.

### Simulated randomized slate as a substitute logger

The repository's simulation correctly labels itself non-servable and simulated.
Using its probabilities as if actions had actually been exposed would break the
causal/data contract. It is adopted for deterministic cross-runtime and
numerical tests, and rejected as behavior evidence.

## Repository feasibility and smallest verifiable scope

| Feasibility dimension | Current state | Phase 25 action |
|---|---|---|
| Real online rewards and attribution | Not sealed; current stage is offline/synthetic | Do not fit or update a live bandit |
| PIT context/candidate evidence | Synthetic/frozen paths exist; real complete support unavailable | Preserve digest and completeness checks |
| Factual propensity/support | Production emits deterministic/not evaluable | OPE and promotion abstain |
| qHat and score surface | Synthetic only | Use only for stress tests, not safety evidence |
| Rust/Node ownership | Rust owns scorer and randomized-slate simulation; Node owns decision log/promotion surfaces | Do not add a second algorithm owner |
| Latency/CPU/memory | No live confidence-matrix/oracle/OPE budget exists | Benchmark offline prototypes only |
| Rollback/observability | Promotion requires rollback and independent approval; exploration-specific controls absent | Keep action selection disabled and fail closed |
| Production authorization | Exploration explicitly prohibited; Task 9 unauthorized | No activation switch or servable artifact |

The smallest acceptable Phase 25 work is therefore:

1. Preserve the current deterministic production behavior and its explicit
   `not_evaluable_deterministic` propensity status.
2. Run CLUCB, CBwK, SEA, and deterministic-baseline comparisons only against
   frozen synthetic scenarios, with exact method/config/seed/dataset digests.
3. Test algorithmic invariants: CLUCB never spends more synthetic conservative
   budget than allowed; CBwK never exceeds the declared synthetic resource;
   SEA never switches when its synthetic confidence gate fails; all methods
   abstain on support or evidence drift.
4. Report results as implementation diagnostics and ablations, not real safety,
   uplift, coverage, or promotion evidence.
5. Do not add a production caller, activation flag, factual-propensity label,
   or promotion receipt.

## Promotion and rollback prerequisites for a future phase

A future live proposal remains a separate authorization decision and requires:

- an explicit owner-approved exploration population and budget;
- a versioned constraint and estimand with a baseline bound;
- online reward/consumption contracts and delay/censoring rules;
- factual randomized propensities and demonstrated target support;
- offline replay, synthetic stress, shadow scoring, and limited canary stages;
- sequentially valid monitoring or a fixed analysis plan with multiplicity
  control, plus segment and worst-case guardrails;
- automatic pause/rollback thresholds independent of the learning algorithm;
- independent approval and digest-bound evidence;
- fail-closed behavior on missing logs, drift, numerical error, support loss,
  feedback outage, or budget exhaustion.

Until all of those exist, “conservative,” “budgeted,” and “safe” are research
method names, not production claims.

## Final state

| Scope | State |
|---|---|
| Offline/synthetic comparison and design research | **GO** |
| Deterministic no-randomization production baseline | **GO** |
| Simulated randomized-slate invariant testing | **GO / non-servable** |
| Counterfactual value outside deterministic support | **NOT IDENTIFIED** |
| Real propensity/support readiness | **NOT READY** |
| Real safety or budget guarantee | **NOT ESTABLISHED** |
| CLUCB live deployment | **NO-GO** |
| CBwK live deployment | **NO-GO** |
| SEA live deployment | **NO-GO** |
| Production exploration | **NO-GO / prohibited** |
| Promotion / Task 9 | **NO-GO / unauthorized** |

Phase 25 should advance offline evidence discipline, not cross the production
boundary. The honest baseline is deterministic serving plus explicit
abstention wherever support, propensity, or feedback is absent.
