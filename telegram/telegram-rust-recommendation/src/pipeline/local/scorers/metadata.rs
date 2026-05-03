use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    ranking_policy_contract_version, ranking_policy_score_breakdown_version,
    ranking_policy_strategy_version,
};

use super::helpers::{
    breakdown_value, build_stage, merge_breakdown, oon_factor, stable_unit_interval,
};

pub(super) fn oon_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        let base = candidate.weighted_score.unwrap_or_default();
        let factor = if candidate.in_network == Some(false) {
            oon_factor(query, candidate)
        } else {
            1.0
        };
        let adjusted = base * factor;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "baseScore", base);
        merge_breakdown(candidate, "oonFactor", factor);
    }
    (
        candidates,
        build_stage("OutOfNetworkScorer", input_count, true, None),
    )
}

pub(super) fn score_contract_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let contract_version = ranking_policy_contract_version(query).to_string();
    let breakdown_version = ranking_policy_score_breakdown_version(query).to_string();
    let strategy_version = ranking_policy_strategy_version(query).to_string();
    for candidate in &mut candidates {
        candidate.score_contract_version = Some(contract_version.clone());
        candidate.score_breakdown_version = Some(breakdown_version.clone());

        let action_score =
            breakdown_value(candidate.score_breakdown.as_ref(), "weightedPositiveScore");
        let quality_score = breakdown_value(candidate.score_breakdown.as_ref(), "contentQuality");
        let freshness_score =
            breakdown_value(candidate.score_breakdown.as_ref(), "recencyMultiplier");
        let diversity_multiplier =
            breakdown_value(candidate.score_breakdown.as_ref(), "diversityMultiplier");
        let negative_penalty = breakdown_value(
            candidate.score_breakdown.as_ref(),
            "negativeFeedbackStrength",
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

        merge_breakdown(candidate, "scoreContractVersion", 2.0);
        merge_breakdown(candidate, "scoreBreakdownVersion", 2.0);
        merge_breakdown(
            candidate,
            "strategyVersionHash",
            stable_unit_interval(&strategy_version, &contract_version),
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

    (
        candidates,
        build_stage("ScoreContractScorer", input_count, true, None),
    )
}
