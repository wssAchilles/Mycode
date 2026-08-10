# Phase 25 Uniform-Support, Local-Swap, and Interleaving Evidence Matrix

## Scope and verdict

This note compares three possible next states for randomized slate evidence:

1. add a uniform-support component to a without-replacement logging policy;
2. use local swaps or interleaving to reduce user-facing perturbation;
3. remain diagnostics-only and make no identification claim.

The verdict is:

- **ADAPT / CONDITIONAL GO** for a uniform-support mixture as a future
  simulation and shadow-logging candidate, provided that every prefix,
  remaining candidate set, conditional draw probability, randomization receipt,
  and resulting whole-slate joint propensity are immutable and replayable;
- **REJECT** local swaps and interleaving as substitutes for a full-support
  slate logging policy; retain them only as separately versioned pairwise or
  ranker-comparison diagnostics with their narrower estimands;
- **ADOPT** diagnostics-only abstention as the current baseline;
- **NO-GO** for production exploration or OPE promotion. Current evidence is
  simulated and explicitly non-servable, and the Decision Log does not yet
  disambiguate a prefix-conditional selection probability from a marginal or
  whole-slate propensity.

The research comparison itself is **GO**. This note does not authorize an
algorithm change.

## Code-derived facts

- `telegram-rust-workspace/crates/telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs`
  computes,
  at each call, `p_i = (1 - epsilon) * 1{i is baseline top} + epsilon * PL_i`.
  The Plackett--Luce component is score- and temperature-dependent; it has no
  distribution-free minimum probability independent of the score spread.
- `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/policy/randomized_slate/mod.rs`
  recomputes that distribution after each selected item is removed. It declares
  `conditional_on_prior_slate_prefix_v1`, records each selected conditional
  probability, sets `without_replacement: true`, marks the evidence
  `simulated_propensity`, and forces `servable: false`.
- `telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/target_distribution/build.rs`
  uses the same primitive over the remaining eligible candidates, emits all
  action probabilities for every prefix, and marks the distribution simulated
  and non-servable.
- `telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/decision_log.rs`
  represents
  `LoggedRandomized` with only `selectionProbability`. Its shape does not say
  `conditional_on_prior_slate_prefix`, `marginal`, or `whole_slate_joint`.
- No explicit whole-slate joint propensity field is present. For an ordered
  no-repeat slate `s = (a_1, ..., a_k)`, it is computable as
  `mu(s | x) = product_j mu(a_j | x, a_1, ..., a_{j-1})` only if the exact
  eligible pool, deterministic order, filters, prefix state, policy parameters,
  and draw semantics are all bound and replay-verified. A consumer that treats
  `selectionProbability` as a marginal probability would use the wrong weight.

## Research questions

1. Which design gives positive support to every target-positive ordered slate
   under sampling without replacement?
2. Can the exact whole-slate joint behavior propensity be computed from the
   logged evidence rather than reconstructed from mutable serving state?
3. What user-utility cost is guaranteed by each design, and what costs merely
   require empirical measurement?
4. Which estimand is unbiased under each design: whole-policy slate value,
   adjacent-pair preference, or relative preference between two rankers?
5. Which support, click-model, attribution, numerical, or contract failures must
   preserve diagnostics-only abstention?

## Evidence matrix

