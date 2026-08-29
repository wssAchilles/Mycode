use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_number,
    source_retrieval_lane, space_feed_experiment_flag,
};
use crate::pipeline::local::signals::user_actions::TemporalActionSummary;
use telegram_component_primitives::scorers::{BANDIT_EXPLORATION_SCORER, EXPLORATION_SCORER};
use telegram_ranking_primitives::{
    BANDIT_EXPLORATION_RATE_POLICY_KEY, BANDIT_UNCERTAINTY_WEIGHT_POLICY_KEY,
    EXPLORATION_ELIGIBLE_FIELD, EXPLORATION_RATE_POLICY_KEY, EXPLORATION_RISK_CEILING_POLICY_KEY,
    NEGATIVE_FEEDBACK_STRENGTH_FIELD, TREND_AFFINITY_STRENGTH_FIELD,
};

/// Thompson Sampling using Beta distribution approximation
fn thompson_sample(successes: f64, failures: f64, jitter: f64) -> f64 {
    let alpha = 1.0 + finite_nonnegative(successes);
    let beta_val = 1.0 + finite_nonnegative(failures);
    let scale = alpha.max(beta_val);
    let alpha_scaled = alpha / scale;
    let beta_scaled = beta_val / scale;
    let scaled_total = alpha_scaled + beta_scaled;
    let mean = alpha_scaled / scaled_total;
    let inverse_scale = 1.0 / scale;
    let variance = (alpha_scaled * beta_scaled / scaled_total.powi(2))
        * (inverse_scale / (scaled_total + inverse_scale));
    let stddev: f64 = variance.sqrt();
    let z_score: f64 = (jitter * 6.0) - 3.0;
    (mean + z_score * stddev).clamp(0.0, 1.0)
}

fn finite_nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn finite_nonnegative_product(value: f64, multiplier: f64) -> f64 {
    let product = finite_nonnegative(value) * multiplier;
    if product.is_finite() {
        product
    } else {
        f64::MAX
    }
}

fn finite_nonnegative_sum(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(0.0, |total, value| {
        let sum = total + finite_nonnegative(value);
        if sum.is_finite() { sum } else { f64::MAX }
    })
}

use super::helpers::{
    breakdown_value, build_stage, clamp01, default_exploration_rate, exploration_risk,
    finite_score_product, merge_breakdown, stable_unit_interval, user_state,
};

pub(super) fn exploration_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let Some(plan) = exploration_plan(ctx) else {
        return (candidates, exploration_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_exploration(ctx, candidate, &plan);
    }

    (candidates, exploration_stage(input_count, true))
}

pub(super) struct ExplorationPlan {
    temporal: TemporalActionSummary,
    configured_rate: f64,
    risk_ceiling: f64,
    cold_start_relief: f64,
}

pub(super) fn exploration_plan(ctx: &ScoringContext) -> Option<ExplorationPlan> {
    space_feed_experiment_flag(ctx.query, "enable_exploration_scorer", true).then(|| {
        let temporal = ctx.action_profile().temporal_summary();
        ExplorationPlan {
            temporal,
            configured_rate: ranking_policy_number(
                ctx.query,
                EXPLORATION_RATE_POLICY_KEY,
                default_exploration_rate(user_state(ctx.query)),
            )
            .clamp(0.0, 0.5),
            risk_ceiling: ranking_policy_number(
                ctx.query,
                EXPLORATION_RISK_CEILING_POLICY_KEY,
                0.58,
            )
            .clamp(0.12, 0.92),
            cold_start_relief: if user_state(ctx.query) == "cold_start" {
                0.22
            } else {
                0.0
            },
        }
    })
}

pub(super) fn exploration_stage(input_count: usize, enabled: bool) -> RecommendationStagePayload {
    build_stage(EXPLORATION_SCORER, input_count, enabled, None)
}

