use super::runner::ScoringContext;
use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::scoring::apply_lightweight_phoenix_scores_with_profile;
use telegram_component_primitives::scorers::LIGHTWEIGHT_PHOENIX_SCORER;

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
    build_stage(LIGHTWEIGHT_PHOENIX_SCORER, input_count, true, None)
}

pub(super) fn apply_lightweight_phoenix(
    ctx: &ScoringContext,
    candidate: &mut RecommendationCandidatePayload,
    plan: &LightweightPhoenixPlan,
) {
    let _ = plan;
    apply_lightweight_phoenix_scores_with_profile(ctx.query, candidate, ctx.action_profile());
}
