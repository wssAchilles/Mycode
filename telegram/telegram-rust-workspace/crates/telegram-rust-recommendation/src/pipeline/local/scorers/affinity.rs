use super::runner::ScoringContext;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    FALLBACK_LANE, ranking_policy_keywords, ranking_policy_number, space_feed_experiment_flag,
};
use crate::pipeline::local::signals::user_actions::TemporalActionSummary;
use telegram_component_primitives::scorers::{
    AUTHOR_AFFINITY_SCORER, COLD_START_INTEREST_SCORER, INTEREST_DECAY_SCORER,
};
use telegram_ranking_primitives::{
    AUTHOR_AFFINITY_SCORE_FIELD, INTEREST_DECAY_HALF_LIFE_HOURS_POLICY_KEY,
    INTEREST_DECAY_NEGATIVE_PRESSURE_FIELD, NEGATIVE_FEEDBACK_PENALTY_WEIGHT_POLICY_KEY,
    NEGATIVE_FEEDBACK_STRENGTH_FIELD, TREND_KEYWORDS_POLICY_KEY,
};

use super::helpers::{
    bootstrapped_cold_start_keywords, breakdown_value, build_stage, candidate_keyword_set, clamp01,
    keyword_overlap_ratio, merge_breakdown, user_state,
};

pub(super) fn author_affinity_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    if !author_affinity_enabled(ctx.query) {
        return (candidates, author_affinity_stage(input_count, false));
    }

    for candidate in &mut candidates {
        apply_author_affinity(ctx, candidate);
    }

    (candidates, author_affinity_stage(input_count, true))
}

pub(super) fn author_affinity_enabled(query: &RecommendationQueryPayload) -> bool {
    space_feed_experiment_flag(query, "enable_author_affinity_scorer", true)
        && query
            .user_action_sequence
            .as_ref()
            .is_some_and(|actions| !actions.is_empty())
}

pub(super) fn author_affinity_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(AUTHOR_AFFINITY_SCORER, input_count, enabled, None)
}

pub(super) fn apply_author_affinity(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
) {
    let action_match = ctx.action_profile().match_candidate(candidate);
    let affinity_score = (action_match.author_affinity * 0.58
        + action_match.topic_affinity * 0.18
        + action_match.source_affinity * 0.1
        + action_match.conversation_affinity * 0.14
        - action_match.negative_feedback * 0.72
        - action_match.delivery_fatigue * 0.18)
        .clamp(-1.0, 1.0);
    let positive_score = clamp01(
        action_match.author_affinity.max(0.0) * 0.58
            + action_match.topic_affinity.max(0.0) * 0.18
            + action_match.source_affinity.max(0.0) * 0.1
            + action_match.conversation_affinity.max(0.0) * 0.14,
    );
    let negative_score = action_match.negative_feedback;
    let multiplier = if affinity_score >= 0.45 {
        1.08 + affinity_score * 0.34
    } else if affinity_score > 0.0 {
        1.02 + affinity_score * 0.24
    } else if affinity_score < 0.0 {
        (1.0 + affinity_score * 0.72).max(0.35)
    } else {
        1.0
    };
    let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
    candidate.author_affinity_score = Some(affinity_score);
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, AUTHOR_AFFINITY_SCORE_FIELD, affinity_score);
    merge_breakdown(candidate, "authorAffinityPositiveScore", positive_score);
    merge_breakdown(candidate, "authorAffinityNegativeScore", negative_score);
    merge_breakdown(
        candidate,
        "authorAffinityPositiveActions",
        action_match.positive_actions as f64,
    );
    merge_breakdown(
        candidate,
        "authorAffinityNegativeActions",
        action_match.negative_actions as f64,
    );
    merge_breakdown(
        candidate,
        "authorAffinityTopicScore",
        action_match.topic_affinity,
    );
    merge_breakdown(
        candidate,
        "authorAffinitySourceScore",
        action_match.source_affinity,
    );
    merge_breakdown(
        candidate,
        "authorAffinityConversationScore",
        action_match.conversation_affinity,
    );
    merge_breakdown(
        candidate,
        "authorAffinityDeliveryFatigue",
        action_match.delivery_fatigue,
    );
    merge_breakdown(candidate, "authorAffinityMultiplier", multiplier);
}

pub(super) fn cold_start_interest_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let query = ctx.query;
    let input_count = candidates.len();
    let Some(plan) = cold_start_interest_plan(query) else {
        return (candidates, cold_start_interest_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_cold_start_interest(query, candidate, &plan);
    }

    (candidates, cold_start_interest_stage(input_count, true))
}

pub(super) struct ColdStartInterestPlan {
    policy_keywords: Vec<String>,
    trend_keywords: Vec<String>,
}

pub(super) fn cold_start_interest_plan(
    query: &RecommendationQueryPayload,
) -> Option<ColdStartInterestPlan> {
    (space_feed_experiment_flag(query, "enable_cold_start_interest_scorer", true)
        && user_state(query) == "cold_start")
        .then(|| ColdStartInterestPlan {
            policy_keywords: bootstrapped_cold_start_keywords(query),
            trend_keywords: ranking_policy_keywords(query, TREND_KEYWORDS_POLICY_KEY),
        })
}

pub(super) fn cold_start_interest_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(COLD_START_INTEREST_SCORER, input_count, enabled, None)
}