pub(super) fn apply_exploration(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &ExplorationPlan,
) {
    let action_match = ctx.action_profile().match_candidate(candidate);
    let signals = candidate.ranking_signals.unwrap_or_default();
    let lane = candidate
        .retrieval_lane
        .as_deref()
        .unwrap_or_else(|| source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")));
    let novelty = clamp01(
        1.0 - action_match.author_affinity.max(0.0) * 0.36
            - action_match.topic_affinity.max(0.0) * 0.32
            - action_match.source_affinity.max(0.0) * 0.16
            - action_match.conversation_affinity.max(0.0) * 0.16,
    );
    let quality = signals.quality.max(breakdown_value(
        candidate.score_breakdown.as_ref(),
        "contentQuality",
    ));
    let freshness = signals.freshness.max(breakdown_value(
        candidate.score_breakdown.as_ref(),
        "rankingFreshness",
    ));
    let discovery_lane_prior = match lane {
        FALLBACK_LANE => 0.82,
        INTEREST_LANE => 0.68,
        SOCIAL_EXPANSION_LANE => 0.48,
        _ => 0.24,
    };
    let temporal_pressure =
        plan.temporal.negative_pressure() * 0.28 + plan.temporal.exposure_pressure() * 0.14;
    let temporal_interest =
        plan.temporal.short_interest() * 0.18 + plan.temporal.stable_interest() * 0.1;
    let risk = exploration_risk(candidate, action_match.negative_feedback);
    let trend_relief = breakdown_value(
        candidate.score_breakdown.as_ref(),
        TREND_AFFINITY_STRENGTH_FIELD,
    ) * 0.08;
    let eligible = candidate.in_network != Some(true)
        && action_match.negative_feedback < 0.38
        && risk <= plan.risk_ceiling
        && quality >= 0.42
        && novelty >= 0.32;
    let strength = if eligible {
        clamp01(
            plan.configured_rate
                * (novelty * 0.36
                    + quality * 0.24
                    + freshness * 0.14
                    + discovery_lane_prior * 0.18
                    + plan.cold_start_relief
                    + temporal_interest
                    + trend_relief
                    - risk * 0.24
                    - temporal_pressure),
        )
    } else {
        0.0
    };
    let multiplier = (1.0 + strength).clamp(1.0, 1.16);
    let adjusted = finite_score_product(candidate.weighted_score.unwrap_or_default(), multiplier);
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(
        candidate,
        EXPLORATION_ELIGIBLE_FIELD,
        eligible as i32 as f64,
    );
    merge_breakdown(candidate, "explorationRate", plan.configured_rate);
    merge_breakdown(candidate, "explorationRisk", risk);
    merge_breakdown(candidate, "explorationRiskCeiling", plan.risk_ceiling);
    merge_breakdown(candidate, "explorationNovelty", novelty);
    merge_breakdown(candidate, "explorationStrength", strength);
    merge_breakdown(candidate, "explorationMultiplier", multiplier);
    merge_breakdown(
        candidate,
        "temporalShortInterest",
        plan.temporal.short_interest(),
    );
    merge_breakdown(
        candidate,
        "temporalStableInterest",
        plan.temporal.stable_interest(),
    );
    merge_breakdown(
        candidate,
        "temporalNegativePressure",
        plan.temporal.negative_pressure(),
    );
    merge_breakdown(
        candidate,
        "temporalExposurePressure",
        plan.temporal.exposure_pressure(),
    );
}

pub(super) fn bandit_exploration_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let Some(plan) = bandit_exploration_plan(ctx) else {
        return (candidates, bandit_exploration_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_bandit_exploration(ctx, candidate, &plan);
    }

    (candidates, bandit_exploration_stage(input_count, true))
}

pub(super) struct BanditExplorationPlan {
    epsilon: f64,
    uncertainty_weight: f64,
    risk_ceiling: f64,
}

pub(super) fn bandit_exploration_plan(ctx: &ScoringContext) -> Option<BanditExplorationPlan> {
    space_feed_experiment_flag(ctx.query, "enable_bandit_exploration_scorer", true).then(|| {
        BanditExplorationPlan {
            epsilon: ranking_policy_number(ctx.query, BANDIT_EXPLORATION_RATE_POLICY_KEY, 0.08)
                .clamp(0.0, 0.35),
            uncertainty_weight: ranking_policy_number(
                ctx.query,
                BANDIT_UNCERTAINTY_WEIGHT_POLICY_KEY,
                0.3,
            )
            .clamp(0.0, 0.7),
            risk_ceiling: ranking_policy_number(
                ctx.query,
                EXPLORATION_RISK_CEILING_POLICY_KEY,
                0.58,
            )
            .clamp(0.12, 0.92),
        }
    })
}

pub(super) fn bandit_exploration_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(BANDIT_EXPLORATION_SCORER, input_count, enabled, None)
}

