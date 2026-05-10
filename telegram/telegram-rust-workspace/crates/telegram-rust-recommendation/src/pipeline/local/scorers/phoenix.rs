use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::scoring::apply_lightweight_phoenix_scores_with_profile;
use super::runner::ScoringContext;
use telegram_component_primitives::scorers::LIGHTWEIGHT_PHOENIX_SCORER;

use super::helpers::build_stage;

pub(super) fn lightweight_phoenix_scorer(
    ctx: &ScoringContext,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let query = ctx.query;
    let input_count = candidates.len();
    let action_profile = ctx.action_profile();
    for candidate in &mut candidates {
        apply_lightweight_phoenix_scores_with_profile(query, candidate, action_profile);
    }
    (
        candidates,
        build_stage(LIGHTWEIGHT_PHOENIX_SCORER, input_count, true, None),
    )
}
