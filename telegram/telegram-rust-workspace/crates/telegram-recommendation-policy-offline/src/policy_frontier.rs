use serde::Serialize;
use telegram_randomized_policy_primitives::{
    EpsilonPlackettLuceError, PROBABILITY_MASS_TOLERANCE, compute_full_distribution,
};
use telegram_recommendation_contracts::{canonical_json, sha256_hex};

const CONTRACT_VERSION: &str = "epsilon_plackett_luce_utility_frontier_diagnostic_v1";
const MAX_SCENARIOS: usize = 8;
const MAX_CONFIGURATIONS: usize = 64;
const MAX_CANDIDATES: usize = 16;
const MAX_SLATE_SIZE: usize = 4;
const MAX_SCENARIO_ID_BYTES: usize = 64;
const MAX_PREFIX_EVALUATIONS: u64 = 100_000;
const MAX_PATHS: u64 = 100_000;
const MAX_WORK_UNITS: u64 = 1_000_000;
const MAX_OUTPUT_BYTES: u64 = 1_048_576;
const MAX_POINT_BYTES: u64 = 1_024;
const MAX_SCENARIO_BYTES: u64 = 256;
const OUTPUT_OVERHEAD_BYTES: u64 = 2_048;
const NUMERIC_TOLERANCE: f64 = 1e-10;

const STEEP_GAP_SCORES: &[f64] = &[4.0, 2.0, 0.0, -2.0];
const MODERATE_GAP_SCORES: &[f64] = &[2.0, 1.5, 1.0, 0.5];
const FLAT_SCORES: &[f64] = &[1.0, 1.0, 1.0, 1.0];

const FROZEN_SCENARIOS: [FrozenScenario; 3] = [
    FrozenScenario {
        id: "steep_gap",
        scores: STEEP_GAP_SCORES,
        slate_size: 2,
    },
    FrozenScenario {
        id: "moderate_gap",
        scores: MODERATE_GAP_SCORES,
        slate_size: 2,
    },
    FrozenScenario {
        id: "flat_scores",
        scores: FLAT_SCORES,
        slate_size: 2,
    },
];

const FROZEN_CONFIGURATIONS: [FrontierConfiguration; 12] = [
    FrontierConfiguration {
        epsilon: 0.1,
        temperature: 0.5,
    },
    FrontierConfiguration {
        epsilon: 0.1,
        temperature: 1.0,
    },
    FrontierConfiguration {
        epsilon: 0.1,
        temperature: 2.0,
    },
    FrontierConfiguration {
        epsilon: 0.25,
        temperature: 0.5,
    },
    FrontierConfiguration {
        epsilon: 0.25,
        temperature: 1.0,
    },
    FrontierConfiguration {
        epsilon: 0.25,
        temperature: 2.0,
    },
    FrontierConfiguration {
        epsilon: 0.5,
        temperature: 0.5,
    },
    FrontierConfiguration {
        epsilon: 0.5,
        temperature: 1.0,
    },
    FrontierConfiguration {
        epsilon: 0.5,
        temperature: 2.0,
    },
    FrontierConfiguration {
        epsilon: 1.0,
        temperature: 0.5,
    },
    FrontierConfiguration {
        epsilon: 1.0,
        temperature: 1.0,
    },
    FrontierConfiguration {
        epsilon: 1.0,
        temperature: 2.0,
    },
];

