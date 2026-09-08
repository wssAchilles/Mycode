use std::{collections::HashSet, num::NonZeroU32};

use serde::Deserialize;
use telegram_randomized_policy_primitives::{EpsilonPlackettLuceError, compute_full_distribution};
use telegram_recommendation_contracts::{
    BaselineOrderVersion, BehaviorPolicyKind, CandidatePoolFingerprint, CandidateSupportEvidence,
    DecisionActionKey, DecisionCandidate, DecisionFingerprint, NumericalDiagnostics,
    NumericalDiagnosticsStep, PROBABILITY_MASS_TOLERANCE, ProbabilitySemantics, PropensityEvidence,
    RandomizedSlateEvidenceKind, RandomizedSlateOrderedAction,
    RandomizedSlateSimulationContractVersion, RandomizedSlateSimulationInputV1,
    RandomizedSlateSimulationStatus, RandomizedSlateSimulationV1, RecommendationDecisionLogV1,
    SupportDiagnostics, candidate_pool_sha256, canonical_json, compare_decision_pool_baseline,
    compute_simulation_sha256, sha256_hex,
};

mod v2;

const MAX_CANDIDATE_POOL_SIZE: usize = 2_048;
const MAX_SLATE_SIZE: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RandomizedSlateBlocker {
    InvalidSourceDecisionLog,
    SourceBehaviorNotDeterministic,
    InvalidEpsilon,
    InvalidTemperature,
    CandidatePoolTooLarge,
    SlateTooLarge,
    SupportIncomplete,
    CandidatePoolTruncated,
    CandidateCountMismatch,
    SourceDecisionDigestMismatch,
    CandidatePoolDigestMismatch,
    DuplicateCandidateIdentity,
    InsufficientEligibleCandidates,
    UniformDrawCountMismatch,
    InvalidUniformDraw,
    EligibleCandidateLogitMissing,
    NonFiniteLogit,
    NonFiniteArithmetic,
    ProbabilityUnderflow,
    ProbabilityMassMismatch,
    SimulationContractInvalid,
}

impl RandomizedSlateBlocker {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidSourceDecisionLog => "invalid_source_decision_log",
            Self::SourceBehaviorNotDeterministic => "source_behavior_not_deterministic",
            Self::InvalidEpsilon => "invalid_epsilon",
            Self::InvalidTemperature => "invalid_temperature",
            Self::CandidatePoolTooLarge => "candidate_pool_too_large",
            Self::SlateTooLarge => "slate_too_large",
            Self::SupportIncomplete => "support_incomplete",
            Self::CandidatePoolTruncated => "candidate_pool_truncated",
            Self::CandidateCountMismatch => "candidate_count_mismatch",
            Self::SourceDecisionDigestMismatch => "source_decision_digest_mismatch",
            Self::CandidatePoolDigestMismatch => "candidate_pool_digest_mismatch",
            Self::DuplicateCandidateIdentity => "duplicate_candidate_identity",
            Self::InsufficientEligibleCandidates => "insufficient_eligible_candidates",
            Self::UniformDrawCountMismatch => "uniform_draw_count_mismatch",
            Self::InvalidUniformDraw => "invalid_uniform_draw",
            Self::EligibleCandidateLogitMissing => "eligible_candidate_logit_missing",
            Self::NonFiniteLogit => "non_finite_logit",
            Self::NonFiniteArithmetic => "non_finite_arithmetic",
            Self::ProbabilityUnderflow => "probability_underflow",
            Self::ProbabilityMassMismatch => "probability_mass_mismatch",
            Self::SimulationContractInvalid => "simulation_contract_invalid",
        }
    }
}

