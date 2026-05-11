use chrono::Utc;

use super::runner::ScoringContext;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_number,
    source_mixing_multiplier, source_retrieval_lane, space_feed_experiment_flag,
};
use crate::pipeline::local::scoring::calibration::calibration_table_adjustment;
use telegram_component_primitives::scorers::{
    CONTENT_QUALITY_SCORER, RECENCY_SCORER, SCORE_CALIBRATION_SCORER,
};
use telegram_ranking_primitives::{
    FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY, NEGATIVE_FEEDBACK_STRENGTH_FIELD,
};

use super::helpers::{
    build_stage, clamp01, compute_content_quality, direct_negative_feedback, early_suppression,
    engagement_multiplier, evidence_multiplier, freshness_multiplier, merge_breakdown,
};

pub(super) fn score_calibration_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let query = ctx.query;
    let input_count = candidates.len();
    let enabled = score_calibration_enabled(query);
    if !enabled {
        return (candidates, score_calibration_stage(input_count, false));
    }

    for candidate in &mut candidates {
        apply_score_calibration(ctx, candidate);
    }

    (candidates, score_calibration_stage(input_count, true))
}

pub(super) fn score_calibration_enabled(query: &RecommendationQueryPayload) -> bool {
    space_feed_experiment_flag(query, "enable_score_calibration_scorer", true)
}

pub(super) fn score_calibration_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(SCORE_CALIBRATION_SCORER, input_count, enabled, None)
}

pub(super) fn apply_score_calibration(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
) {
    let query = ctx.query;
    let current = candidate.weighted_score.unwrap_or_default();
    let action_match = ctx.action_profile().match_candidate(candidate);
    let source_multiplier = calibration_source_multiplier(query, candidate);
    let quality_multiplier = match query.embedding_context.as_ref() {
        None => 0.97,
        Some(context) if !context.usable => 0.95,
        Some(context) if context.stale.unwrap_or(false) => {
            0.94 + clamp01(context.quality_score.unwrap_or_default()) * 0.05
        }
        Some(context) => 0.96 + clamp01(context.quality_score.unwrap_or_default()) * 0.08,
    };
    let freshness_multiplier = freshness_multiplier(candidate);
    let engagement_multiplier = engagement_multiplier(candidate);
    let evidence_multiplier = evidence_multiplier(candidate);
    let early_suppression = early_suppression(query, candidate);
    let negative_feedback = direct_negative_feedback(query, candidate);
    let behavior_multiplier = (1.0 + action_match.personalized_strength * 0.14
        - action_match.negative_feedback * 0.22
        - action_match.delivery_fatigue * 0.08)
        .clamp(0.72, 1.18);
    let calibration_table = calibration_table_adjustment(query, candidate, action_match);
    let user_state_multiplier = match query
        .user_state_context
        .as_ref()
        .map(|state| state.state.as_str())
    {
        Some("cold_start") => 0.97,
        Some("sparse") => 0.99,
        Some("heavy") => 1.02,
        _ => 1.0,
    };
    let adjusted = current
        * source_multiplier
        * quality_multiplier
        * freshness_multiplier
        * engagement_multiplier
        * evidence_multiplier
        * early_suppression.multiplier
        * negative_feedback.multiplier
        * behavior_multiplier
        * calibration_table.multiplier
        * user_state_multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "calibrationSourceMultiplier", source_multiplier);
    merge_breakdown(
        candidate,
        "calibrationEmbeddingQualityMultiplier",
        quality_multiplier,
    );
    merge_breakdown(
        candidate,
        "calibrationFreshnessMultiplier",
        freshness_multiplier,
    );
    merge_breakdown(
        candidate,
        "calibrationEngagementMultiplier",
        engagement_multiplier,
    );
    merge_breakdown(
        candidate,
        "calibrationEvidenceMultiplier",
        evidence_multiplier,
    );
    merge_breakdown(
        candidate,
        "earlySuppressionStrength",
        early_suppression.strength,
    );
    merge_breakdown(
        candidate,
        "earlySuppressionMultiplier",
        early_suppression.multiplier,
    );
    merge_breakdown(
        candidate,
        NEGATIVE_FEEDBACK_STRENGTH_FIELD,
        negative_feedback.strength,
    );
    merge_breakdown(
        candidate,
        "negativeFeedbackMultiplier",
        negative_feedback.multiplier,
    );
    merge_breakdown(
        candidate,
        "calibrationBehaviorMultiplier",
        behavior_multiplier,
    );
    merge_breakdown(
        candidate,
        "calibrationTableMultiplier",
        calibration_table.multiplier,
    );
    merge_breakdown(
        candidate,
        "calibrationLanePrior",
        calibration_table.lane_prior,
    );
    merge_breakdown(
        candidate,
        "calibrationSourcePrior",
        calibration_table.source_prior,
    );
    merge_breakdown(
        candidate,
        "calibrationEngagementPrior",
        calibration_table.engagement_prior,
    );
    merge_breakdown(
        candidate,
        "calibrationQualityPrior",
        calibration_table.quality_prior,
    );
    merge_breakdown(
        candidate,
        "calibrationBehaviorPrior",
        calibration_table.behavior_prior,
    );
    merge_breakdown(
        candidate,
        "calibrationPersonalizedStrength",
        action_match.personalized_strength,
    );
    merge_breakdown(
        candidate,
        "calibrationDeliveryFatigue",
        action_match.delivery_fatigue,
    );
    merge_breakdown(
        candidate,
        "calibrationUserStateMultiplier",
        user_state_multiplier,
    );
}

