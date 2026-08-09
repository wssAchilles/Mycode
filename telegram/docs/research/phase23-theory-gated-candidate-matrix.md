# Phase 23 Theory-Gated Multiway Candidate Matrix

## Scope and verdict

Phase 23 asks whether the existing Phase 20--22 evidence can support one
theorem-compatible, development-only inference candidate. The answer is
**NO-GO / `no_candidate_selected`**.

This is a positive implementation decision, not an incomplete placeholder:

- keep the Phase 22 same-process honest no-candidate handoff as the machine
  result;
- do not add DGP V3, a candidate adapter, a method-freeze receipt, a
  qualification seed/root, or another wrapper that only repeats `not_ready`;
- keep `diagnostics_only_abstention_v1` as the only selected method;
- preserve all finite-sample, multiplicity, real-evidence, sealed
  qualification, Promotion, exploration, and Task 9 blockers.

The reduced Phase 23 offline research phase is `GO`. Candidate development,
sealed qualification, real inference, and production activation remain
`NO-GO` or `NOT READY` as detailed below.

## Code-derived facts

### Phase 20 score surface

- `buildFrozenMultiwayDgpProtocolV2` owns the private protocol brand and exact
  resource preflight. `generateFrozenMultiwayDgpReplicationV2` owns the frozen
  synthetic draws. `buildVerifiedMultiwayScoreSurfaceV1` replays every record
  before constructing diagnostic surfaces.
- The frozen inventory contains 10 scenarios and exactly 4 replications per
  scenario: 40 replications, 752 decisions, 1,504 two-slot atoms, 320
  viewer-time cells, 120 viewer groups, 112 time groups, and 2,888 records.
- The generator's exact upper bounds are 11,829,248 canonical bytes and 30,120
  primitive work units. The score-surface upper bounds are 17,997,824 canonical
  input bytes, 3,009 score work units, and 17,728 aggregation work units.
- Slot 2 receives slot 1's prefix weight. Both generator and replay call the
  shared `evaluateSequentialDrSlotV1`; the score surface retains decision,
  viewer-time-cell, viewer, and time aggregates.
- The viewer-only baseline makes the sole operational call to
  `summarizeClusterScoresV1`. The frozen common-time-shock scenario forces that
  baseline to abstain; it never creates candidate evidence.

### Phase 21--22 evidence chain

- Phase 21 binds the Phase 20 handoff, protocol, and score-surface digests into
  a private evidence envelope. Real viewer/time membership and provenance are
  absent.
- The cluster-aware cross-fit audit rejects decision-only folds. It has no
  verified qHat cross-fit receipt and remains `not_ready`.
- Phase 21 adequacy remains `current_evidence_insufficient`, with candidate
  applicability `not_assessed_no_candidate_selected`.
- Phase 22 real intake binds all real evidence roots to `null` and records zero
  source records, bytes, and work units. The sealed-readiness envelope and
  handoff remain `not_ready` and `no_candidate_selected`.
- Every Phase 20--22 builder is same-process privately branded and digest-bound.
  Structured clones, plain objects, hostile getters, binding drift, and resource
  drift fail closed.
- Codebase-memory inbound traces show no production caller for the Phase 20--22
  builders. Test callers are the only direct callers.

### Runtime and production boundary

- The live Decision Log switch is default-off. Its current builder emits
  `deterministic_top_k`; behavior propensity is
  `not_evaluable_deterministic`.
- Target Distribution V2 has only synthetic fixture trust roots. PIT Snapshot
  V2 fixes historical backfill to unavailable and future shadow capture to
  code-ready but activation-blocked.
- Prediction V4 and OPE V4 are synthetic-only, non-servable, and ineligible for
  candidate, qualification, or real-data evidence.
- Promotion evaluators have no runtime caller and retain fixed inference,
  multiplicity, and Task 9 blockers.

## Research questions

1. Does any candidate have theorem-compatible validity at the frozen
   `G/H/r = 2--8` dimensions and two slots per decision?
2. Can sequential DR atoms be mapped to viewer, time, and intersection-cell
   statistics without copying the repository's score math?
3. How must common time shocks, dominant clusters, near-zero propensity, and
   qHat misspecification fail closed?
4. What can four replications per scenario establish, and how must a later
   development replication count be derived from precision?
5. How must revealed synthetic development evidence be separated from a future
   sealed qualification domain?