| Source, venue/institution, DOI or official link, reading status | Problem and core idea | Required data, support, and propensity assumptions | Utility loss, bias, and known failure cases | Repository mapping | Disposition |
|---|---|---|---|---|---|
| R. L. Plackett, **"The Analysis of Permutations"**, 1975, *Journal of the Royal Statistical Society: Series C (Applied Statistics)* 24(2):193--202, DOI [10.2307/2346567](https://doi.org/10.2307/2346567), `abstract_or_public_description` | Defines a probability distribution over permutations, providing the ranking-distribution foundation used by Plackett--Luce sampling. | A permutation probability is a joint probability over an ordered sequence; under sequential construction it depends on every prior removal and renormalization. | A positive mathematical model is insufficient if finite arithmetic underflows or if replay uses a different remaining set/order. Score-aware sampling may preserve more baseline utility than uniform exploration, but it provides no score-independent support floor. | The current primitive fails closed on probability underflow and the serving simulation removes selected candidates. | **ADAPT current PL mixture only with an explicit joint-propensity receipt; do not infer joint support from one slot alone.** |
| Lihong Li, Wei Chu, John Langford, Xuanhui Wang, **"Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms"**, 2011, *Proceedings of WSDM 2011*, Yahoo! Labs, DOI [10.1145/1935826.1935878](https://doi.org/10.1145/1935826.1935878), [official author/institution PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/published-3.pdf), `full_text` | Uniform random logging makes replay acceptance probabilities known and supports unbiased contextual-bandit evaluation under the paper's regime. | The formal result uses i.i.d. events, bounded rewards, a known random logging policy, and a fixed arm set in the main analysis. General randomized logging requires correct probabilities and loses data efficiency through rejection/weighting. | Exploration can select suboptimal actions and increase short-term regret. With `K` uniform arms, replay retains only `1/K` of events; variable arm sets are not covered by the paper's formal analysis. The result is single-action, not a proof for a no-repeat slate. | Motivates a transparent support component but does not validate the current multi-slot contract. | **ADAPT as support-design evidence; reject a direct transfer of its single-action guarantee to slates.** |
| Adith Swaminathan, Akshay Krishnamurthy, Alekh Agarwal, Miroslav Dudík, John Langford, Damien Jose, Imed Zitouni, **"Off-policy evaluation for slate recommendation"**, 2017, *Advances in Neural Information Processing Systems 30*, Microsoft Research / University of Massachusetts Amherst, [official full text](https://proceedings.neurips.cc/paper_files/paper/2017/file/5352696a9ca3397beb79f116f3a33991-Paper.pdf), `full_text` | Treats rankings as ordered no-repeat slates, shows that general IPS uses the logging policy's whole-slate probability, and defines whole-slate epsilon-uniform logging `mu_epsilon(s|x)=(1-epsilon)mu(s|x)+epsilon*nu(s|x)`. It proposes a lower-variance pseudoinverse estimator under additive slate reward structure. | IPS requires absolute continuity: `mu(s|x)>0` wherever the target has positive probability. PI additionally requires a slate reward linear in slot-action contributions and the relevant logging covariance/pseudoinverse. Logged samples are i.i.d. in the theorem. | The no-repeat slate space has size `m!/(m-k)!`; whole-slate IPS variance can be exponential. PI reduces data needs only by imposing no-interaction linearity, which can be biased when cross-item interactions matter. A whole-slate mixture is not the same policy as independently mixing at every prefix. | Directly matches `without_replacement: true` and the need to multiply prefix conditionals, but the repository has not selected or qualified PI and has no evidence that reward is additive. | **ADAPT uniform support; REJECT PI and any slot-marginal shortcut absent a separate research gate.** |
| Filip Radlinski, Thorsten Joachims, **"Minimally Invasive Randomization for Collecting Unbiased Preferences from Clickthrough Logs"**, 2006, *Proceedings of AAAI-06*, Cornell University / AAAI Press, [official paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/AAAI06FairPairs.pdf), `full_text` | FairPairs chooses one of two adjacent-pair partitions uniformly and flips each considered adjacent pair with probability `1/2`, keeping every item within one rank of baseline while estimating pairwise relevance preferences. | Its unbiased pairwise claim depends on document-identity and relevance-score assumptions and on the surrounding documents being independent of pair order. It requires repeated observations of both orders. | The support contains only local adjacent permutations, not arbitrary ordered slates. It does not identify whole-policy slate value or provide target-policy absolute continuity. Snippet quality, recognition, evolving relevance, and violated click assumptions can bias preferences. Low positional displacement is not a general bound on user utility. | A local-swap receipt could compute its own randomization probability if the partition bit and all pair flips were bound, but those probabilities cannot populate the current full-slate OPE contract. | **REJECT as an OPE logger; RETAIN only as a separate pairwise diagnostic experiment.** |
| Katja Hofmann, Shimon Whiteson, Maarten de Rijke, **"A Probabilistic Method for Inferring Preferences from Clicks"**, 2011, *Proceedings of CIKM 2011*, University of Amsterdam, DOI [10.1145/2063576.2063618](https://doi.org/10.1145/2063576.2063618), [official author-hosted PDF](https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/hofmann-probabilistic-2011.pdf), `full_text` | Probabilistic interleaving samples without replacement from ranker-derived softmax distributions and marginalizes possible ranker assignments to estimate which of two rankers is preferred. | The unbiasedness target is the comparison outcome under the stated interleaving and click-credit model, not arbitrary target-policy value. The complete ranker lists, softmax rule, team-selection draws, removal/renormalization, and click attribution must be known. | The paper identifies balanced/document-constraint bias and Team Draft insensitivity. Its own guarantee is tied to equal expected contribution and rank-shaped sampling assumptions. The induced list distribution is restricted by the two input rankers and does not establish full slate support. | The without-replacement mechanics resemble the repository primitive, but the estimand and evidence contract differ. Reusing `selectionProbability` would conflate comparison attribution with behavior propensity. | **REJECT as a full-support behavior policy; RETAIN for two-ranker diagnostics only.** |
| Filip Radlinski, Nick Craswell, **"Optimized Interleaving for Online Retrieval Evaluation"**, 2013, *Proceedings of WSDM 2013*, Microsoft, DOI [10.1145/2433396.2433429](https://doi.org/10.1145/2433396.2433429), [official paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2013/02/Radlinski_Optimized_WSDM2013.pdf.pdf), `full_text` | Constructs a distribution over allowed interleavings subject to fidelity/sensitivity constraints and bounds pair-order disagreement relative to the two input rankings. | Requires a declared feasible interleaving set, credit function, random-click neutrality constraints, and a solvable optimization. It compares two fixed rankers through user clicks. | Balanced interleaving has bias breaking cases; Team Draft can miss real improvements; probabilistic interleaving can degrade both inputs more than optimized interleaving. General existence conditions for a solution are left open. None of these results supplies support for slates outside the two-ranker interleaving set. | Useful for an explicit utility-perturbation diagnostic, but incompatible with treating the current target-distribution artifact as arbitrary-slate support. | **REJECT for OPE support; ADAPT only as an isolated online comparison protocol after separate authorization.** |

Paper experiments are used only to understand the stated methods and failure
boundaries. They are not treated as repository results, online gains, or
evidence that any method has been adopted here.

## Design comparison

| Design | Without-replacement slate support | Joint propensity computability | Utility-loss statement | Bias and failure boundary | Decision |
|---|---|---|---|---|---|
| Whole-slate uniform mixture | Full support if the uniform component ranges over every allowed no-repeat slate. For `m` eligible items and slate length `k`, a uniform ordered slate has probability `(m-k)!/m!`. | Direct if the logger first records which mixture branch was sampled and the full policy probability is evaluated as a mixture, not as a product of independently mixed prefixes. | For a deterministic baseline and bounded slate value, the mixture value is exactly `(1-epsilon)V_baseline + epsilon V_uniform`; loss relative to baseline is `epsilon(V_baseline-V_uniform)` and is at most `epsilon` times the value range. This is a design identity, not a measured repository result. | Whole-slate IPS weights remain combinatorial. Pool drift changes the uniform denominator. A consumer must not reinterpret a whole-slate mixture as a prefix mixture. | **ADAPT / CONDITIONAL GO** for offline and shadow design work. |
| Prefix-wise uniform-support mixture | Full support if every remaining eligible item receives `epsilon/|R_j|` at every prefix. An arbitrary slate's joint lower bound is the product of its step floors; it can still shrink exponentially with `k`. | Computable as the product of the selected prefix-conditionals only when all prefixes and remaining sets are replay-bound. It is generally **not** equal to a single whole-slate epsilon mixture. | No comparable one-line whole-slate loss formula: an exploratory choice changes every later remaining set. Measure paired baseline-vs-randomized utility and tail harm under a frozen simulator before shadowing. | A marginal/conditional confusion creates wrong IPS weights. Missing filters, ties, candidate identities, or draw versions invalidate the product. | **Preferred adaptation to the repository shape**, conditional on a new unambiguous receipt. |
| Current prefix PL mixture | Mathematical support is positive when all softmax weights are positive, but the minimum depends on score gaps and temperature; implementation rejects underflow. | Same prefix-product requirement as above. Existing simulation/target artifacts expose the needed semantics, but the Decision Log does not. | Score-aware exploration may concentrate on higher-scored items, but no paper or repository evidence here establishes a utility bound. | Near-zero probabilities produce extreme weights; underflow, score/order drift, and missing joint semantics fail the OPE boundary. | **Retain as diagnostics; do not promote.** |
| FairPairs/local swaps | Support is limited to adjacent pair flips from one of two partitions. Most no-repeat slates have zero probability. | The probability of a realized local permutation is computable only from the partition and flip receipt; it is not a usable joint propensity for arbitrary target slates. | Items remain within one rank of baseline, but whole-page/user utility can still change discontinuously. | Estimates adjacent-pair preference under click assumptions, not slate policy value. | **REJECT for OPE; RETAIN as pairwise diagnostics.** |
| Interleaving | Support is limited to lists constructible from the compared rankers under the interleaving algorithm. | An interleaved-list probability may be computed by summing compatible latent assignments, but it is not the behavior propensity of arbitrary target slates. | Optimized interleaving bounds disagreement relative to its two inputs; it does not provide a universal user-utility bound. | Click attribution, ranker overlap, breaking cases, and infeasible optimization can bias or weaken the comparison. | **REJECT for OPE; RETAIN as ranker-comparison diagnostics.** |
| Diagnostics-only abstention | Adds no support. | Requires no propensity calculation because it emits no policy-value estimate. | No exploration-induced user utility loss. | Observational bias and lack of counterfactual identification remain; diagnostics must not be promoted as causal evidence. | **ADOPT now.** |

## Required contract corrections before any shadow logger

1. Replace ambiguous `selectionProbability` use with a versioned semantic field
   such as `conditional_on_prior_slate_prefix_v1`; keep marginal and whole-slate
   probabilities as distinct types.
2. Bind the complete eligible candidate pool, deterministic baseline order,
   filter/config versions, prefix action keys, remaining-set digest, policy
   parameters, RNG algorithm/version, draw provenance, and every selected
   prefix-conditional probability.
3. Emit and replay-verify `jointSlateProbability = product(prefixConditionals)`;
   reject disagreement, underflow, non-finite arithmetic, zero target support,
   pool truncation, or candidate/order drift.
4. Declare whether the logger is a whole-slate mixture or a prefix-wise mixture.
   They are different policies even when both use the same `epsilon`.
5. Freeze utility guardrails before traffic: baseline-relative expected utility,
   lower-tail/session harm, support/weight/ESS diagnostics, and automatic
   rollback. This research supplies no acceptable numeric threshold.
6. Keep all resulting artifacts `servable: false` until real shadow receipts,
   PIT outcome bindings, cluster/dependence evidence, and the existing OPE and
   Promotion gates independently qualify them.

## Final state

| Scope | State |
|---|---|
| Phase 25 comparison research | `GO` |
| Current active method | `diagnostics_only_abstention` |
| Uniform-support design candidate | `CONDITIONAL GO / adapt` |
| Local swap as slate OPE logger | `NO-GO / reject` |
| Interleaving as slate OPE logger | `NO-GO / reject` |
| Local swap/interleaving as separately scoped diagnostics | `RESEARCH-ONLY` |
| Real joint propensity readiness | `NOT READY` |
| Shadow traffic activation | `NO-GO` |
| Production exploration and Promotion | `NO-GO` |
