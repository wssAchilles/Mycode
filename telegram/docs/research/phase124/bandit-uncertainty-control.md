# Bandit Uncertainty Control Regression

## Scope and verdict

**CONDITIONAL GO** for restoring the existing uncertainty-weight control in the
deterministic Rust scorer. This is not authorization for randomized serving,
propensity claims, promotion, or real-data inference.

New external research is skipped because this is a bounded regression under an
existing versioned contract. The established safety and support analysis in
`docs/research/phase25/conservative-bandit.md` remains authoritative.

## Code-derived questions and answers

1. **Is the policy field intended to affect ranking?** Yes. Before commit
   `417d54bd`, `plan.uncertainty_weight` directly weighted uncertainty in the
   lift. That commit introduced the Thompson approximation and replaced it with
   the constant `0.28`, while retaining the contract, plan field, and diagnostic.
2. **Where should the field act after that algorithm change?** On the explicit
   `exploration_bonus` term, which already contains the uncertainty factor.
3. **Should the old raw uncertainty term be restored too?** No. That would count
   uncertainty twice and change the new formula beyond the contract repair.
4. **Does the repair change evidence or serving authority?** No. The scorer stays
   deterministic for a fixed request and candidate, emits no propensity, and
   does not authorize production exploration.

## Evidence matrix

| Evidence | Reading status | Assumptions and limits | Decision |
|---|---|---|---|
| Current `exploration.rs`, Node ranking-policy contract, and commit `417d54bd` | `full_text` | Repository history proves prior consumption and the exact regression, but not real utility | Restore the existing control in the Rust owner |
| Abbas Kazerouni, Mohammad Ghavamzadeh, Yasin Abbasi-Yadkori, Benjamin Van Roy, **"Conservative Contextual Linear Bandits"**, 2017, NeurIPS 30, DOI [10.48550/arXiv.1611.06426](https://doi.org/10.48550/arXiv.1611.06426) | `full_text` (Phase 25) | Requires online chosen-action rewards, linear realizability, and confidence assumptions absent here | Reject live conservative-bandit claims |
| Rolf Jagerman, Ilya Markov, Maarten de Rijke, **"Safe Exploration for Optimizing Contextual Bandits"**, 2020, ACM TOIS 38(3), DOI [10.1145/3385670](https://doi.org/10.1145/3385670) | `full_text` (Phase 25) | Requires factual stochastic propensities, overlap, rewards, and repeated deployment | Retain diagnostics-only abstention and production NO-GO |

## Competing implementations

| Option | Decision | Reason |
|---|---|---|
| Weight `exploration_bonus` with `plan.uncertainty_weight` | Adopt | Smallest repair that preserves the Thompson-era formula and restores the contract |
| Re-add `uncertainty * plan.uncertainty_weight` | Reject | Double-counts uncertainty after the bonus already includes it |
| Keep `0.28` and delete the policy field | Reject | Breaks the existing Node/Rust/environment control contract |
| Leave the field diagnostic-only | Reject for offline engineering; retain production abstention | A reported control that cannot change output is misleading, while production remains deterministic regardless |

## Hypothesis, bounds, and failure conditions

- For the same eligible candidate with a positive exploration bonus, weight
  `0.7` must produce a larger `banditMultiplier` than weight `0.0`.
- The bonus diagnostic itself must be unchanged by the weight.
- Work remains O(1) per candidate, with no new allocation, state, or RNG.
- The added lift term is `epsilon * exploration_bonus * uncertainty_weight`;
  the existing `1.14` multiplier ceiling remains the final bound.
- Fail the change if the control does not affect a positive-bonus fixture, if
  deterministic replay changes between identical inputs, or if any score is
  non-finite.

## Boundary state

`selectedMethod=diagnostics_only_abstention_v1`,
`candidateQualificationStatus=not_run`, `realDatasetEligible=false`, real
inference unavailable, production randomized serving disabled, and promotion /
Task 9 remain NO-GO.
