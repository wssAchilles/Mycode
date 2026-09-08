# Phase 22 Real Evidence Readiness Matrix

## Scope and current code facts

Phase 22 audits whether the repository has enough *real* evidence to move from
candidate-neutral diagnostics to an off-policy estimator or confidence sequence.
It does not select an estimator, qualify a policy, or change a production gate.

Current implementation facts:

- Synthetic behavior trajectories use `evidenceKind: 'simulated_propensity'` and
  hard-code `realDatasetEligible: false`; the same false value is carried by
  target-distribution, outcome, prediction-artifact, snapshot, OPE, and
  qualification contracts.
- The decision-log contract has a `logged_randomized` behavior-policy branch,
  but a real randomized-slate receipt, immutable policy version, draw/seed
  provenance, and complete action propensities are not present in the checked-in
  evidence chain.
- `verifyTargetDistributionStreamV2` binds source decision, target manifest,
  policy config, and verification-receipt digests. This proves an artifact
  relationship, not real target-policy support or causal validity.
- Cross-fitted qHat artifacts bind training/prediction and model digests, but
  the available fixtures are synthetic and the real-data promotion bit remains
  false. qHat must be trained without using the evaluation outcome.
- Phase 21's viewer/time envelope reports `evidenceStatus: 'not_ready'`, all
  real provenance/support/bounds/qHat/stopping gaps, zero candidate calls, and
  `nextPhaseHandoff: 'real_cluster_evidence_required'`.
- OPE evaluators fail closed unless the logged behavior policy is randomized
  with usable positive support. A larger slot count, more bootstrap draws, or a
  synthetic DGP does not increase the independent cluster count.

## Research questions

1. What immutable receipt is sufficient to establish a real randomized behavior
   policy, positive support, and finite propensity/weight bounds for every
   target-positive action?
2. What are the independent units `G` (viewer/session) and `H` (time or other
   shock dimension), and how must crossed-cell membership and cluster-size
   imbalance be measured before multiway inference is allowed?
3. Which qHat training, holdout, and digest bindings make a doubly robust
   pseudo-outcome predictable for the evaluation stream?
4. Which reward/weight envelopes and filtration/stopping receipts are required
   for fixed-sample versus anytime-valid OPE, and what should happen when they
   are missing?
5. What minimum evidence changes the state from `no_candidate` to a shadow-only
   `CONDITIONAL GO`, while preserving a fail-closed production default?

## Evidence matrix