pub(super) fn simulate(
    input: &RandomizedSlateSimulationInputV1,
) -> Result<RandomizedSlateSimulationV1, RandomizedSlateBlocker> {
    let source = validate_input(input)?;
    let candidates = &source.candidate_pool.candidates;
    let source_candidate_count = u32::try_from(candidates.len())
        .map_err(|_| RandomizedSlateBlocker::CandidatePoolTooLarge)?;
    let eligible_candidate_count = u32::try_from(
        candidates
            .iter()
            .filter(|candidate| candidate.eligible)
            .count(),
    )
    .map_err(|_| RandomizedSlateBlocker::CandidatePoolTooLarge)?;
    let mut remaining = candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .collect::<Vec<_>>();
    let mut ordered_actions = Vec::with_capacity(input.uniform_draws.len());
    let mut steps = Vec::with_capacity(input.uniform_draws.len());
    let mut max_probability_mass_error = 0.0_f64;

    for (index, draw) in input.uniform_draws.iter().copied().enumerate() {
        remaining.sort_unstable_by(|left, right| compare_decision_pool_baseline(left, right));
        let probabilities =
            probabilities(&remaining, input.config.epsilon, input.config.temperature)?;
        let raw_plackett_luce_probability_mass =
            probabilities.iter().map(|value| value.0).sum::<f64>();
        let raw_mixed_probability_mass = probabilities.iter().map(|value| value.1).sum::<f64>();
        if !raw_plackett_luce_probability_mass.is_finite()
            || !raw_mixed_probability_mass.is_finite()
        {
            return Err(RandomizedSlateBlocker::NonFiniteArithmetic);
        }
        let raw_probability_mass_error = (raw_plackett_luce_probability_mass - 1.0)
            .abs()
            .max((raw_mixed_probability_mass - 1.0).abs());
        if raw_probability_mass_error > PROBABILITY_MASS_TOLERANCE {
            return Err(RandomizedSlateBlocker::ProbabilityMassMismatch);
        }
        max_probability_mass_error = max_probability_mass_error.max(raw_probability_mass_error);

        let mut cumulative = 0.0;
        let mut selected_index = None;
        for (candidate_index, (_, probability)) in probabilities.iter().copied().enumerate() {
            cumulative = if candidate_index + 1 == probabilities.len() {
                1.0
            } else {
                cumulative + probability
            };
            if !cumulative.is_finite() {
                return Err(RandomizedSlateBlocker::NonFiniteArithmetic);
            }
            if draw < cumulative {
                selected_index = Some(candidate_index);
                break;
            }
        }
        let selected_index =
            selected_index.ok_or(RandomizedSlateBlocker::ProbabilityMassMismatch)?;
        let selected = remaining[selected_index];
        let served_position = NonZeroU32::new(
            u32::try_from(index + 1).map_err(|_| RandomizedSlateBlocker::SlateTooLarge)?,
        )
        .expect("one-based position is non-zero");
        ordered_actions.push(RandomizedSlateOrderedAction {
            action_key: DecisionActionKey {
                candidate_namespace: selected.candidate_namespace,
                candidate_id: selected.candidate_id.clone(),
                served_position,
            },
            selected_was_deterministic_top: selected_index == 0,
            plackett_luce_probability: probabilities[selected_index].0,
            conditional_selection_probability: probabilities[selected_index].1,
        });
        steps.push(NumericalDiagnosticsStep {
            served_position,
            remaining_candidate_count: u32::try_from(remaining.len())
                .map_err(|_| RandomizedSlateBlocker::CandidatePoolTooLarge)?,
            plackett_luce_probability_mass: raw_plackett_luce_probability_mass,
            mixed_probability_mass: raw_mixed_probability_mass,
            probability_mass_error: raw_probability_mass_error,
        });
        remaining.remove(selected_index);
    }

    let mut output = RandomizedSlateSimulationV1 {
        contract_version: RandomizedSlateSimulationContractVersion::V1,
        status: RandomizedSlateSimulationStatus::Simulated,
        policy: input.config.clone(),
        baseline_order_version: BaselineOrderVersion::DecisionPoolRankThenIdentityV1,
        probability_semantics: ProbabilitySemantics::ConditionalOnPriorSlatePrefixV1,
        decision_fingerprint: DecisionFingerprint {
            decision_id: source.decision_id,
            sha256: input.source_decision_log_sha256.clone(),
        },
        candidate_pool_fingerprint: CandidatePoolFingerprint {
            sha256: source.candidate_pool.candidate_pool_sha256,
        },
        ordered_actions,
        support_diagnostics: SupportDiagnostics {
            source_candidate_count,
            eligible_candidate_count,
            excluded_ineligible_candidate_count: source_candidate_count - eligible_candidate_count,
            sampled_count: input.config.slate_size.get(),
            without_replacement: true,
        },
        numerical_diagnostics: NumericalDiagnostics {
            probability_mass_tolerance: PROBABILITY_MASS_TOLERANCE,
            max_probability_mass_error,
            steps,
        },
        evidence_kind: RandomizedSlateEvidenceKind::SimulatedPropensity,
        servable: false,
        simulation_sha256: "0".repeat(64),
    };
    output.simulation_sha256 = compute_simulation_sha256(&output)
        .map_err(|_| RandomizedSlateBlocker::SimulationContractInvalid)?;
    output
        .validate_against(input)
        .map_err(|_| RandomizedSlateBlocker::SimulationContractInvalid)?;
    Ok(output)
}