pub(super) fn apply_cold_start_interest(
    query: &RecommendationQueryPayload,
    candidate: &mut RecommendationCandidatePayload,
    plan: &ColdStartInterestPlan,
) {
    let candidate_keywords = candidate_keyword_set(candidate);
    let policy_match = keyword_overlap_ratio(&candidate_keywords, &plan.policy_keywords);
    let trend_match = keyword_overlap_ratio(&candidate_keywords, &plan.trend_keywords);
    let language_match = query.language_code.as_ref().is_some_and(|language| {
        let language = language.trim().to_lowercase();
        !language.is_empty()
            && candidate_keywords
                .iter()
                .any(|keyword| keyword == &language || keyword.contains(&language))
    });
    let news_prior = if candidate.is_news == Some(true) {
        0.08
    } else {
        0.0
    };
    let fallback_prior = if candidate.retrieval_lane.as_deref() == Some(FALLBACK_LANE) {
        0.06
    } else {
        0.0
    };
    let strength = clamp01(
        policy_match * 0.46
            + trend_match * 0.28
            + (language_match as i32 as f64) * 0.08
            + news_prior
            + fallback_prior,
    );
    let multiplier = 1.0 + strength.min(0.28);
    let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "coldStartInterestStrength", strength);
    merge_breakdown(candidate, "coldStartInterestPolicyMatch", policy_match);
    merge_breakdown(candidate, "coldStartInterestTrendMatch", trend_match);
    merge_breakdown(candidate, "coldStartInterestMultiplier", multiplier);
}

pub(super) fn interest_decay_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let Some(plan) = interest_decay_plan(ctx) else {
        return (candidates, interest_decay_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_interest_decay(ctx, candidate, &plan);
    }

    (candidates, interest_decay_stage(input_count, true))
}

pub(super) struct InterestDecayPlan {
    temporal: TemporalActionSummary,
    half_life_hours: f64,
    short_memory_weight: f64,
    negative_weight: f64,
}

pub(super) fn interest_decay_plan(ctx: &ScoringContext) -> Option<InterestDecayPlan> {
    let action_profile = ctx.action_profile();
    (space_feed_experiment_flag(ctx.query, "enable_interest_decay_scorer", true)
        && action_profile.action_count > 0)
        .then(|| {
            let half_life_hours =
                ranking_policy_number(ctx.query, INTEREST_DECAY_HALF_LIFE_HOURS_POLICY_KEY, 18.0)
                    .clamp(2.0, 168.0);

            InterestDecayPlan {
                temporal: action_profile.temporal_summary(),
                half_life_hours,
                short_memory_weight: (18.0 / half_life_hours).clamp(0.35, 1.45),
                negative_weight: ranking_policy_number(
                    ctx.query,
                    NEGATIVE_FEEDBACK_PENALTY_WEIGHT_POLICY_KEY,
                    0.22,
                )
                .clamp(0.0, 0.72),
            }
        })
}

pub(super) fn interest_decay_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(INTEREST_DECAY_SCORER, input_count, enabled, None)
}

pub(super) fn apply_interest_decay(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &InterestDecayPlan,
) {
    let action_match = ctx.action_profile().match_candidate(candidate);
    let direct_negative = breakdown_value(
        candidate.score_breakdown.as_ref(),
        NEGATIVE_FEEDBACK_STRENGTH_FIELD,
    )
    .max(breakdown_value(
        candidate.score_breakdown.as_ref(),
        "earlySuppressionStrength",
    ));
    let short_interest = plan.temporal.short_interest();
    let stable_interest = plan.temporal.stable_interest();
    let negative_pressure = plan
        .temporal
        .negative_pressure()
        .max(action_match.negative_feedback);
    let exposure_pressure = plan
        .temporal
        .exposure_pressure()
        .max(action_match.delivery_fatigue * 0.72);
    let candidate_interest = clamp01(
        action_match.personalized_strength * 0.52
            + action_match.topic_affinity.max(0.0) * 0.22
            + action_match.author_affinity.max(0.0) * 0.18
            + action_match.source_affinity.max(0.0) * 0.08,
    );
    let positive_lift = (candidate_interest * 0.1
        + short_interest * 0.045 * plan.short_memory_weight
        + stable_interest * 0.035)
        .min(0.16);
    let negative_penalty = (negative_pressure * plan.negative_weight
        + direct_negative * plan.negative_weight * 0.72
        + exposure_pressure * 0.055)
        .clamp(0.0, 0.42);
    let multiplier = (1.0 + positive_lift - negative_penalty).clamp(0.54, 1.16);
    let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(
        candidate,
        "interestDecayCandidateInterest",
        candidate_interest,
    );
    merge_breakdown(candidate, "interestDecayShortInterest", short_interest);
    merge_breakdown(candidate, "interestDecayStableInterest", stable_interest);
    merge_breakdown(
        candidate,
        INTEREST_DECAY_NEGATIVE_PRESSURE_FIELD,
        negative_pressure,
    );
    merge_breakdown(
        candidate,
        "interestDecayExposurePressure",
        exposure_pressure,
    );
    merge_breakdown(candidate, "interestDecayPositiveLift", positive_lift);
    merge_breakdown(candidate, "interestDecayNegativePenalty", negative_penalty);
    merge_breakdown(
        candidate,
        "interestDecayHalfLifeHours",
        plan.half_life_hours,
    );
    merge_breakdown(candidate, "interestDecayMultiplier", multiplier);
}