## Evidence matrix

| Source and reading status | Required regime and assumptions | Repository failure mode | Decision |
|---|---|---|---|
| A. Colin Cameron, Jonah B. Gelbach, Douglas L. Miller, **“Robust Inference With Multiway Clustering”**, 2011, *Journal of Business & Economic Statistics* 29(2):238--249, DOI [10.1198/jbes.2010.07136](https://doi.org/10.1198/jbes.2010.07136), `abstract_or_public_description` | Multiway inclusion-exclusion needs valid independent cluster dimensions, finite score moments, no dominant cluster, and asymptotic growth in the relevant dimensions. It does not establish OPE support, qHat, or optional-stopping validity. | `G/H` are at most 8 in synthetic diagnostics; real viewer/time membership and common-shock handling are absent. | Retain as a research reference; reject an estimator or Wald interval. |
| James G. MacKinnon, Morten Ørregaard Nielsen, Matthew D. Webb, **“Wild Bootstrap and Asymptotic Inference With Multiway Clustering”**, 2021, *Journal of Business & Economic Statistics* 39(2):505--519, DOI [10.1080/07350015.2019.1677473](https://doi.org/10.1080/07350015.2019.1677473), `full_text` | Validity is asymptotic and requires the relevant clustering dimensions to grow under stated exchangeability, correlation, and moment conditions. Bootstrap draws approximate an eligible sampling law; they do not create clusters. | Frozen dimensions are 2--8 and common time shocks are explicit. Increasing multiplier count `B` cannot repair missing asymptotics or provenance. | Keep Phase 12/20 bootstrap only as a diagnostic baseline. |
| Ivan A. Canay, Andrés Santos, Azeem M. Shaikh, **“The Wild Bootstrap with a ‘Small’ Number of ‘Large’ Clusters”**, 2021, *Review of Economics and Statistics* 103(2):346--363, DOI [10.1162/rest_a_00887](https://doi.org/10.1162/rest_a_00887), `full_text` | Fixed/small cluster count is paired with cluster-internal sample size tending to infinity and additional restrictions, including homogeneity conditions needed by the construction. | Two slots per decision and the frozen small cells do not provide a large-within-cluster regime. | Reject; do not relabel the existing bootstrap as a small-cluster correction. |
| Rustam Ibragimov, Ulrich K. Müller, **“t-Statistic Based Correlation and Heterogeneity Robust Inference”**, 2010, *Journal of Business & Economic Statistics* 28(4):453--468, DOI [10.1198/jbes.2009.08046](https://doi.org/10.1198/jbes.2009.08046), `abstract_or_public_description` | Groups must produce independent, asymptotically unbiased and Gaussian estimates of the same scalar parameter, possibly with heterogeneous variances. | Neither two slots nor the current cells are verified independent Gaussian group estimators; common time shocks break a viewer-only grouping. | Reject group-t candidate. |
| Ivan A. Canay, Joseph P. Romano, Azeem M. Shaikh, **“Randomization Tests Under an Approximate Symmetry Assumption”**, 2017, *Econometrica* 85(3):1013--1030, DOI [10.3982/ECTA13081](https://doi.org/10.3982/ECTA13081), `full_text` | Exact finite-sample validity requires invariance under the chosen transformation group. Approximate validity with fixed groups requires large within-group samples and the paper's limiting symmetry conditions. | Joint sign invariance is not verified. With 2 or 4 groups, minimum nonrandomized sign-test resolution is 0.25 or 0.0625. | Keep resolution audit only; do not reinterpret multiplier p-values. |
| Andreas Maurer, Massimiliano Pontil, **“Empirical Bernstein Bounds and Sample Variance Penalization”**, 2009, COLT, [official PDF](https://www.cs.mcgill.ca/~colt2009/papers/012.pdf), `full_text` | Independent bounded variables and a valid range/variance envelope are required. | No real independent viewer/time statistic or deterministic real prefix/cluster score bound is bound to Phase 22. | Reject empirical-Bernstein candidate. |
| Ian Waudby-Smith, Aaditya Ramdas, **“Estimating Means of Bounded Random Variables by Betting”**, online 2023 / 2024 issue, *Journal of the Royal Statistical Society Series B: Statistical Methodology* 86(1):1--27, DOI [10.1093/jrsssb/qkad009](https://doi.org/10.1093/jrsssb/qkad009), `full_text` | The primary construction requires independent observations with known bounded support, or the paper's separate randomized without-replacement design, plus predictable betting choices and a valid filtration. | No verified independent viewer/time statistic or deterministic bound on the complete real cluster contribution exists; a hidden common shock invalidates the proposed lift. | Reject a cluster-level betting candidate; retain as a future bounded-mean comparison. |
| Ilja Kuzborskij, Claire Vernade, András György, Csaba Szepesvári, **“Confident Off-Policy Evaluation and Selection through Self-Normalized Importance Weighting”**, 2021, AISTATS, PMLR 130:640--648, [official proceedings](https://proceedings.mlr.press/v130/kuzborskij21a.html), `full_text` | Logged contextual-bandit data, evaluable behavior probabilities, target support, bounded rewards, and controlled finite importance weights. The result is fixed-sample; policy selection still needs valid reuse/multiplicity handling. | Live propensity is deterministic/not evaluable; real support, bounds, viewer/time independence, and held-out qHat evidence are absent. | Reject as current candidate; future fixed-holdout sensitivity only after real receipts exist. |
| Steven R. Howard, Aaditya Ramdas, Jon McAuliffe, Jasjeet Sekhon, **“Time-uniform, Nonparametric, Nonasymptotic Confidence Sequences”**, 2021, *Annals of Statistics* 49(2):1055--1080, DOI [10.1214/20-AOS1991](https://doi.org/10.1214/20-AOS1991), `full_text` | Requires a valid filtration and nonnegative supermartingale; empirical-Bernstein variants need bounded or otherwise controlled increments and predictable variance/bets. Optional stopping is valid only inside this contract. | Viewer/time filtration, bounded cluster pseudo-outcome, qHat predictability, and stopping receipt are unverified. | Assumption audit only; do not generate a confidence sequence. |
| Nikos Karampatziakis, Paul Mineiro, Aaditya Ramdas, **“Off-Policy Confidence Sequences”**, 2021, ICML, PMLR 139:5301--5310, [official proceedings](https://proceedings.mlr.press/v139/karampatziakis21a.html), `full_text` | Contextual-bandit OPE needs behavior/target absolute continuity, finite known weight control in the stated construction, bounded rewards, predictable qHat/bets, and a valid filtration. | Real propensities/support, deterministic prefix-weight bounds, cluster filtration, qHat cross-fit, and stopping evidence are unavailable. | Reject current candidate; retain as future research after sealed real evidence. |
| Ian Waudby-Smith, Lili Wu, Aaditya Ramdas, Nikos Karampatziakis, Paul Mineiro, **“Anytime-valid Off-Policy Inference for Contextual Bandits”**, 2022, arXiv, [official record](https://arxiv.org/abs/2210.10768), `full_text` | Allows adaptive logging without a known uniform weight cap, but still requires target support and finite realized weights, bounded rewards, history-predictable DR qHat/truncation, and the paper's conditional-mean and filtration conditions. | The repository has no real randomized propensity/support receipt, viewer/time filtration, cluster-aware qHat cross-fit, or stopping receipt. Synthetic sequential prefixes do not prove these conditions. | Retain for future sealed-evidence research; reject current anytime-valid OPE candidate. |
| Harold D. Chiang, Kengo Kato, Yukun Ma, Yuya Sasaki, **“Multiway Cluster Robust Double/Debiased Machine Learning”**, 2022, *Journal of Business & Economic Statistics* 40(3):1046--1056, DOI [10.1080/07350015.2021.1895815](https://doi.org/10.1080/07350015.2021.1895815), `full_text`; formal **Correction**, 2021, DOI [10.1080/07350015.2021.1970572](https://doi.org/10.1080/07350015.2021.1970572), `full_text` | Requires multiway cluster asymptotics and cross-fitting that excludes every held-out cluster dimension. The correction updates application Table 2 and code, not those theoretical prerequisites. | Current real viewer/time membership is absent and decision-only folds are explicitly rejected. | Adopt only the fail-closed cross-fit provenance audit; reject the estimator. |
| Diagnostics-only abstention, repository contract | Makes no finite-sample coverage, candidate applicability, or production claim. It requires only verified provenance of diagnostic inputs and explicit missing-evidence blockers. | None: this exactly matches the available evidence. | Adopt as the only active method. |

No paper supplies a universal minimum `G` or `H` that overrides its assumptions.
The repository must demonstrate the theorem's regime; a caller boolean or a
larger bootstrap replication count cannot substitute for it.

## Answers and failure boundaries

### 1. Theorem-compatible candidate

No candidate is theorem-compatible with the current evidence. The frozen DGP
simultaneously lacks a many-cluster regime, a large-within-cluster regime,
verified sign symmetry, and a valid bounded martingale/propensity/cross-fit
regime. This is stronger than a power concern: the validity assumptions
themselves are not established.

### 2. Sequential DR mapping

The mapping already exists and must not be copied:

1. `evaluateSequentialDrSlotV1` owns each slot DR atom and prefix update.
2. Phase 20 replay groups those atoms by decision, viewer-time cell, viewer,
   and time without crossing scenario/replication boundaries.
3. `summarizeClusterScoresV1` remains the only ratio-score implementation for
   the viewer-only diagnostic.

A future candidate may consume the verified surface only after its theorem
defines the required unit and contrast. Phase 23 does not add another score
implementation.

### 3. Fail-closed conditions

- Common time shock: viewer-only inference abstains; multiway handling remains
  unavailable.
- Dominant cluster: no asymptotic or bounded-mean candidate is enabled without
  an evidenced no-dominance/range condition.
- Near-zero propensity: support and deterministic weight/score bounds must be
  sealed before an OPE bound or CS is callable.
- qHat misspecification: prediction provenance and cluster-aware cross-fitting
  are separate prerequisites; synthetic qHat stress does not prove real qHat
  readiness.
- Wrong cluster unit, digest drift, plain clones, and resource drift remain
  whole-set failures at the existing private-brand boundaries.

### 4. Four replications per scenario

Four replications can catch deterministic regressions, digest changes, replay
errors, and obvious failure-domain violations. They cannot support a
qualification coverage/failure-rate gate.

For the existing three-gate Hoeffding construction:

```text
deltaPerGate = 0.05 / 3
margin(n=4) = sqrt(log(60) / 8) = 0.715397141648
bestCaseCoverageLowerBound = 1 - margin = 0.284602858352
bestCaseFailureRateUpperBound = margin = 0.715397141648
```

Even perfect observed outcomes cannot meet 0.95/0.05 gates. A future frozen
development protocol must derive its replication count from its declared
precision and multiplicity. Under the same best-case three-gate formula,
`margin <= 0.05` requires at least 819 replications; nonideal observed rates
require more. Phase 23 does not silently expand the frozen 40 replications.

### 5. Development versus sealed qualification

All Phase 20 evidence is revealed, synthetic, and same-process. A future
qualification phase must create a new versioned protocol with an independently
generated sealed seed/root and non-overlapping domain separators. It must bind
candidate `methodId`, `configSha256`, estimand, score unit, evidence envelope,
resource plan, and one-time dataset/holdout use. No Phase 23 object may mint or
reserve that future trust surface.

## Plan corrections and implementation decision

The requested Phase 23 scope is corrected as follows:

| Proposed area | Decision |
|---|---|
| Candidate research | Complete and record the rejection matrix. |
| Candidate adapter | Do not implement: no theorem-compatible candidate. |
| DGP V3 | Do not implement: it is allowed only after a candidate's theory defines the missing grid. |
| New Phase 23 handoff | Do not implement: Phase 22 already expresses the honest no-candidate state; another wrapper adds no evidence. |
| Qualification seed/root/ledger | Do not implement. |
| Runtime, Promotion, Decision Log, Rust, `ml-services/**` | Do not modify. |

This follows the phase rule to stop at `no_candidate_selected` rather than
creating an API merely to advance a phase number.

## Final state

| Scope | State |
|---|---|
| Phase 23 offline algorithm research | `GO` |
| Theoretical applicability | `NOT ESTABLISHED` |
| Research candidate selection | `NO-GO / no_candidate_selected` |
| DGP V3 | `NOT NECESSARY / not implemented` |
| Sealed qualification readiness | `NOT READY` |
| Real finite-sample inference | `UNAVAILABLE` |
| Future shadow capture | `NO-GO / activation blocked` |
| Historical qHat/OPE | `BLOCKED` |
| Promotion / production exploration | `NO-GO` |
| Task 9 | `UNAUTHORIZED` |