fn validate_input(
    input: &RandomizedSlateSimulationInputV1,
) -> Result<RecommendationDecisionLogV1, RandomizedSlateBlocker> {
    let source = RecommendationDecisionLogV1::deserialize(&input.source_decision_log)
        .map_err(|_| RandomizedSlateBlocker::InvalidSourceDecisionLog)?;
    let candidates = &source.candidate_pool.candidates;
    let slate_size = usize::try_from(input.config.slate_size.get())
        .map_err(|_| RandomizedSlateBlocker::SlateTooLarge)?;

    if !input.config.epsilon.is_finite()
        || input.config.epsilon <= 0.0
        || input.config.epsilon > 1.0
    {
        return Err(RandomizedSlateBlocker::InvalidEpsilon);
    }
    if !input.config.temperature.is_finite() || input.config.temperature <= 0.0 {
        return Err(RandomizedSlateBlocker::InvalidTemperature);
    }
    if candidates.len() > MAX_CANDIDATE_POOL_SIZE {
        return Err(RandomizedSlateBlocker::CandidatePoolTooLarge);
    }
    if slate_size > MAX_SLATE_SIZE {
        return Err(RandomizedSlateBlocker::SlateTooLarge);
    }
    if !matches!(
        source.candidate_pool.support_evidence,
        CandidateSupportEvidence::Complete
    ) {
        return Err(RandomizedSlateBlocker::SupportIncomplete);
    }
    if source.candidate_pool.truncated {
        return Err(RandomizedSlateBlocker::CandidatePoolTruncated);
    }
    if usize::try_from(source.candidate_pool.total_count).ok() != Some(candidates.len()) {
        return Err(RandomizedSlateBlocker::CandidateCountMismatch);
    }
    if source.behavior_policy_kind != BehaviorPolicyKind::DeterministicTopK
        || source.actions.iter().any(|action| {
            !matches!(
                action.behavior_propensity,
                PropensityEvidence::NotEvaluableDeterministic { .. }
            )
        })
    {
        return Err(RandomizedSlateBlocker::SourceBehaviorNotDeterministic);
    }

    let mut identities = HashSet::with_capacity(candidates.len());
    let mut eligible_count = 0_usize;
    for candidate in candidates {
        if !identities.insert((
            candidate.candidate_namespace,
            candidate.candidate_id.as_str(),
        )) {
            return Err(RandomizedSlateBlocker::DuplicateCandidateIdentity);
        }
        if candidate.eligible {
            eligible_count += 1;
            let score = candidate
                .score
                .ok_or(RandomizedSlateBlocker::EligibleCandidateLogitMissing)?;
            if !score.is_finite() {
                return Err(RandomizedSlateBlocker::NonFiniteLogit);
            }
        }
    }
    if eligible_count < slate_size {
        return Err(RandomizedSlateBlocker::InsufficientEligibleCandidates);
    }
    if input.uniform_draws.len() != slate_size {
        return Err(RandomizedSlateBlocker::UniformDrawCountMismatch);
    }
    if input
        .uniform_draws
        .iter()
        .any(|draw| !draw.is_finite() || *draw <= 0.0 || *draw >= 1.0)
    {
        return Err(RandomizedSlateBlocker::InvalidUniformDraw);
    }

    source
        .validate()
        .map_err(|_| RandomizedSlateBlocker::InvalidSourceDecisionLog)?;
    input
        .config
        .validate()
        .map_err(|_| RandomizedSlateBlocker::SimulationContractInvalid)?;
    let expected_source_digest = sha256_hex(
        canonical_json(&input.source_decision_log)
            .map_err(|_| RandomizedSlateBlocker::InvalidSourceDecisionLog)?,
    );
    if input.source_decision_log_sha256 != expected_source_digest {
        return Err(RandomizedSlateBlocker::SourceDecisionDigestMismatch);
    }
    let expected_pool_digest = candidate_pool_sha256(candidates)
        .map_err(|_| RandomizedSlateBlocker::InvalidSourceDecisionLog)?;
    if source.candidate_pool.candidate_pool_sha256 != expected_pool_digest {
        return Err(RandomizedSlateBlocker::CandidatePoolDigestMismatch);
    }
    Ok(source)
}