| Source (exact citation and reading status) | Required assumptions: `G`/`H`, cluster size, support/bounds, qHat, stopping | Failure mode in this repository | Repository mapping and disposition |
|---|---|---|---|
| Cameron, Gelbach, Miller, **"Robust Inference With Multiway Clustering"**, 2011, *Journal of Business & Economic Statistics*, DOI [10.1198/jbes.2010.07136](https://doi.org/10.1198/jbes.2010.07136), `abstract_or_public_description` | Multiway inclusion-exclusion needs sufficiently many independent clusters in each dimension (`min(G,H) -> infinity`), valid intersection cells, finite score moments, and no dominant cluster. No propensity, qHat, or optional-stopping result. | Real viewer/time membership and common-shock handling are absent. A few viewers or time buckets, or one dominant cluster, invalidate asymptotic shrinkage; slot count is not `G` or `H`. | Maps to `ope/inference/clusterScores.ts`, Phase 21 cross-fit audit, and v10/v11 score surfaces. **Audit only; no estimator candidate.** |
| Djogbenou, MacKinnon, Nielsen, **"Asymptotic Theory and Wild Bootstrap Inference with Clustered Errors"**, 2019, *Journal of Econometrics*, DOI [10.1016/j.jeconom.2019.04.035](https://doi.org/10.1016/j.jeconom.2019.04.035), `full_text` | Independent clusters with growing `G`, finite `2 + lambda` score moments, and cluster-size/rate restrictions. Bootstrap multipliers do not repair too-small `G` or dependence. | Current receipts do not prove real cluster provenance, independent count, or size envelope; Phase 20/21 data are synthetic. | Maps to multiplier diagnostics and `clusterScores.ts`. **Retain as an audit baseline; reject production qualification.** |
| Canay, Santos, Shaikh, **"The Wild Bootstrap with a 'Small' Number of 'Large' Clusters"**, 2021, *Review of Economics and Statistics*, DOI [10.1162/rest_a_00887](https://doi.org/10.1162/rest_a_00887), `full_text` | Small fixed `G` is covered only with large within-cluster samples and additional homogeneity restrictions. It does not remove the need for independent clusters or valid score bounds. | Available synthetic examples have `G=2--4` and about two slots per cluster; no real large-within-cluster regime is evidenced. | Maps to Phase 20 bootstrap DGP. **Research comparison only; do not label current bootstrap as small-`G` valid.** |
| Karampatziakis, Mineiro, Ramdas, **"Off-Policy Confidence Sequences"**, 2021, *ICML*, PMLR 139:5301-5310, [official proceedings](https://proceedings.mlr.press/v139/karampatziakis21a.html), `full_text` | Logged contextual-bandit tuples need `pi << h`, known finite `w_max`, bounded rewards (normally `[0,1]`), predictable qHat/bets, and a valid filtration. Ville-style optional stopping is valid only under these hypotheses. Independent records are assumed; a cluster lift needs a proved cluster filtration and bounded cluster contribution. | Decision logs currently prove simulated propensities only; no real positive-support receipt, deterministic prefix-weight bound, real reward bound, or qHat cross-fit receipt exists. No stopping-rule receipt is bound. | Maps to `decisionLog/contracts.ts`, `offlinePrediction/streamingV2`, target evidence, and OPE evaluation. **No-candidate now; conditional shadow GO only after all receipts are verified.** |
| Waudby-Smith, Wu, Ramdas, Karampatziakis, Mineiro, **"Anytime-valid Off-Policy Inference for Contextual Bandits"**, 2022, [official arXiv record](https://arxiv.org/abs/2210.10768), `full_text` | Predictable changing behavior policy, target support, finite realized weights, bounded rewards, history-predictable DR qHat, and a conditional-mean/filtration formulation. Optional stopping is part of the theorem, not a post-hoc report choice. Cluster adaptation still needs independent cluster pseudo-outcomes and a bounded cluster envelope. | Current trajectory contracts omit real viewer/time filtration and stopping provenance. qHat artifacts are synthetic; evaluation outcomes and real policy draws are not sealed together. | Maps to `ope/core/sequentialDr.ts`, streaming target evidence, cross-fitted prediction artifacts, and Phase 21 blockers. **Future comparison; production NO-GO.** |
| Kuzborskij, Vernade, Gyorgy, Szepesvari, **"Confident Off-Policy Evaluation and Selection through Self-Normalized Importance Weighting"**, 2021, *AISTATS*, PMLR 130:640-648, [PMLR](https://proceedings.mlr.press/v130/kuzborskij21a.html), `full_text` | Independent contextual-bandit tuples, bounded rewards, evaluable behavior policy, target support, and finite weights. Self-normalization has finite-sample bias and is fixed-sample; repeated selection needs holdout/multiplicity control. Cluster use requires additional cluster-level concentration evidence. | No real behavior receipt or ESS/weight envelope is bound. Viewer/session dependence makes iid claims unavailable; fixed-sample SNIPS cannot justify optional stopping. | Maps to OPE v2/v3 estimators and promotion holdouts. **Sensitivity baseline only after real support/ESS evidence; reject as current primary candidate.** |
| Diagnostics-only abstention (repository contract, no statistical coverage claim) | Requires only verified provenance of the diagnostic inputs and explicit missing-evidence blockers. No `G/H`, support, qHat, or stopping assumption is claimed. | This is the only state currently supported: synthetic evidence is deliberately marked ineligible and real sources are rejected unless branded and digest-bound. | Maps to Phase 21 v11 evidence envelope, adequacy assessment, and honest no-candidate handoff. **Adopt now; preserve `candidateEvidenceEligible: false`, `realDatasetEligible: false`, and `servable: false`.** |

## Readiness gate and decision

The minimum real-data package for a shadow-only `CONDITIONAL GO` is a sealed,
versioned receipt binding: viewer/session and time-cluster IDs; crossed-cell
membership; independent counts `G` and `H`; cluster-size min/max and imbalance;
the randomized behavior policy, draw provenance, and every logged propensity;
target-policy support and a finite prefix/cluster weight envelope; immutable
reward bounds and observation horizon; a qHat cross-fit/holdout manifest with
training/evaluation disjointness and model digests; and an explicit filtration
and stopping rule. The receipt must be replay-verifiable and must not set a
production or serving bit.

Until that package exists, the evidence verdict is **CONDITIONAL GO for
research/readiness work, no-candidate for estimator selection, and production
NO-GO**. The next handoff remains `real_cluster_evidence_required`; missing or
drifting evidence must return `not_evaluable` rather than an estimate.

## Prioritized follow-up

1. Capture a real randomized-slate decision log with immutable policy/draw and
   propensity receipts, then replay-check target support and weight bounds.
2. Add real viewer/time/cell membership and a cross-fit manifest that excludes
   both held-out dimensions; report `G`, `H`, and imbalance before any estimator
   call.
3. Produce held-out qHat and outcome-bound receipts, then run a pre-registered
   fixed-sample shadow replay before considering optional stopping.

