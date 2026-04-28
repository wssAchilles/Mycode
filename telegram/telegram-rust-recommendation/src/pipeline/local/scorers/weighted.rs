use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::helpers::{
    build_stage, compute_weighted_score, merge_breakdown, normalize_weighted_score,
};
use super::{NEGATIVE_WEIGHT_SUM, POSITIVE_WEIGHT_SUM};

pub(super) fn weighted_scorer(
    _query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        let weighted = compute_weighted_score(candidate);
        let normalized = normalize_weighted_score(weighted.raw_score);
        candidate.weighted_score = Some(normalized);
        candidate.pipeline_score = Some(normalized);
        merge_breakdown(candidate, "weightedRawScore", weighted.raw_score);
        merge_breakdown(candidate, "weightedBaseRawScore", weighted.base_raw_score);
        merge_breakdown(candidate, "weightedPositiveScore", weighted.positive_score);
        merge_breakdown(candidate, "weightedNegativeScore", weighted.negative_score);
        merge_breakdown(candidate, "weightedEvidencePrior", weighted.evidence_prior);
        merge_breakdown(candidate, "weightedSignalPrior", weighted.signal_prior);
        merge_breakdown(candidate, "weightedEvidenceLift", weighted.evidence_score);
        merge_breakdown(
            candidate,
            "weightedActionScoresUsed",
            weighted.action_scores_used as i32 as f64,
        );
        merge_breakdown(
            candidate,
            "weightedHeuristicFallbackUsed",
            weighted.heuristic_fallback_used as i32 as f64,
        );
        merge_breakdown(candidate, "positiveWeightSum", POSITIVE_WEIGHT_SUM);
        merge_breakdown(candidate, "negativeWeightSum", NEGATIVE_WEIGHT_SUM);
        merge_breakdown(candidate, "normalizedWeightedScore", normalized);
    }
    (
        candidates,
        build_stage("WeightedScorer", input_count, true, None),
    )
}
