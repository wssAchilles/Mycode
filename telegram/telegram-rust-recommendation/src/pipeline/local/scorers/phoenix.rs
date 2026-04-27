use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::scoring::apply_lightweight_phoenix_scores_with_profile;
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::helpers::build_stage;

pub(super) fn lightweight_phoenix_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let action_profile = UserActionProfile::from_query(query);
    for candidate in &mut candidates {
        apply_lightweight_phoenix_scores_with_profile(query, candidate, &action_profile);
    }
    (
        candidates,
        build_stage("LightweightPhoenixScorer", input_count, true, None),
    )
}
