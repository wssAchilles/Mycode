use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::context::{
    ranking_policy_keywords, ranking_policy_number, related_post_ids, space_feed_experiment_flag,
};
use crate::pipeline::local::signals::user_actions::TemporalActionSummary;
use telegram_component_primitives::scorers::{FATIGUE_SCORER, SESSION_SUPPRESSION_SCORER};
use telegram_ranking_primitives::{
    FATIGUE_NEGATIVE_FEEDBACK_FIELD, FATIGUE_STRENGTH_FIELD,
    SEMANTIC_DEDUP_OVERLAP_THRESHOLD_POLICY_KEY, SESSION_TOPIC_SUPPRESSION_WEIGHT_POLICY_KEY,
    TREND_KEYWORDS_POLICY_KEY,
};

use super::helpers::{
    build_stage, candidate_keyword_set, clamp01, cross_page_pressure, keyword_overlap_ratio,
    merge_breakdown, recent_action_token_overlap, request_source_key, request_topic_key,
    served_context_count,
};

pub(super) fn fatigue_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let Some(plan) = fatigue_plan(ctx) else {
        return (candidates, fatigue_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_fatigue(ctx, candidate, &plan);
    }

    (candidates, fatigue_stage(input_count, true))
}

pub(super) struct FatiguePlan {
    temporal: TemporalActionSummary,
}

pub(super) fn fatigue_plan(ctx: &ScoringContext) -> Option<FatiguePlan> {
    space_feed_experiment_flag(ctx.query, "enable_fatigue_scorer", true).then(|| FatiguePlan {
        temporal: ctx.action_profile().temporal_summary(),
    })
}

pub(super) fn fatigue_stage(input_count: usize, enabled: bool) -> RecommendationStagePayload {
    build_stage(FATIGUE_SCORER, input_count, enabled, None)
}

pub(super) fn apply_fatigue(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &FatiguePlan,
) {
    let action_match = ctx.action_profile().match_candidate(candidate);
    let cross_page_pressure = cross_page_pressure(ctx.query, candidate);
    let fatigue_strength = clamp01(
        action_match.delivery_fatigue * 0.58
            + action_match.negative_feedback * 0.2
            + plan.temporal.exposure_pressure() * 0.12
            + cross_page_pressure * 0.1,
    );
    let multiplier = (1.0 - fatigue_strength * 0.34).clamp(0.6, 1.0);
    let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, FATIGUE_STRENGTH_FIELD, fatigue_strength);
    merge_breakdown(candidate, "fatigueDelivery", action_match.delivery_fatigue);
    merge_breakdown(
        candidate,
        FATIGUE_NEGATIVE_FEEDBACK_FIELD,
        action_match.negative_feedback,
    );
    merge_breakdown(candidate, "fatigueCrossPagePressure", cross_page_pressure);
    merge_breakdown(candidate, "fatigueMultiplier", multiplier);
}

pub(super) fn session_suppression_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let Some(plan) = session_suppression_plan(ctx) else {
        return (candidates, session_suppression_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_session_suppression(ctx, candidate, &plan);
    }

    (candidates, session_suppression_stage(input_count, true))
}

pub(super) struct SessionSuppressionPlan {
    semantic_threshold: f64,
    topic_weight: f64,
    trend_keywords: Vec<String>,
}

pub(super) fn session_suppression_plan(ctx: &ScoringContext) -> Option<SessionSuppressionPlan> {
    space_feed_experiment_flag(ctx.query, "enable_session_suppression_scorer", true).then(|| {
        SessionSuppressionPlan {
            semantic_threshold: ranking_policy_number(
                ctx.query,
                SEMANTIC_DEDUP_OVERLAP_THRESHOLD_POLICY_KEY,
                0.62,
            )
            .clamp(0.2, 0.95),
            topic_weight: ranking_policy_number(
                ctx.query,
                SESSION_TOPIC_SUPPRESSION_WEIGHT_POLICY_KEY,
                0.2,
            )
            .clamp(0.0, 0.5),
            trend_keywords: ranking_policy_keywords(ctx.query, TREND_KEYWORDS_POLICY_KEY),
        }
    })
}

pub(super) fn session_suppression_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(SESSION_SUPPRESSION_SCORER, input_count, enabled, None)
}

pub(super) fn apply_session_suppression(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &SessionSuppressionPlan,
) {
    let query = ctx.query;
    let semantic_overlap = recent_action_token_overlap(query, candidate);
    let semantic_suppression = if semantic_overlap >= plan.semantic_threshold {
        ((semantic_overlap - plan.semantic_threshold) / (1.0 - plan.semantic_threshold))
            .clamp(0.0, 1.0)
    } else {
        0.0
    };
    let served_related = related_post_ids(candidate)
        .into_iter()
        .filter(|id| query.served_ids.contains(id) || query.seen_ids.contains(id))
        .count() as f64;
    let author_served = query
        .served_ids
        .iter()
        .filter(|id| id.as_str() == candidate.author_id)
        .count() as f64
        + served_context_count(query, "author:", &candidate.author_id) as f64;
    let topic_served = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
        .map(|cluster_id| format!("news:cluster:{cluster_id}"))
        .map(|key| query.served_ids.iter().filter(|id| *id == &key).count() as f64)
        .unwrap_or_default()
        + served_context_count(query, "topic:", &request_topic_key(candidate)) as f64;
    let source_served =
        served_context_count(query, "source:", &request_source_key(candidate)) as f64;
    let trend_topic_match =
        keyword_overlap_ratio(&candidate_keyword_set(candidate), &plan.trend_keywords);
    let trend_topic_pressure = if trend_topic_match > 0.0 && topic_served > 0.0 {
        trend_topic_match * 0.1
    } else {
        0.0
    };
    let suppression = clamp01(
        served_related * 0.34
            + author_served * 0.08
            + topic_served * 0.18
            + source_served * 0.05
            + semantic_suppression * plan.topic_weight
            + trend_topic_pressure,
    );
    let multiplier = (1.0 - suppression * 0.42).clamp(0.58, 1.0);
    let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "sessionSuppressionStrength", suppression);
    merge_breakdown(candidate, "sessionSemanticOverlap", semantic_overlap);
    merge_breakdown(
        candidate,
        "sessionSemanticSuppression",
        semantic_suppression,
    );
    merge_breakdown(candidate, "sessionTrendTopicPressure", trend_topic_pressure);
    merge_breakdown(candidate, "sessionAuthorServedCount", author_served);
    merge_breakdown(candidate, "sessionTopicServedCount", topic_served);
    merge_breakdown(candidate, "sessionSourceServedCount", source_served);
    merge_breakdown(candidate, "sessionSuppressionMultiplier", multiplier);
}
