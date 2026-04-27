use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_keywords,
    ranking_policy_number, source_retrieval_lane, space_feed_experiment_flag,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::helpers::{
    breakdown_value, build_stage, candidate_keyword_set, clamp01, freshness_multiplier,
    keyword_overlap_ratio, merge_breakdown,
};

pub(super) fn news_trend_link_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    let enabled = space_feed_experiment_flag(query, "enable_news_trend_link_scorer", true)
        && !trend_keywords.is_empty();
    if !enabled {
        return (
            candidates,
            build_stage("NewsTrendLinkScorer", input_count, false, None),
        );
    }

    let boost = ranking_policy_number(query, "news_trend_link_boost", 0.11).clamp(0.0, 0.32);
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let keyword_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
        let news_prior = if candidate.is_news == Some(true) {
            0.22
        } else {
            0.0
        };
        let trend_prior =
            breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength").max(
                breakdown_value(
                    candidate.score_breakdown.as_ref(),
                    "trendPersonalizationStrength",
                ),
            ) * 0.24;
        let strength = clamp01(keyword_match * 0.68 + news_prior + trend_prior);
        let multiplier = (1.0 + boost * strength).clamp(1.0, 1.14);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "newsTrendLinkMatch", keyword_match);
        merge_breakdown(candidate, "newsTrendLinkStrength", strength);
        merge_breakdown(candidate, "newsTrendLinkMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("NewsTrendLinkScorer", input_count, true, None),
    )
}

pub(super) fn trend_affinity_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    let enabled = space_feed_experiment_flag(query, "enable_trend_affinity_scorer", true)
        && !trend_keywords.is_empty();
    if !enabled {
        return (
            candidates,
            build_stage("TrendAffinityScorer", input_count, false, None),
        );
    }

    let boost = ranking_policy_number(query, "trend_source_boost", 0.16).clamp(0.0, 0.35);
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let trend_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
        if trend_match <= 0.0 {
            merge_breakdown(candidate, "trendAffinityMatch", 0.0);
            merge_breakdown(candidate, "trendAffinityMultiplier", 1.0);
            continue;
        }

        let lane = candidate.retrieval_lane.as_deref().unwrap_or_else(|| {
            source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or(""))
        });
        let lane_prior = match lane {
            INTEREST_LANE => 0.18,
            SOCIAL_EXPANSION_LANE => 0.12,
            FALLBACK_LANE => 0.08,
            _ => 0.04,
        };
        let news_prior = if candidate.is_news == Some(true) {
            0.12
        } else {
            0.0
        };
        let evidence_prior = candidate
            .recall_evidence
            .as_ref()
            .map(|evidence| evidence.confidence * 0.16)
            .unwrap_or_else(|| {
                breakdown_value(
                    candidate.score_breakdown.as_ref(),
                    "retrievalEvidenceConfidence",
                ) * 0.12
            });
        let freshness_prior = (freshness_multiplier(candidate) - 0.94).max(0.0) / 0.1 * 0.08;
        let strength = clamp01(
            trend_match * 0.62 + lane_prior + news_prior + evidence_prior + freshness_prior,
        );
        let multiplier = (1.0 + boost * strength).clamp(1.0, 1.16);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "trendAffinityMatch", trend_match);
        merge_breakdown(candidate, "trendAffinityStrength", strength);
        merge_breakdown(candidate, "trendAffinityMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("TrendAffinityScorer", input_count, true, None),
    )
}

pub(super) fn trend_personalization_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    let action_profile = UserActionProfile::from_query(query);
    let enabled = space_feed_experiment_flag(query, "enable_trend_personalization_scorer", true)
        && !trend_keywords.is_empty()
        && action_profile.action_count > 0;
    if !enabled {
        return (
            candidates,
            build_stage("TrendPersonalizationScorer", input_count, false, None),
        );
    }

    let boost = ranking_policy_number(query, "trend_source_boost", 0.16).clamp(0.0, 0.35);
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let trend_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
        if trend_match <= 0.0 {
            merge_breakdown(candidate, "trendPersonalizationMatch", 0.0);
            merge_breakdown(candidate, "trendPersonalizationStrength", 0.0);
            merge_breakdown(candidate, "trendPersonalizationMultiplier", 1.0);
            continue;
        }

        let action_match = action_profile.match_candidate(candidate);
        let personal_interest = clamp01(
            action_match.topic_affinity.max(0.0) * 0.56
                + action_match.author_affinity.max(0.0) * 0.18
                + action_match.source_affinity.max(0.0) * 0.16
                + action_match.conversation_affinity.max(0.0) * 0.1,
        );
        let interaction_confidence = clamp01((action_match.positive_actions.min(5) as f64) / 5.0);
        let negative_pressure = action_match.negative_feedback.max(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "negativeFeedbackStrength",
        ));
        let eligible = negative_pressure < 0.42;
        let strength = if eligible {
            clamp01(
                trend_match * 0.46 + personal_interest * 0.42 + interaction_confidence * 0.12
                    - negative_pressure * 0.36,
            )
        } else {
            0.0
        };
        let multiplier = (1.0 + boost * 0.9 * strength).clamp(1.0, 1.14);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "trendPersonalizationMatch", trend_match);
        merge_breakdown(candidate, "trendPersonalizationInterest", personal_interest);
        merge_breakdown(
            candidate,
            "trendPersonalizationInteractionConfidence",
            interaction_confidence,
        );
        merge_breakdown(
            candidate,
            "trendPersonalizationNegativePressure",
            negative_pressure,
        );
        merge_breakdown(candidate, "trendPersonalizationStrength", strength);
        merge_breakdown(candidate, "trendPersonalizationMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("TrendPersonalizationScorer", input_count, true, None),
    )
}
