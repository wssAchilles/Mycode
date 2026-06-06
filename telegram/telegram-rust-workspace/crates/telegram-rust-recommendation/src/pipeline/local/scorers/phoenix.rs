use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::scoring::apply_lightweight_phoenix_scores_with_profile;
use serde_json::Value;
use telegram_component_primitives::scorers::LIGHTWEIGHT_PHOENIX_SCORER;
use telegram_ranking_primitives::{
    RANKING_MODEL_MISSING_TARGETS_FIELD, RANKING_MODEL_MODE_FIELD,
    RANKING_MODEL_MODE_HEURISTIC_FALLBACK, RANKING_MODEL_TARGETS_FIELD,
};

use super::helpers::build_stage;

pub(super) fn lightweight_phoenix_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let plan = lightweight_phoenix_plan(ctx);
    for candidate in &mut candidates {
        apply_lightweight_phoenix(ctx, candidate, &plan);
    }
    (candidates, lightweight_phoenix_stage(input_count))
}

pub(super) struct LightweightPhoenixPlan;

pub(super) fn lightweight_phoenix_plan(_ctx: &ScoringContext) -> LightweightPhoenixPlan {
    LightweightPhoenixPlan
}

pub(super) fn lightweight_phoenix_stage(input_count: usize) -> RecommendationStagePayload {
    build_stage(
        LIGHTWEIGHT_PHOENIX_SCORER,
        input_count,
        true,
        Some(lightweight_phoenix_stage_detail()),
    )
}

fn lightweight_phoenix_stage_detail() -> std::collections::HashMap<String, Value> {
    std::collections::HashMap::from([
        (
            RANKING_MODEL_MODE_FIELD.to_string(),
            Value::String(RANKING_MODEL_MODE_HEURISTIC_FALLBACK.to_string()),
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
                    "remotePhoenixPrediction",
                    "trainedClickModel",
                    "trainedDwellModel",
                    "trainedNegativeFeedbackModel",
                ]
                .into_iter()
                .map(|target| Value::String(target.to_string()))
                .collect(),
            ),
        ),
    ])
}

pub(super) fn apply_lightweight_phoenix(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &LightweightPhoenixPlan,
) {
    let _ = plan;
    apply_lightweight_phoenix_scores_with_profile(ctx.query, candidate, ctx.action_profile());
}