#[derive(Debug, Clone, Copy, PartialEq)]
struct FrozenScenario {
    id: &'static str,
    scores: &'static [f64],
    slate_size: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct FrontierConfiguration {
    epsilon: f64,
    temperature: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrontierError {
    ResourceLimitExceeded,
    InputContractInvalid,
    ProbabilityInvalid,
    NumericInvalid,
    OutputContractInvalid,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
struct FrontierResourcePlan {
    scenario_count: u32,
    configuration_count: u32,
    prefix_evaluations: u64,
    probability_evaluations: u64,
    ordered_paths: u64,
    work_units: u64,
    planned_output_canonical_bytes_upper_bound: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
struct FrontierPoint {
    epsilon: f64,
    temperature: f64,
    baseline_total_score: f64,
    expected_total_score: f64,
    synthetic_utility_loss: f64,
    minimum_conditional_propensity: f64,
    minimum_ordered_joint_propensity: f64,
    maximum_inverse_ordered_joint_weight: f64,
    maximum_probability_mass_error: f64,
    pareto_frontier: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
struct FrontierScenarioReport {
    scenario_id: &'static str,
    candidate_count: u32,
    slate_size: u32,
    points: Vec<FrontierPoint>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
struct FrontierReportPreimage {
    contract_version: &'static str,
    status: &'static str,
    real_dataset_eligible: bool,
    servable: bool,
    resource_plan: FrontierResourcePlan,
    scenarios: Vec<FrontierScenarioReport>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
struct FrontierReport {
    contract_version: &'static str,
    status: &'static str,
    real_dataset_eligible: bool,
    servable: bool,
    resource_plan: FrontierResourcePlan,
    scenarios: Vec<FrontierScenarioReport>,
    report_sha256: String,
}

#[derive(Debug, Clone, Copy, Default)]
struct EnumerationStats {
    expected_total_score: f64,
    path_probability_sum: f64,
    minimum_conditional_propensity: f64,
    minimum_ordered_joint_propensity: f64,
    maximum_probability_mass_error: f64,
}

#[derive(Debug, Clone, Copy)]
struct EnumerationState {
    joint_probability: f64,
    accumulated_score: f64,
}

fn frozen_frontier() -> Result<FrontierReport, FrontierError> {
    evaluate_frontier(
        &FROZEN_SCENARIOS,
        &FROZEN_CONFIGURATIONS,
        &mut |logits, epsilon, temperature| compute_full_distribution(logits, epsilon, temperature),
    )
}

fn evaluate_frontier<F>(
    scenarios: &[FrozenScenario],
    configurations: &[FrontierConfiguration],
    kernel: &mut F,
) -> Result<FrontierReport, FrontierError>
where
    F: FnMut(
        &[f64],
        f64,
        f64,
    ) -> Result<
        telegram_randomized_policy_primitives::FullDistribution,
        EpsilonPlackettLuceError,
    >,
{
    let resource_plan = preflight(scenarios, configurations)?;
    let mut reports = Vec::with_capacity(scenarios.len());

    for scenario in scenarios {
        let baseline_total_score = deterministic_top_k_score(scenario)?;
        let mut points = Vec::with_capacity(configurations.len());
        for configuration in configurations {
            let stats = enumerate_configuration(scenario, *configuration, kernel)?;
            let synthetic_utility_loss = baseline_total_score - stats.expected_total_score;
            if !synthetic_utility_loss.is_finite() || synthetic_utility_loss < -NUMERIC_TOLERANCE {
                return Err(FrontierError::NumericInvalid);
            }
            let synthetic_utility_loss = if synthetic_utility_loss <= 0.0 {
                0.0
            } else {
                synthetic_utility_loss
            };
            let minimum_joint = stats.minimum_ordered_joint_propensity;
            let maximum_inverse_joint = 1.0 / minimum_joint;
            if !maximum_inverse_joint.is_finite() {
                return Err(FrontierError::NumericInvalid);
            }
            points.push(FrontierPoint {
                epsilon: configuration.epsilon,
                temperature: configuration.temperature,
                baseline_total_score,
                expected_total_score: stats.expected_total_score,
                synthetic_utility_loss,
                minimum_conditional_propensity: stats.minimum_conditional_propensity,
                minimum_ordered_joint_propensity: minimum_joint,
                maximum_inverse_ordered_joint_weight: maximum_inverse_joint,
                maximum_probability_mass_error: stats.maximum_probability_mass_error,
                pareto_frontier: false,
            });
        }
        mark_frontier(&mut points);
        reports.push(FrontierScenarioReport {
            scenario_id: scenario.id,
            candidate_count: u32::try_from(scenario.scores.len())
                .map_err(|_| FrontierError::ResourceLimitExceeded)?,
            slate_size: u32::try_from(scenario.slate_size)
                .map_err(|_| FrontierError::ResourceLimitExceeded)?,
            points,
        });
    }

    let preimage = FrontierReportPreimage {
        contract_version: CONTRACT_VERSION,
        status: "diagnostic_only",
        real_dataset_eligible: false,
        servable: false,
        resource_plan,
        scenarios: reports,
    };
    let preimage_json =
        canonical_json(&preimage).map_err(|_| FrontierError::OutputContractInvalid)?;
    let report = FrontierReport {
        contract_version: preimage.contract_version,
        status: preimage.status,
        real_dataset_eligible: preimage.real_dataset_eligible,
        servable: preimage.servable,
        resource_plan: preimage.resource_plan,
        scenarios: preimage.scenarios,
        report_sha256: sha256_hex(preimage_json.as_bytes()),
    };
    let report_json = canonical_json(&report).map_err(|_| FrontierError::OutputContractInvalid)?;
    if u64::try_from(report_json.len()).map_err(|_| FrontierError::ResourceLimitExceeded)?
        > resource_plan.planned_output_canonical_bytes_upper_bound
    {
        return Err(FrontierError::ResourceLimitExceeded);
    }
    Ok(report)
}

fn preflight(
    scenarios: &[FrozenScenario],
    configurations: &[FrontierConfiguration],
) -> Result<FrontierResourcePlan, FrontierError> {
    if scenarios.is_empty()
        || scenarios.len() > MAX_SCENARIOS
        || configurations.is_empty()
        || configurations.len() > MAX_CONFIGURATIONS
    {
        return Err(FrontierError::ResourceLimitExceeded);
    }

    let mut prefix_evaluations = 0_u64;
    let mut probability_evaluations = 0_u64;
    let mut ordered_paths = 0_u64;
    for scenario in scenarios {
        if scenario.id.is_empty()
            || scenario.id.len() > MAX_SCENARIO_ID_BYTES
            || scenario.scores.is_empty()
            || scenario.scores.len() > MAX_CANDIDATES
            || scenario.slate_size == 0
            || scenario.slate_size > MAX_SLATE_SIZE
            || scenario.slate_size > scenario.scores.len()
            || !scenario
                .scores
                .iter()
                .all(|score| score.is_finite() && score.abs() <= 16.0)
            || !scenario
                .scores
                .windows(2)
                .all(|window| window[0] >= window[1])
        {
            return Err(FrontierError::InputContractInvalid);
        }
        let counts = enumeration_counts(scenario.scores.len(), scenario.slate_size)?;
        prefix_evaluations = prefix_evaluations
            .checked_add(counts.prefix_evaluations)
            .ok_or(FrontierError::ResourceLimitExceeded)?;
        probability_evaluations = probability_evaluations
            .checked_add(counts.probability_evaluations)
            .ok_or(FrontierError::ResourceLimitExceeded)?;
        ordered_paths = ordered_paths
            .checked_add(counts.ordered_paths)
            .ok_or(FrontierError::ResourceLimitExceeded)?;
    }
    for configuration in configurations {
        if !configuration.epsilon.is_finite()
            || configuration.epsilon <= 0.0
            || configuration.epsilon > 1.0
            || !configuration.temperature.is_finite()
            || configuration.temperature <= 0.0
        {
            return Err(FrontierError::InputContractInvalid);
        }
    }

    let configuration_count =
        u64::try_from(configurations.len()).map_err(|_| FrontierError::ResourceLimitExceeded)?;
    let scenario_count =
        u64::try_from(scenarios.len()).map_err(|_| FrontierError::ResourceLimitExceeded)?;
    prefix_evaluations = prefix_evaluations
        .checked_mul(configuration_count)
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    probability_evaluations = probability_evaluations
        .checked_mul(configuration_count)
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    ordered_paths = ordered_paths
        .checked_mul(configuration_count)
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    let point_count = scenario_count
        .checked_mul(configuration_count)
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    let work_units = prefix_evaluations
        .checked_add(probability_evaluations)
        .and_then(|value| value.checked_add(ordered_paths))
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    let point_bytes = point_count
        .checked_mul(MAX_POINT_BYTES)
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    let scenario_bytes = scenario_count
        .checked_mul(MAX_SCENARIO_BYTES)
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    let planned_output = OUTPUT_OVERHEAD_BYTES
        .checked_add(point_bytes)
        .and_then(|value| value.checked_add(scenario_bytes))
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    if prefix_evaluations > MAX_PREFIX_EVALUATIONS
        || ordered_paths > MAX_PATHS
        || work_units > MAX_WORK_UNITS
        || planned_output > MAX_OUTPUT_BYTES
    {
        return Err(FrontierError::ResourceLimitExceeded);
    }

    Ok(FrontierResourcePlan {
        scenario_count: u32::try_from(scenarios.len())
            .map_err(|_| FrontierError::ResourceLimitExceeded)?,
        configuration_count: u32::try_from(configurations.len())
            .map_err(|_| FrontierError::ResourceLimitExceeded)?,
        prefix_evaluations,
        probability_evaluations,
        ordered_paths,
        work_units,
        planned_output_canonical_bytes_upper_bound: planned_output,
    })
}

#[derive(Debug, Clone, Copy)]
struct EnumerationCounts {
    prefix_evaluations: u64,
    probability_evaluations: u64,
    ordered_paths: u64,
}

fn enumeration_counts(
    candidate_count: usize,
    slate_size: usize,
) -> Result<EnumerationCounts, FrontierError> {
    let mut permutations = 1_u64;
    let mut prefix_evaluations = 0_u64;
    let mut probability_evaluations = 0_u64;
    for depth in 0..slate_size {
        if depth > 0 {
            permutations = permutations
                .checked_mul(
                    u64::try_from(candidate_count - depth + 1)
                        .map_err(|_| FrontierError::ResourceLimitExceeded)?,
                )
                .ok_or(FrontierError::ResourceLimitExceeded)?;
        }
        let remaining = u64::try_from(candidate_count - depth)
            .map_err(|_| FrontierError::ResourceLimitExceeded)?;
        prefix_evaluations = prefix_evaluations
            .checked_add(permutations)
            .ok_or(FrontierError::ResourceLimitExceeded)?;
        probability_evaluations = probability_evaluations
            .checked_add(
                permutations
                    .checked_mul(remaining)
                    .ok_or(FrontierError::ResourceLimitExceeded)?,
            )
            .ok_or(FrontierError::ResourceLimitExceeded)?;
    }
    let ordered_paths = permutations
        .checked_mul(
            u64::try_from(candidate_count - slate_size + 1)
                .map_err(|_| FrontierError::ResourceLimitExceeded)?,
        )
        .ok_or(FrontierError::ResourceLimitExceeded)?;
    Ok(EnumerationCounts {
        prefix_evaluations,
        probability_evaluations,
        ordered_paths,
    })
}

fn deterministic_top_k_score(scenario: &FrozenScenario) -> Result<f64, FrontierError> {
    let score = scenario.scores[..scenario.slate_size]
        .iter()
        .copied()
        .sum::<f64>();
    if score.is_finite() {
        Ok(score)
    } else {
        Err(FrontierError::NumericInvalid)
    }
}

fn enumerate_configuration<F>(
    scenario: &FrozenScenario,
    configuration: FrontierConfiguration,
    kernel: &mut F,
) -> Result<EnumerationStats, FrontierError>
where
    F: FnMut(
        &[f64],
        f64,
        f64,
    ) -> Result<
        telegram_randomized_policy_primitives::FullDistribution,
        EpsilonPlackettLuceError,
    >,
{
    let mut stats = EnumerationStats {
        minimum_conditional_propensity: f64::INFINITY,
        minimum_ordered_joint_propensity: f64::INFINITY,
        ..EnumerationStats::default()
    };
    let remaining = (0..scenario.scores.len()).collect::<Vec<_>>();
    enumerate_prefix(
        scenario,
        configuration,
        remaining,
        0,
        EnumerationState {
            joint_probability: 1.0,
            accumulated_score: 0.0,
        },
        &mut stats,
        kernel,
    )?;
    if !stats.expected_total_score.is_finite()
        || !stats.path_probability_sum.is_finite()
        || (stats.path_probability_sum - 1.0).abs() > NUMERIC_TOLERANCE
        || !stats.minimum_conditional_propensity.is_finite()
        || !stats.minimum_ordered_joint_propensity.is_finite()
    {
        return Err(FrontierError::NumericInvalid);
    }
    Ok(stats)
}

fn enumerate_prefix<F>(
    scenario: &FrozenScenario,
    configuration: FrontierConfiguration,
    remaining: Vec<usize>,
    depth: usize,
    state: EnumerationState,
    stats: &mut EnumerationStats,
    kernel: &mut F,
) -> Result<(), FrontierError>
where
    F: FnMut(
        &[f64],
        f64,
        f64,
    ) -> Result<
        telegram_randomized_policy_primitives::FullDistribution,
        EpsilonPlackettLuceError,
    >,
{
    if depth == scenario.slate_size {
        let expected_contribution = state.joint_probability * state.accumulated_score;
        if !expected_contribution.is_finite() {
            return Err(FrontierError::NumericInvalid);
        }
        stats.path_probability_sum += state.joint_probability;
        stats.expected_total_score += expected_contribution;
        if !stats.path_probability_sum.is_finite() || !stats.expected_total_score.is_finite() {
            return Err(FrontierError::NumericInvalid);
        }
        stats.minimum_ordered_joint_propensity = stats
            .minimum_ordered_joint_propensity
            .min(state.joint_probability);
        return Ok(());
    }

    let logits = remaining
        .iter()
        .map(|index| scenario.scores[*index])
        .collect::<Vec<_>>();
    let distribution = kernel(&logits, configuration.epsilon, configuration.temperature)
        .map_err(|_| FrontierError::ProbabilityInvalid)?;
    if distribution.probabilities.len() != remaining.len() {
        return Err(FrontierError::ProbabilityInvalid);
    }
    let probability_mass_error = distribution
        .diagnostics
        .plackett_luce_mass_error
        .max(distribution.diagnostics.mixed_mass_error);
    if !probability_mass_error.is_finite() || probability_mass_error > PROBABILITY_MASS_TOLERANCE {
        return Err(FrontierError::ProbabilityInvalid);
    }
    stats.maximum_probability_mass_error = stats
        .maximum_probability_mass_error
        .max(probability_mass_error);

    for (selected_index, (plackett_luce_probability, conditional_probability)) in
        distribution.probabilities.iter().copied().enumerate()
    {
        if !plackett_luce_probability.is_finite()
            || plackett_luce_probability <= 0.0
            || !conditional_probability.is_finite()
            || conditional_probability <= 0.0
        {
            return Err(FrontierError::ProbabilityInvalid);
        }
        let next_joint_probability = state.joint_probability * conditional_probability;
        if !next_joint_probability.is_finite() || next_joint_probability <= 0.0 {
            return Err(FrontierError::ProbabilityInvalid);
        }
        stats.minimum_conditional_propensity = stats
            .minimum_conditional_propensity
            .min(conditional_probability);
        let selected = remaining[selected_index];
        let mut next_remaining = remaining.clone();
        next_remaining.remove(selected_index);
        enumerate_prefix(
            scenario,
            configuration,
            next_remaining,
            depth + 1,
            EnumerationState {
                joint_probability: next_joint_probability,
                accumulated_score: state.accumulated_score + scenario.scores[selected],
            },
            stats,
            kernel,
        )?;
    }
    Ok(())
}

fn mark_frontier(points: &mut [FrontierPoint]) {
    for index in 0..points.len() {
        let candidate = &points[index];
        let dominated = points.iter().enumerate().any(|(other_index, other)| {
            if index == other_index {
                return false;
            }
            let utility_no_worse =
                other.expected_total_score + NUMERIC_TOLERANCE >= candidate.expected_total_score;
            let conditional_no_worse = other.minimum_conditional_propensity + NUMERIC_TOLERANCE
                >= candidate.minimum_conditional_propensity;
            let joint_risk_no_worse = other.maximum_inverse_ordered_joint_weight
                <= candidate.maximum_inverse_ordered_joint_weight + NUMERIC_TOLERANCE;
            let strict = other.expected_total_score
                > candidate.expected_total_score + NUMERIC_TOLERANCE
                || other.minimum_conditional_propensity
                    > candidate.minimum_conditional_propensity + NUMERIC_TOLERANCE
                || other.maximum_inverse_ordered_joint_weight
                    < candidate.maximum_inverse_ordered_joint_weight - NUMERIC_TOLERANCE;
            utility_no_worse && conditional_no_worse && joint_risk_no_worse && strict
        });
        points[index].pareto_frontier = !dominated;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn frozen_frontier_is_deterministic_bounded_and_abstention_only() {
        let first = frozen_frontier().expect("frozen frontier should evaluate");
        let second = frozen_frontier().expect("frozen frontier should replay");
        assert_eq!(first, second);
        assert_eq!(first.contract_version, CONTRACT_VERSION);
        assert_eq!(first.status, "diagnostic_only");
        assert!(!first.real_dataset_eligible);
        assert!(!first.servable);
        assert_eq!(first.resource_plan.scenario_count, 3);
        assert_eq!(first.resource_plan.configuration_count, 12);
        assert_eq!(first.resource_plan.prefix_evaluations, 180);
        assert_eq!(first.resource_plan.probability_evaluations, 576);
        assert_eq!(first.resource_plan.ordered_paths, 432);
        assert_eq!(first.resource_plan.work_units, 1_188);
        assert_eq!(
            first.report_sha256,
            "9319da59be933ca50d5c04e0adc0a05149cd65601a3e05c02185494bb13dab8e"
        );
        for scenario in &first.scenarios {
            assert!(scenario.points.iter().any(|point| point.pareto_frontier));
            for point in &scenario.points {
                assert!(
                    point.expected_total_score <= point.baseline_total_score + NUMERIC_TOLERANCE
                );
                assert!(point.synthetic_utility_loss >= 0.0);
                assert!(point.minimum_conditional_propensity > 0.0);
                assert!(point.minimum_ordered_joint_propensity > 0.0);
                assert!(point.maximum_inverse_ordered_joint_weight.is_finite());
                assert!(point.maximum_probability_mass_error <= PROBABILITY_MASS_TOLERANCE);
            }
        }
        assert_eq!(first.report_sha256.len(), 64);
    }

    #[test]
    fn resource_preflight_rejects_before_probability_kernel_call() {
        const OVERSIZED_SCORES: [f64; MAX_CANDIDATES + 1] = [0.0; MAX_CANDIDATES + 1];
        let scenarios = [FrozenScenario {
            id: "oversized",
            scores: &OVERSIZED_SCORES,
            slate_size: 2,
        }];
        let configurations = [FROZEN_CONFIGURATIONS[0]];
        let calls = Cell::new(0_u32);
        let result = evaluate_frontier(
            &scenarios,
            &configurations,
            &mut |_logits, _epsilon, _temperature| {
                calls.set(calls.get() + 1);
                unreachable!("preflight must reject before the kernel");
            },
        );
        assert_eq!(result, Err(FrontierError::InputContractInvalid));
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn work_preflight_rejects_large_grid_before_probability_kernel_call() {
        const LARGE_SCORES: [f64; MAX_CANDIDATES] = [
            15.0, 14.0, 13.0, 12.0, 11.0, 10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0, 0.0,
        ];
        const LARGE_SCENARIO: FrozenScenario = FrozenScenario {
            id: "large_grid",
            scores: &LARGE_SCORES,
            slate_size: MAX_SLATE_SIZE,
        };
        const LARGE_CONFIGURATION: FrontierConfiguration = FrontierConfiguration {
            epsilon: 0.5,
            temperature: 1.0,
        };
        let scenarios = [LARGE_SCENARIO; MAX_SCENARIOS];
        let configurations = [LARGE_CONFIGURATION; MAX_CONFIGURATIONS];
        let calls = Cell::new(0_u32);
        let result = evaluate_frontier(
            &scenarios,
            &configurations,
            &mut |_logits, _epsilon, _temperature| {
                calls.set(calls.get() + 1);
                unreachable!("work preflight must reject before the kernel");
            },
        );
        assert_eq!(result, Err(FrontierError::ResourceLimitExceeded));
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn exact_enumeration_counts_match_ordered_prefixes() {
        assert_eq!(enumeration_counts(4, 2).unwrap().prefix_evaluations, 5);
        assert_eq!(
            enumeration_counts(4, 2).unwrap().probability_evaluations,
            16
        );
        assert_eq!(enumeration_counts(4, 2).unwrap().ordered_paths, 12);
    }

    #[test]
    fn worst_case_canonical_records_fit_declared_bounds() {
        const MAX_SCENARIO_ID: &str =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let point = FrontierPoint {
            epsilon: f64::MAX,
            temperature: f64::MAX,
            baseline_total_score: f64::MAX,
            expected_total_score: -f64::MAX,
            synthetic_utility_loss: f64::MAX,
            minimum_conditional_propensity: f64::MIN_POSITIVE,
            minimum_ordered_joint_propensity: f64::MIN_POSITIVE,
            maximum_inverse_ordered_joint_weight: f64::MAX,
            maximum_probability_mass_error: f64::MAX,
            pareto_frontier: true,
        };
        let point_bytes = canonical_json(&point).unwrap().len();
        assert!(point_bytes <= MAX_POINT_BYTES as usize);

        let scenario = FrontierScenarioReport {
            scenario_id: MAX_SCENARIO_ID,
            candidate_count: u32::MAX,
            slate_size: u32::MAX,
            points: Vec::new(),
        };
        let scenario_bytes = canonical_json(&scenario).unwrap().len();
        assert!(scenario_bytes <= MAX_SCENARIO_BYTES as usize);
    }
}
