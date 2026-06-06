use std::collections::HashMap;

use serde_json::Value;

use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use telegram_component_primitives::scorers::WEIGHTED_SCORER;
use telegram_ranking_primitives::{
    NEGATIVE_SCORES_OFFSET, NEGATIVE_WEIGHT_SUM, NORMALIZED_WEIGHTED_SCORE_FIELD,
    POSITIVE_WEIGHT_SUM, RANKING_MODEL_MISSING_TARGETS_FIELD, RANKING_MODEL_MODE_FIELD,
    RANKING_MODEL_MODE_SCORE_COMPOSITION, RANKING_MODEL_TARGETS_FIELD,
    WEIGHTED_ACTION_SCORES_USED_FIELD, WEIGHTED_BASE_RAW_SCORE_FIELD, WEIGHTED_EVIDENCE_LIFT_FIELD,
    WEIGHTED_EVIDENCE_PRIOR_FIELD, WEIGHTED_HEURISTIC_FALLBACK_USED_FIELD,
    WEIGHTED_NEGATIVE_SCORE_FIELD, WEIGHTED_NEGATIVE_WEIGHT_SUM_FIELD,
    WEIGHTED_POSITIVE_SCORE_FIELD, WEIGHTED_POSITIVE_WEIGHT_SUM_FIELD, WEIGHTED_RAW_SCORE_FIELD,
    WEIGHTED_SCORER_POLICY_VERSION, WEIGHTED_SIGNAL_PRIOR_FIELD, normalize_weighted_score,
};

use super::helpers::{build_stage, compute_weighted_score, merge_breakdown};

pub(super) fn weighted_scorer(
    _ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let plan = weighted_score_plan();
    for candidate in &mut candidates {
        apply_weighted_score(candidate, &plan);
    }
    (candidates, weighted_score_stage(input_count))
}

pub(super) struct WeightedScorePlan;

pub(super) fn weighted_score_plan() -> WeightedScorePlan {
    WeightedScorePlan
}

pub(super) fn weighted_score_stage(input_count: usize) -> RecommendationStagePayload {
    build_stage(
        WEIGHTED_SCORER,
        input_count,
        true,
        Some(weighted_scorer_stage_detail()),
    )
}

pub(super) fn apply_weighted_score(
    candidate: &mut RecommendationCandidatePayload,
    _plan: &WeightedScorePlan,
) {
    let weighted = compute_weighted_score(candidate);
    let normalized = normalize_weighted_score(weighted.raw_score);
    candidate.weighted_score = Some(normalized);
    candidate.pipeline_score = Some(normalized);
    merge_breakdown(candidate, WEIGHTED_RAW_SCORE_FIELD, weighted.raw_score);
    merge_breakdown(
        candidate,
        WEIGHTED_BASE_RAW_SCORE_FIELD,
        weighted.base_raw_score,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_POSITIVE_SCORE_FIELD,
        weighted.positive_score,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_NEGATIVE_SCORE_FIELD,
        weighted.negative_score,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_EVIDENCE_PRIOR_FIELD,
        weighted.evidence_prior,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_SIGNAL_PRIOR_FIELD,
        weighted.signal_prior,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_EVIDENCE_LIFT_FIELD,
        weighted.evidence_score,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_ACTION_SCORES_USED_FIELD,
        weighted.action_scores_used as i32 as f64,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_HEURISTIC_FALLBACK_USED_FIELD,
        weighted.heuristic_fallback_used as i32 as f64,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_POSITIVE_WEIGHT_SUM_FIELD,
        POSITIVE_WEIGHT_SUM,
    );
    merge_breakdown(
        candidate,
        WEIGHTED_NEGATIVE_WEIGHT_SUM_FIELD,
        NEGATIVE_WEIGHT_SUM,
    );
    merge_breakdown(candidate, NORMALIZED_WEIGHTED_SCORE_FIELD, normalized);
}

pub(super) fn weighted_scorer_stage_detail() -> HashMap<String, Value> {
    HashMap::from([
        (
            RANKING_MODEL_MODE_FIELD.to_string(),
            Value::String(RANKING_MODEL_MODE_SCORE_COMPOSITION.to_string()),
        ),
        (
            RANKING_MODEL_TARGETS_FIELD.to_string(),
            Value::Array(
                [
                    "click",
                    "like",
                    "reply",
                    "repost",
                    "share",
                    "dwell",
                    "followAuthor",
                    "notInterested",
                    "dismiss",
                    "block",
                    "mute",
                    "report",
                ]
                .into_iter()
                .map(|target| Value::String(target.to_string()))
                .collect(),
            ),
        ),
        (
            RANKING_MODEL_MISSING_TARGETS_FIELD.to_string(),
            Value::Array(
                [
                    "trainedWeightCalibration",
                    "trainedVideoQualityView",
                    "trainedLongDwellCalibration",
                ]
                .into_iter()
                .map(|target| Value::String(target.to_string()))
                .collect(),
            ),
        ),
        (
            "weightedScorerPolicyVersion".to_string(),
            Value::String(WEIGHTED_SCORER_POLICY_VERSION.to_string()),
        ),
        (
            "normalizationPositiveWeightSum".to_string(),
            Value::from(POSITIVE_WEIGHT_SUM),
        ),
        (
            "normalizationNegativeWeightSum".to_string(),
            Value::from(NEGATIVE_WEIGHT_SUM),
        ),
        (
            "negativeScoresOffset".to_string(),
            Value::from(NEGATIVE_SCORES_OFFSET),
        ),
    ])
}
