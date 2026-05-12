use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::context::{
    ranking_policy_contract_version, ranking_policy_score_breakdown_version,
    ranking_policy_strategy_version,
};
use telegram_component_primitives::scorers::{OUT_OF_NETWORK_SCORER, SCORE_CONTRACT_SCORER};
use telegram_ranking_primitives::{
    NEGATIVE_FEEDBACK_STRENGTH_FIELD, SCORE_BREAKDOWN_VERSION_FIELD, SCORE_CONTRACT_VERSION_FIELD,
};

use super::helpers::{
    breakdown_value, build_stage, merge_breakdown, oon_factor, stable_unit_interval,
};

pub(super) fn oon_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        apply_oon(ctx, candidate);
    }
    (candidates, oon_stage(input_count))
}

pub(super) fn oon_stage(input_count: usize) -> RecommendationStagePayload {
    build_stage(OUT_OF_NETWORK_SCORER, input_count, true, None)
}

pub(super) fn apply_oon(ctx: &ScoringContext, candidate: &mut RecommendationCandidatePayload) {
    let base = candidate.weighted_score.unwrap_or_default();
    let factor = if candidate.in_network == Some(false) {
        oon_factor(ctx.query, candidate)
    } else {
        1.0
    };
    let adjusted = base * factor;
    candidate.weighted_score = Some(adjusted);
    candidate.pipeline_score = Some(adjusted);
    merge_breakdown(candidate, "baseScore", base);
    merge_breakdown(candidate, "oonFactor", factor);
}

pub(super) fn score_contract_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let query = ctx.query;
    let input_count = candidates.len();
    let plan = score_contract_plan(query);
    for candidate in &mut candidates {
        apply_score_contract(candidate, &plan);
    }

    (candidates, score_contract_stage(input_count))
}

pub(super) struct ScoreContractPlan {
    contract_version: String,
    breakdown_version: String,
    strategy_version: String,
}

pub(super) fn score_contract_plan(
    query: &crate::contracts::RecommendationQueryPayload,
) -> ScoreContractPlan {
    ScoreContractPlan {
        contract_version: ranking_policy_contract_version(query).to_string(),
        breakdown_version: ranking_policy_score_breakdown_version(query).to_string(),
        strategy_version: ranking_policy_strategy_version(query).to_string(),
    }
}

pub(super) fn score_contract_stage(input_count: usize) -> RecommendationStagePayload {
    build_stage(SCORE_CONTRACT_SCORER, input_count, true, None)
}

pub(super) fn apply_score_contract(
    candidate: &mut RecommendationCandidatePayload,
    plan: &ScoreContractPlan,
) {
    candidate.score_contract_version = Some(plan.contract_version.clone());
    candidate.score_breakdown_version = Some(plan.breakdown_version.clone());

    let action_score = breakdown_value(candidate.score_breakdown.as_ref(), "weightedPositiveScore");
    let quality_score = breakdown_value(candidate.score_breakdown.as_ref(), "contentQuality");
    let freshness_score = breakdown_value(candidate.score_breakdown.as_ref(), "recencyMultiplier");
    let diversity_multiplier =
        breakdown_value(candidate.score_breakdown.as_ref(), "diversityMultiplier");
    let negative_penalty = breakdown_value(
        candidate.score_breakdown.as_ref(),
        NEGATIVE_FEEDBACK_STRENGTH_FIELD,
    )
    .max(breakdown_value(
        candidate.score_breakdown.as_ref(),
        "earlySuppressionStrength",
    ));
    let source_multiplier = breakdown_value(
        candidate.score_breakdown.as_ref(),
        "calibrationSourceMultiplier",
    )
    .max(1.0);
    let behavior_multiplier = breakdown_value(
        candidate.score_breakdown.as_ref(),
        "calibrationBehaviorMultiplier",
    )
    .max(1.0);
    let calibration_multiplier = source_multiplier * behavior_multiplier;

    merge_breakdown(candidate, SCORE_CONTRACT_VERSION_FIELD, 2.0);
    merge_breakdown(candidate, SCORE_BREAKDOWN_VERSION_FIELD, 2.0);
    merge_breakdown(
        candidate,
        "strategyVersionHash",
        stable_unit_interval(&plan.strategy_version, &plan.contract_version),
    );
    merge_breakdown(
        candidate,
        "componentBaseScore",
        candidate.score.unwrap_or_default(),
    );
    merge_breakdown(candidate, "componentActionScore", action_score);
    merge_breakdown(candidate, "componentQualityScore", quality_score);
    merge_breakdown(candidate, "componentFreshnessScore", freshness_score);
    merge_breakdown(
        candidate,
        "componentDiversityPenalty",
        (1.0 - diversity_multiplier).max(0.0),
    );
    merge_breakdown(candidate, "componentNegativePenalty", negative_penalty);
    merge_breakdown(
        candidate,
        "componentCalibrationMultiplier",
        calibration_multiplier,
    );
}
