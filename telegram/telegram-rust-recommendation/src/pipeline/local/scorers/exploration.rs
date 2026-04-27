use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_number,
    source_retrieval_lane, space_feed_experiment_flag,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::helpers::{
    breakdown_value, build_stage, clamp01, default_exploration_rate, exploration_risk,
    merge_breakdown, stable_unit_interval, user_state,
};

pub(super) fn exploration_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_exploration_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("ExplorationScorer", input_count, false, None),
        );
    }

    let action_profile = UserActionProfile::from_query(query);
    let temporal = action_profile.temporal_summary();
    let configured_rate = ranking_policy_number(
        query,
        "exploration_rate",
        default_exploration_rate(user_state(query)),
    )
    .clamp(0.0, 0.5);
    let risk_ceiling =
        ranking_policy_number(query, "exploration_risk_ceiling", 0.58).clamp(0.12, 0.92);
    for candidate in &mut candidates {
        let action_match = action_profile.match_candidate(candidate);
        let signals = candidate.ranking_signals.unwrap_or_default();
        let lane = candidate.retrieval_lane.as_deref().unwrap_or_else(|| {
            source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or(""))
        });
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
        let cold_start_relief = if user_state(query) == "cold_start" {
            0.22
        } else {
            0.0
        };
        let temporal_pressure =
            temporal.negative_pressure() * 0.28 + temporal.exposure_pressure() * 0.14;
        let temporal_interest = temporal.short_interest() * 0.18 + temporal.stable_interest() * 0.1;
        let risk = exploration_risk(candidate, action_match.negative_feedback);
        let trend_relief =
            breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength") * 0.08;
        let eligible = candidate.in_network != Some(true)
            && action_match.negative_feedback < 0.38
            && risk <= risk_ceiling
            && quality >= 0.42
            && novelty >= 0.32;
        let strength = if eligible {
            clamp01(
                configured_rate
                    * (novelty * 0.36
                        + quality * 0.24
                        + freshness * 0.14
                        + discovery_lane_prior * 0.18
                        + cold_start_relief
                        + temporal_interest
                        + trend_relief
                        - risk * 0.24
                        - temporal_pressure),
            )
        } else {
            0.0
        };
        let multiplier = (1.0 + strength).clamp(1.0, 1.16);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "explorationEligible", eligible as i32 as f64);
        merge_breakdown(candidate, "explorationRate", configured_rate);
        merge_breakdown(candidate, "explorationRisk", risk);
        merge_breakdown(candidate, "explorationRiskCeiling", risk_ceiling);
        merge_breakdown(candidate, "explorationNovelty", novelty);
        merge_breakdown(candidate, "explorationStrength", strength);
        merge_breakdown(candidate, "explorationMultiplier", multiplier);
        merge_breakdown(
            candidate,
            "temporalShortInterest",
            temporal.short_interest(),
        );
        merge_breakdown(
            candidate,
            "temporalStableInterest",
            temporal.stable_interest(),
        );
        merge_breakdown(
            candidate,
            "temporalNegativePressure",
            temporal.negative_pressure(),
        );
        merge_breakdown(
            candidate,
            "temporalExposurePressure",
            temporal.exposure_pressure(),
        );
    }

    (
        candidates,
        build_stage("ExplorationScorer", input_count, true, None),
    )
}

pub(super) fn bandit_exploration_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_bandit_exploration_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("BanditExplorationScorer", input_count, false, None),
        );
    }

    let epsilon = ranking_policy_number(query, "bandit_exploration_rate", 0.08).clamp(0.0, 0.35);
    let uncertainty_weight =
        ranking_policy_number(query, "bandit_uncertainty_weight", 0.3).clamp(0.0, 0.7);
    let risk_ceiling =
        ranking_policy_number(query, "exploration_risk_ceiling", 0.58).clamp(0.12, 0.92);
    for candidate in &mut candidates {
        let trials = (candidate.view_count.unwrap_or_default()
            + breakdown_value(candidate.score_breakdown.as_ref(), "retrievalSourceRank").max(1.0))
        .max(1.0);
        let rewards = candidate.like_count.unwrap_or_default()
            + candidate.comment_count.unwrap_or_default() * 1.8
            + candidate.repost_count.unwrap_or_default() * 2.4
            + candidate
                .action_scores
                .as_ref()
                .map(|scores| {
                    scores.like * 2.0 + scores.reply * 3.0 + scores.repost * 2.8 + scores.dwell
                })
                .unwrap_or_default();
        let posterior_mean = (1.0 + rewards).ln_1p() / (2.0 + trials).ln_1p();
        let uncertainty = (1.0 / (1.0 + trials.ln_1p())).clamp(0.0, 1.0);
        let deterministic_jitter = stable_unit_interval(&query.request_id, &candidate.post_id);
        let novelty = breakdown_value(candidate.score_breakdown.as_ref(), "explorationNovelty");
        let risk = exploration_risk(
            candidate,
            breakdown_value(
                candidate.score_breakdown.as_ref(),
                "negativeFeedbackStrength",
            ),
        );
        let trend_strength =
            breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength");
        let eligible = candidate.in_network != Some(true)
            && breakdown_value(
                candidate.score_breakdown.as_ref(),
                "negativeFeedbackStrength",
            ) < 0.45
            && risk <= risk_ceiling;
        let lift = if eligible {
            epsilon
                * (posterior_mean * 0.36
                    + uncertainty * uncertainty_weight
                    + novelty * 0.22
                    + trend_strength * 0.12
                    + deterministic_jitter * 0.12)
        } else {
            0.0
        };
        let multiplier = (1.0 + lift).clamp(1.0, 1.12);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "banditEligible", eligible as i32 as f64);
        merge_breakdown(candidate, "banditEpsilon", epsilon);
        merge_breakdown(candidate, "banditPosteriorMean", posterior_mean);
        merge_breakdown(candidate, "banditUncertainty", uncertainty);
        merge_breakdown(candidate, "banditUncertaintyWeight", uncertainty_weight);
        merge_breakdown(candidate, "banditRisk", risk);
        merge_breakdown(candidate, "banditJitter", deterministic_jitter);
        merge_breakdown(candidate, "banditMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("BanditExplorationScorer", input_count, true, None),
    )
}