pub(super) fn content_quality_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let query = ctx.query;
    let input_count = candidates.len();
    let enabled = content_quality_enabled(query);
    if !enabled {
        return (candidates, content_quality_stage(input_count, false));
    }

    for candidate in &mut candidates {
        apply_content_quality(candidate);
    }

    (candidates, content_quality_stage(input_count, true))
}

pub(super) fn content_quality_enabled(query: &RecommendationQueryPayload) -> bool {
    space_feed_experiment_flag(query, "enable_content_quality_scorer", true)
}

pub(super) fn content_quality_stage(
    input_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    build_stage(CONTENT_QUALITY_SCORER, input_count, enabled, None)
}

pub(super) fn apply_content_quality(candidate: &mut RecommendationCandidatePayload) {
    let quality = compute_content_quality(candidate);
    let adjusted = candidate.weighted_score.unwrap_or_default()
        * (0.82 + quality.score * 0.36)
        * (1.0 - quality.low_quality_penalty * 0.18);
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "contentQuality", quality.score);
    merge_breakdown(candidate, "contentQualityPrior", quality.quality_prior);
    merge_breakdown(
        candidate,
        "contentEngagementPrior",
        quality.engagement_prior,
    );
    merge_breakdown(
        candidate,
        "contentLowQualityPenalty",
        quality.low_quality_penalty,
    );
}

fn calibration_source_multiplier(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let source_name = candidate.recall_source.as_deref().unwrap_or("");
    let policy_multiplier = source_mixing_multiplier(query, source_name);
    if policy_multiplier > 0.0 {
        return policy_multiplier;
    }

    if candidate.in_network == Some(true) || source_name == "FollowingSource" {
        return 1.0;
    }

    match source_retrieval_lane(source_name) {
        SOCIAL_EXPANSION_LANE => 0.92,
        INTEREST_LANE => 0.88,
        FALLBACK_LANE => 0.82,
        _ => 0.8,
    }
}

pub(super) fn recency_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let query = ctx.query;
    let input_count = candidates.len();
    let Some(plan) = recency_adjustment_plan(query) else {
        return (candidates, recency_stage(input_count, false));
    };

    for candidate in &mut candidates {
        apply_recency(candidate, &plan);
    }

    (candidates, recency_stage(input_count, true))
}

pub(super) struct RecencyAdjustmentPlan {
    half_life_ms: f64,
    now: chrono::DateTime<Utc>,
}

pub(super) fn recency_adjustment_plan(
    query: &RecommendationQueryPayload,
) -> Option<RecencyAdjustmentPlan> {
    space_feed_experiment_flag(query, "enable_recency_scorer", true).then(|| {
        let half_life_ms = ranking_policy_number(query, FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY, 6.0)
            .clamp(1.0, 168.0)
            * 60.0
            * 60.0
            * 1000.0;
        RecencyAdjustmentPlan {
            half_life_ms,
            now: Utc::now(),
        }
    })
}

pub(super) fn recency_stage(input_count: usize, enabled: bool) -> RecommendationStagePayload {
    build_stage(RECENCY_SCORER, input_count, enabled, None)
}

pub(super) fn apply_recency(
    candidate: &mut RecommendationCandidatePayload,
    plan: &RecencyAdjustmentPlan,
) {
    let age_ms = plan
        .now
        .signed_duration_since(candidate.created_at)
        .num_milliseconds()
        .max(0) as f64;
    let decay_factor = 0.5_f64.powf(age_ms / plan.half_life_ms);
    let multiplier = 0.8 + (1.5 - 0.8) * decay_factor;
    let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "recencyMultiplier", multiplier);
    merge_breakdown(candidate, "ageHours", age_ms / (60.0 * 60.0 * 1000.0));
}