fn probabilities(
    candidates: &[&DecisionCandidate],
    epsilon: f64,
    temperature: f64,
) -> Result<Vec<(f64, f64)>, RandomizedSlateBlocker> {
    let logits = candidates
        .iter()
        .map(|candidate| candidate.score.expect("eligible scores were validated"))
        .collect::<Vec<_>>();
    compute_full_distribution(&logits, epsilon, temperature)
        .map(|output| output.probabilities)
        .map_err(|error| match error {
            EpsilonPlackettLuceError::EmptySupport => {
                RandomizedSlateBlocker::InsufficientEligibleCandidates
            }
            EpsilonPlackettLuceError::InvalidEpsilon => RandomizedSlateBlocker::InvalidEpsilon,
            EpsilonPlackettLuceError::InvalidTemperature => {
                RandomizedSlateBlocker::InvalidTemperature
            }
            EpsilonPlackettLuceError::NonFiniteLogit => RandomizedSlateBlocker::NonFiniteLogit,
            EpsilonPlackettLuceError::NonFiniteArithmetic => {
                RandomizedSlateBlocker::NonFiniteArithmetic
            }
            EpsilonPlackettLuceError::ProbabilityUnderflow => {
                RandomizedSlateBlocker::ProbabilityUnderflow
            }
            EpsilonPlackettLuceError::ProbabilityMassMismatch => {
                RandomizedSlateBlocker::ProbabilityMassMismatch
            }
        })
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU32;

    use serde::Deserialize;
    use telegram_recommendation_contracts::{
        CandidateNamespace, DecisionCandidate, PropensityEvidence, RandomizedSlatePolicyId,
        RandomizedSlateSimulationInputContractVersion, RandomizedSlateSimulationInputV1,
        RecommendationDecisionLogV1, candidate_pool_sha256, canonical_json, sha256_hex,
    };

    use super::{RandomizedSlateBlocker, simulate};

    const FIRST_ID: &str = "507f191e810c19729de8c001";

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        fixture_version: String,
        input: RandomizedSlateSimulationInputV1,
        expected: telegram_recommendation_contracts::RandomizedSlateSimulationV1,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct SyntheticBehaviorFixture {
        fixture_version: String,
        target_fixture_path: String,
        behavior_policy_config_sha256: String,
        target_policy_config_sha256: String,
        input: RandomizedSlateSimulationInputV1,
        expected: telegram_recommendation_contracts::RandomizedSlateSimulationV1,
    }

    fn candidate(id: &str, rank: u32, score: Option<f64>, eligible: bool) -> DecisionCandidate {
        let mut candidate: DecisionCandidate = serde_json::from_value(serde_json::json!({
            "candidateNamespace": "serving_post_id",
            "candidateId": id,
            "poolRank": rank,
            "eligible": eligible,
            "score": score,
            "selected": false,
            "selectionRank": null,
            "served": false,
            "servedPosition": null,
            "objectiveEvidence": []
        }))
        .unwrap();
        if id == FIRST_ID {
            candidate.selected = true;
            candidate.selection_rank = NonZeroU32::new(1);
            candidate.served = true;
            candidate.served_position = NonZeroU32::new(1);
        }
        candidate
    }

    fn input(
        candidates: Vec<DecisionCandidate>,
        slate_size: u32,
        epsilon: f64,
        temperature: f64,
        uniform_draws: Vec<f64>,
    ) -> RandomizedSlateSimulationInputV1 {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../telegram-recommendation-fixtures/fixtures/decision_log_v1.json"
        ))
        .unwrap();
        let mut decision: RecommendationDecisionLogV1 =
            serde_json::from_value(fixture["decisionLog"].clone()).unwrap();
        decision.actions[0].action_key.candidate_namespace = CandidateNamespace::ServingPostId;
        decision.actions[0].action_key.candidate_id = FIRST_ID.to_string();
        decision.actions[0].behavior_propensity = PropensityEvidence::NotEvaluableDeterministic {
            reason: telegram_recommendation_contracts::DeterministicNotEvaluableReason::DeterministicTopKNoLoggedProbability,
        };
        decision.candidate_pool.total_count = u32::try_from(candidates.len()).unwrap();
        decision.candidate_pool.candidates = candidates;
        decision.candidate_pool.candidate_pool_sha256 =
            candidate_pool_sha256(&decision.candidate_pool.candidates).unwrap();
        let source_decision_log = serde_json::to_value(decision).unwrap();
        let source_decision_log_sha256 = sha256_hex(canonical_json(&source_decision_log).unwrap());

        RandomizedSlateSimulationInputV1 {
            contract_version: RandomizedSlateSimulationInputContractVersion::V1,
            source_decision_log,
            source_decision_log_sha256,
            config: telegram_recommendation_contracts::RandomizedSlateConfigV1 {
                policy_id: RandomizedSlatePolicyId::EligiblePoolEpsilonPlackettLuceV1,
                policy_version: "policy-v1".to_string(),
                config_version: "config-v1".to_string(),
                epsilon,
                temperature,
                slate_size: NonZeroU32::new(slate_size).unwrap(),
            },
            uniform_draws,
        }
    }

    fn three_candidate_input(
        scores: [f64; 3],
        epsilon: f64,
        draws: Vec<f64>,
    ) -> RandomizedSlateSimulationInputV1 {
        input(
            vec![
                candidate(FIRST_ID, 1, Some(scores[0]), true),
                candidate("507f191e810c19729de8c002", 2, Some(scores[1]), true),
                candidate("507f191e810c19729de8c003", 3, Some(scores[2]), true),
            ],
            u32::try_from(draws.len()).unwrap(),
            epsilon,
            1.0,
            draws,
        )
    }

    #[test]
    fn golden_fixture_matches_fixed_draw_simulation() {
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../../../telegram-recommendation-fixtures/fixtures/randomized_slate_simulation_v1.json"
        ))
        .unwrap();
        assert_eq!(
            fixture.fixture_version,
            "randomized_slate_simulation_fixture_v1"
        );
        assert_eq!(simulate(&fixture.input).unwrap(), fixture.expected);
    }

    #[test]
    fn phase11_synthetic_behavior_fixture_matches_private_kernel() {
        let fixture: SyntheticBehaviorFixture = serde_json::from_str(include_str!(
            "../../../../../telegram-recommendation-fixtures/fixtures/phase11_synthetic_behavior_trajectory_v1.json"
        ))
        .unwrap();
        assert_eq!(
            fixture.fixture_version,
            "randomized_slate_simulation_fixture_v1"
        );
        assert_eq!(
            fixture.target_fixture_path,
            "target_policy_distribution_stream_v1.json"
        );
        assert_eq!(
            fixture.behavior_policy_config_sha256,
            sha256_hex(canonical_json(&fixture.input.config).unwrap())
        );
        assert_ne!(
            fixture.behavior_policy_config_sha256,
            fixture.target_policy_config_sha256
        );
        assert_eq!(simulate(&fixture.input).unwrap(), fixture.expected);
        assert_eq!(
            fixture
                .expected
                .ordered_actions
                .iter()
                .map(|action| (
                    action.action_key.candidate_id.as_str(),
                    action.action_key.served_position.get()
                ))
                .collect::<Vec<_>>(),
            [
                ("507f191e810c19729de8c001", 1),
                ("507f191e810c19729de8c002", 2)
            ]
        );
    }

    #[test]
    fn fixed_draw_is_without_replacement_and_diagnostics_preserve_raw_mass() {
        let output = simulate(&three_candidate_input(
            [0.0, 2.0, 1.0],
            0.2,
            vec![0.9, 0.9, 0.5],
        ))
        .unwrap();
        let ids = output
            .ordered_actions
            .iter()
            .map(|action| action.action_key.candidate_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            [
                "507f191e810c19729de8c002",
                "507f191e810c19729de8c003",
                FIRST_ID
            ]
        );
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            3
        );
        assert!(
            output.ordered_actions[0..2]
                .iter()
                .all(|action| !action.selected_was_deterministic_top)
        );
        assert!(output.ordered_actions[2].selected_was_deterministic_top);
        let weights = [(-2.0_f64).exp(), 0.0_f64.exp(), (-1.0_f64).exp()];
        let denominator = weights.iter().sum::<f64>();
        let raw_plackett_luce_mass = weights
            .iter()
            .map(|weight| weight / denominator)
            .sum::<f64>();
        let raw_mixed_mass = weights
            .iter()
            .enumerate()
            .map(|(index, weight)| 0.8 * f64::from(index == 0) + 0.2 * (weight / denominator))
            .sum::<f64>();
        let raw_error = (raw_plackett_luce_mass - 1.0)
            .abs()
            .max((raw_mixed_mass - 1.0).abs());
        assert_eq!(
            output.numerical_diagnostics.steps[0].plackett_luce_probability_mass,
            raw_plackett_luce_mass
        );
        assert_eq!(
            output.numerical_diagnostics.steps[0].mixed_probability_mass,
            raw_mixed_mass
        );
        assert_eq!(
            output.numerical_diagnostics.steps[0].probability_mass_error,
            raw_error
        );
        assert!(raw_error > 0.0);
        assert!(output.numerical_diagnostics.steps.iter().all(|step| {
            (step.plackett_luce_probability_mass - 1.0).abs() <= 1e-12
                && (step.mixed_probability_mass - 1.0).abs() <= 1e-12
        }));
    }

    #[test]
    fn epsilon_one_and_common_logit_offset_preserve_plackett_luce_behavior() {
        let epsilon_one =
            simulate(&three_candidate_input([0.0, 2.0, 1.0], 1.0, vec![0.5])).unwrap();
        assert_eq!(
            epsilon_one.ordered_actions[0].action_key.candidate_id,
            "507f191e810c19729de8c002"
        );

        let base = simulate(&three_candidate_input([0.0, 2.0, 1.0], 1e-9, vec![0.4])).unwrap();
        let shifted = simulate(&three_candidate_input(
            [1.0e12, 1.0e12 + 2.0, 1.0e12 + 1.0],
            1e-9,
            vec![0.4],
        ))
        .unwrap();
        assert_eq!(base.ordered_actions, shifted.ordered_actions);
        assert_eq!(
            base.numerical_diagnostics.steps,
            shifted.numerical_diagnostics.steps
        );
    }

    #[test]
    fn baseline_ties_and_input_permutations_are_canonical() {
        let candidates = vec![
            candidate(FIRST_ID, 1, Some(1.0), true),
            candidate("507f191e810c19729de8c002", 1, Some(1.0), true),
            candidate("507f191e810c19729de8c003", 2, Some(1.0), true),
        ];
        let first = simulate(&input(candidates.clone(), 3, 0.5, 1.0, vec![0.1, 0.7, 0.5])).unwrap();
        let mut reversed = candidates;
        reversed.reverse();
        let second = simulate(&input(reversed, 3, 0.5, 1.0, vec![0.1, 0.7, 0.5])).unwrap();

        assert_eq!(first.ordered_actions, second.ordered_actions);
        assert_eq!(first.ordered_actions[0].action_key.candidate_id, FIRST_ID);
    }

    #[test]
    fn deterministic_stratified_draws_match_single_position_probability() {
        let trials = 10_000_u32;
        let mut selected_second = 0_u32;
        for index in 0..trials {
            let draw = (f64::from(index) + 0.5) / f64::from(trials);
            let output =
                simulate(&three_candidate_input([0.0, 1.0, 0.0], 1.0, vec![draw])).unwrap();
            selected_second += u32::from(
                output.ordered_actions[0]
                    .action_key
                    .candidate_id
                    .ends_with("002"),
            );
        }
        let observed = f64::from(selected_second) / f64::from(trials);
        let expected = std::f64::consts::E / (std::f64::consts::E + 2.0);
        assert!((observed - expected).abs() < 0.0002);
    }

    #[test]
    fn numeric_underflow_is_fail_closed() {
        let error = simulate(&three_candidate_input(
            [1000.0, 0.0, -1000.0],
            1.0,
            vec![0.5],
        ))
        .unwrap_err();
        assert_eq!(error, RandomizedSlateBlocker::ProbabilityUnderflow);
    }

    #[test]
    fn structural_and_support_blockers_are_stable() {
        let valid = three_candidate_input([0.0, 1.0, 2.0], 0.2, vec![0.5]);

        let mut case = valid.clone();
        case.source_decision_log["candidatePool"]["supportEvidence"] =
            serde_json::json!({ "status": "incomplete", "reason": "partial" });
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::SupportIncomplete
        );

        let mut case = valid.clone();
        case.source_decision_log["candidatePool"]["truncated"] = serde_json::json!(true);
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::CandidatePoolTruncated
        );

        let mut case = valid.clone();
        case.source_decision_log["candidatePool"]["totalCount"] = serde_json::json!(4);
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::CandidateCountMismatch
        );

        let mut case = valid.clone();
        case.source_decision_log_sha256 = "0".repeat(64);
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::SourceDecisionDigestMismatch
        );

        let mut case = valid.clone();
        case.source_decision_log["candidatePool"]["candidatePoolSha256"] =
            serde_json::json!("0".repeat(64));
        case.source_decision_log_sha256 =
            sha256_hex(canonical_json(&case.source_decision_log).unwrap());
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::InvalidSourceDecisionLog
        );

        let mut candidates = vec![
            candidate(FIRST_ID, 1, Some(0.0), true),
            candidate(FIRST_ID, 2, Some(1.0), true),
        ];
        candidates[1].selected = false;
        candidates[1].selection_rank = None;
        candidates[1].served = false;
        candidates[1].served_position = None;
        assert_eq!(
            simulate(&input(candidates, 1, 0.2, 1.0, vec![0.5])).unwrap_err(),
            RandomizedSlateBlocker::DuplicateCandidateIdentity
        );

        let mut case = valid.clone();
        case.source_decision_log["behaviorPolicyKind"] = serde_json::json!("logged_randomized");
        case.source_decision_log["actions"][0]["behaviorPropensity"] = serde_json::json!({
            "status": "logged_randomized",
            "selectionProbability": 0.5
        });
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::SourceBehaviorNotDeterministic
        );
    }

    #[test]
    fn parameter_logit_and_capacity_blockers_are_stable() {
        let mut case = three_candidate_input([0.0, 1.0, 2.0], 0.2, vec![0.5]);
        case.config.epsilon = 0.0;
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::InvalidEpsilon
        );

        let mut case = three_candidate_input([0.0, 1.0, 2.0], 0.2, vec![0.5]);
        case.config.temperature = 0.0;
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::InvalidTemperature
        );

        let mut case = three_candidate_input([0.0, 1.0, 2.0], 0.2, vec![0.5]);
        case.uniform_draws.clear();
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::UniformDrawCountMismatch
        );

        let mut case = three_candidate_input([0.0, 1.0, 2.0], 0.2, vec![0.5]);
        case.uniform_draws[0] = 1.0;
        assert_eq!(
            simulate(&case).unwrap_err(),
            RandomizedSlateBlocker::InvalidUniformDraw
        );

        let missing = input(
            vec![candidate(FIRST_ID, 1, None, true)],
            1,
            0.2,
            1.0,
            vec![0.5],
        );
        assert_eq!(
            simulate(&missing).unwrap_err(),
            RandomizedSlateBlocker::EligibleCandidateLogitMissing
        );

        let insufficient = input(
            vec![
                candidate(FIRST_ID, 1, Some(0.0), true),
                candidate("507f191e810c19729de8c002", 2, Some(1.0), false),
            ],
            2,
            0.2,
            1.0,
            vec![0.5, 0.5],
        );
        assert_eq!(
            simulate(&insufficient).unwrap_err(),
            RandomizedSlateBlocker::InsufficientEligibleCandidates
        );

        let too_many = (0..=2048)
            .map(|index| {
                let id = if index == 0 {
                    FIRST_ID.to_string()
                } else {
                    format!("candidate-{index}")
                };
                candidate(&id, index + 1, Some(0.0), true)
            })
            .collect();
        assert_eq!(
            simulate(&input(too_many, 1, 0.2, 1.0, vec![0.5])).unwrap_err(),
            RandomizedSlateBlocker::CandidatePoolTooLarge
        );

        let candidates = (0..65)
            .map(|index| {
                let id = if index == 0 {
                    FIRST_ID.to_string()
                } else {
                    format!("candidate-{index}")
                };
                candidate(&id, index + 1, Some(0.0), true)
            })
            .collect();
        assert_eq!(
            simulate(&input(candidates, 65, 0.2, 1.0, vec![0.5; 65])).unwrap_err(),
            RandomizedSlateBlocker::SlateTooLarge
        );
    }

    #[test]
    fn blocker_wire_literals_are_complete_and_stable() {
        assert_eq!(
            RandomizedSlateBlocker::InvalidSourceDecisionLog.as_str(),
            "invalid_source_decision_log"
        );
        assert_eq!(
            RandomizedSlateBlocker::SourceBehaviorNotDeterministic.as_str(),
            "source_behavior_not_deterministic"
        );
        assert_eq!(
            RandomizedSlateBlocker::InvalidEpsilon.as_str(),
            "invalid_epsilon"
        );
        assert_eq!(
            RandomizedSlateBlocker::InvalidTemperature.as_str(),
            "invalid_temperature"
        );
        assert_eq!(
            RandomizedSlateBlocker::CandidatePoolTooLarge.as_str(),
            "candidate_pool_too_large"
        );
        assert_eq!(
            RandomizedSlateBlocker::SlateTooLarge.as_str(),
            "slate_too_large"
        );
        assert_eq!(
            RandomizedSlateBlocker::SupportIncomplete.as_str(),
            "support_incomplete"
        );
        assert_eq!(
            RandomizedSlateBlocker::CandidatePoolTruncated.as_str(),
            "candidate_pool_truncated"
        );
        assert_eq!(
            RandomizedSlateBlocker::CandidateCountMismatch.as_str(),
            "candidate_count_mismatch"
        );
        assert_eq!(
            RandomizedSlateBlocker::SourceDecisionDigestMismatch.as_str(),
            "source_decision_digest_mismatch"
        );
        assert_eq!(
            RandomizedSlateBlocker::CandidatePoolDigestMismatch.as_str(),
            "candidate_pool_digest_mismatch"
        );
        assert_eq!(
            RandomizedSlateBlocker::DuplicateCandidateIdentity.as_str(),
            "duplicate_candidate_identity"
        );
        assert_eq!(
            RandomizedSlateBlocker::InsufficientEligibleCandidates.as_str(),
            "insufficient_eligible_candidates"
        );
        assert_eq!(
            RandomizedSlateBlocker::UniformDrawCountMismatch.as_str(),
            "uniform_draw_count_mismatch"
        );
        assert_eq!(
            RandomizedSlateBlocker::InvalidUniformDraw.as_str(),
            "invalid_uniform_draw"
        );
        assert_eq!(
            RandomizedSlateBlocker::EligibleCandidateLogitMissing.as_str(),
            "eligible_candidate_logit_missing"
        );
        assert_eq!(
            RandomizedSlateBlocker::NonFiniteLogit.as_str(),
            "non_finite_logit"
        );
        assert_eq!(
            RandomizedSlateBlocker::NonFiniteArithmetic.as_str(),
            "non_finite_arithmetic"
        );
        assert_eq!(
            RandomizedSlateBlocker::ProbabilityUnderflow.as_str(),
            "probability_underflow"
        );
        assert_eq!(
            RandomizedSlateBlocker::ProbabilityMassMismatch.as_str(),
            "probability_mass_mismatch"
        );
        assert_eq!(
            RandomizedSlateBlocker::SimulationContractInvalid.as_str(),
            "simulation_contract_invalid"
        );
    }

    #[test]
    fn source_contract_failures_are_not_partially_simulated() {
        let mut invalid = three_candidate_input([0.0, 1.0, 2.0], 0.2, vec![0.5]);
        invalid.source_decision_log["requestId"] = serde_json::json!("not-a-uuid");
        assert_eq!(
            simulate(&invalid).unwrap_err(),
            RandomizedSlateBlocker::InvalidSourceDecisionLog
        );
    }
}
