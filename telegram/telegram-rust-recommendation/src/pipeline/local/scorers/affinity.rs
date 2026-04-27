use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    FALLBACK_LANE, ranking_policy_keywords, ranking_policy_number, space_feed_experiment_flag,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::helpers::{
    bootstrapped_cold_start_keywords, breakdown_value, build_stage, candidate_keyword_set, clamp01,
    keyword_overlap_ratio, merge_breakdown, user_state,
};

pub(super) fn author_affinity_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_author_affinity_scorer", true)
        && query
            .user_action_sequence
            .as_ref()
            .is_some_and(|actions| !actions.is_empty());
    if !enabled {
        return (
            candidates,
            build_stage("AuthorAffinityScorer", input_count, false, None),
        );
    }

    let action_profile = UserActionProfile::from_query(query);
    for candidate in &mut candidates {
        let action_match = action_profile.match_candidate(candidate);
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
        merge_breakdown(candidate, "authorAffinityScore", affinity_score);
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

    (
        candidates,
        build_stage("AuthorAffinityScorer", input_count, true, None),
    )
}

pub(super) fn cold_start_interest_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_cold_start_interest_scorer", true)
        && user_state(query) == "cold_start";
    if !enabled {
        return (
            candidates,
            build_stage("ColdStartInterestScorer", input_count, false, None),
        );
    }

    let policy_keywords = bootstrapped_cold_start_keywords(query);
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let policy_match = keyword_overlap_ratio(&candidate_keywords, &policy_keywords);
        let trend_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
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

    (
        candidates,
        build_stage("ColdStartInterestScorer", input_count, true, None),
    )
}

pub(super) fn interest_decay_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let action_profile = UserActionProfile::from_query(query);
    let enabled = space_feed_experiment_flag(query, "enable_interest_decay_scorer", true)
        && action_profile.action_count > 0;
    if !enabled {
        return (
            candidates,
            build_stage("InterestDecayScorer", input_count, false, None),
        );
    }

    let temporal = action_profile.temporal_summary();
    let half_life_hours =
        ranking_policy_number(query, "interest_decay_half_life_hours", 18.0).clamp(2.0, 168.0);
    let short_memory_weight = (18.0 / half_life_hours).clamp(0.35, 1.45);
    let negative_weight =
        ranking_policy_number(query, "negative_feedback_penalty_weight", 0.22).clamp(0.0, 0.72);

    for candidate in &mut candidates {
        let action_match = action_profile.match_candidate(candidate);
        let direct_negative = breakdown_value(
            candidate.score_breakdown.as_ref(),
            "negativeFeedbackStrength",
        )
        .max(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "earlySuppressionStrength",
        ));
        let short_interest = temporal.short_interest();
        let stable_interest = temporal.stable_interest();
        let negative_pressure = temporal
            .negative_pressure()
            .max(action_match.negative_feedback);
        let exposure_pressure = temporal
            .exposure_pressure()
            .max(action_match.delivery_fatigue * 0.72);
        let candidate_interest = clamp01(
            action_match.personalized_strength * 0.52
                + action_match.topic_affinity.max(0.0) * 0.22
                + action_match.author_affinity.max(0.0) * 0.18
                + action_match.source_affinity.max(0.0) * 0.08,
        );
        let positive_lift = (candidate_interest * 0.1
            + short_interest * 0.045 * short_memory_weight
            + stable_interest * 0.035)
            .min(0.16);
        let negative_penalty = (negative_pressure * negative_weight
            + direct_negative * negative_weight * 0.72
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
            "interestDecayNegativePressure",
            negative_pressure,
        );
        merge_breakdown(
            candidate,
            "interestDecayExposurePressure",
            exposure_pressure,
        );
        merge_breakdown(candidate, "interestDecayPositiveLift", positive_lift);
        merge_breakdown(candidate, "interestDecayNegativePenalty", negative_penalty);
        merge_breakdown(candidate, "interestDecayHalfLifeHours", half_life_hours);
        merge_breakdown(candidate, "interestDecayMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("InterestDecayScorer", input_count, true, None),
    )
}