pub(super) fn apply_bandit_exploration(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &BanditExplorationPlan,
) {
    let trials = finite_nonnegative_sum([
        finite_nonnegative(candidate.view_count.unwrap_or_default()),
        finite_nonnegative(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "retrievalSourceRank",
        ))
        .max(1.0),
    ])
    .max(1.0);
    let action_rewards = candidate.action_scores.as_ref().map(|scores| {
        finite_nonnegative_sum([
            finite_nonnegative_product(scores.like, 2.0),
            finite_nonnegative_product(scores.reply, 3.0),
            finite_nonnegative_product(scores.repost, 2.8),
            finite_nonnegative(scores.dwell),
        ])
    });
    let positive_rewards = finite_nonnegative_sum([
        finite_nonnegative(candidate.like_count.unwrap_or_default()),
        finite_nonnegative_product(candidate.comment_count.unwrap_or_default(), 1.8),
        finite_nonnegative_product(candidate.repost_count.unwrap_or_default(), 2.4),
        action_rewards.unwrap_or_default(),
    ]);
    let negative_rewards = finite_nonnegative_product(
        finite_nonnegative_product(
            breakdown_value(
                candidate.score_breakdown.as_ref(),
                NEGATIVE_FEEDBACK_STRENGTH_FIELD,
            ),
            trials,
        ),
        0.5,
    );

    // Thompson Sampling: sample from Beta(alpha, beta) distribution
    let deterministic_jitter = stable_unit_interval(&ctx.query.request_id, &candidate.post_id);
    let thompson_value = thompson_sample(positive_rewards, negative_rewards, deterministic_jitter);

    let posterior_mean = (1.0 + positive_rewards).ln_1p() / (2.0 + trials).ln_1p();
    let uncertainty = (1.0 / (1.0 + trials.ln_1p())).clamp(0.0, 1.0);
    let novelty = breakdown_value(candidate.score_breakdown.as_ref(), "explorationNovelty");
    let risk = exploration_risk(
        candidate,
        breakdown_value(
            candidate.score_breakdown.as_ref(),
            NEGATIVE_FEEDBACK_STRENGTH_FIELD,
        ),
    );
    let trend_strength = breakdown_value(
        candidate.score_breakdown.as_ref(),
        TREND_AFFINITY_STRENGTH_FIELD,
    );
    let eligible = candidate.in_network != Some(true)
        && breakdown_value(
            candidate.score_breakdown.as_ref(),
            NEGATIVE_FEEDBACK_STRENGTH_FIELD,
        ) < 0.45
        && risk <= plan.risk_ceiling;

    // Thompson Sampling decides exploration vs exploitation
    // If thompson_value > posterior_mean, explore more (favor uncertain candidates)
    let exploration_bonus = if thompson_value > posterior_mean {
        (thompson_value - posterior_mean) * uncertainty * 2.0
    } else {
        0.0
    };

    let lift = if eligible {
        plan.epsilon
            * (thompson_value * 0.32
                + exploration_bonus * plan.uncertainty_weight
                + novelty * 0.22
                + trend_strength * 0.12
                + deterministic_jitter * 0.06)
    } else {
        0.0
    };
    let multiplier = (1.0 + lift).clamp(1.0, 1.14);
    let adjusted = finite_score_product(candidate.weighted_score.unwrap_or_default(), multiplier);
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "banditEligible", eligible as i32 as f64);
    merge_breakdown(candidate, "banditEpsilon", plan.epsilon);
    merge_breakdown(candidate, "banditThompsonValue", thompson_value);
    merge_breakdown(candidate, "banditExplorationBonus", exploration_bonus);
    merge_breakdown(candidate, "banditPosteriorMean", posterior_mean);
    merge_breakdown(candidate, "banditUncertainty", uncertainty);
    merge_breakdown(
        candidate,
        "banditUncertaintyWeight",
        plan.uncertainty_weight,
    );
    merge_breakdown(candidate, "banditRisk", risk);
    merge_breakdown(candidate, "banditJitter", deterministic_jitter);
    merge_breakdown(candidate, "banditMultiplier", multiplier);
}

#[cfg(test)]
mod tests {
    use super::{finite_nonnegative, finite_nonnegative_sum, thompson_sample};

    #[test]
    fn bandit_arithmetic_stays_finite_for_extreme_rewards() {
        let alpha = 4.0_f64;
        let beta = 3.0_f64;
        let expected = alpha / (alpha + beta)
            + 1.5 * ((alpha * beta) / ((alpha + beta).powi(2) * (alpha + beta + 1.0))).sqrt();
        assert!((thompson_sample(3.0, 2.0, 0.75) - expected).abs() < f64::EPSILON);

        let sample = thompson_sample(f64::MAX, f64::MAX, 0.5);
        assert!(sample.is_finite());
        assert!((0.0..=1.0).contains(&sample));
        assert_eq!(finite_nonnegative_sum([f64::MAX, f64::MAX]), f64::MAX);
        assert_eq!(finite_nonnegative(-1.0), 0.0);
        assert_eq!(finite_nonnegative(f64::NAN), 0.0);
        assert_eq!(finite_nonnegative(f64::INFINITY), 0.0);
    }
}
