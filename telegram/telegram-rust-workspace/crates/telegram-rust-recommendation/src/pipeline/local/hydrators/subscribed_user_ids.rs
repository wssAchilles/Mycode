use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;
use crate::query_hydrators::subscribed_user_ids::SubscribedUserIdsQueryHydrator;

const HYDRATOR_NAME: &str = "SubscribedUserIdsQueryHydrator";

pub fn subscribed_user_ids_hydrator(
    query: &RecommendationQueryPayload,
) -> (RecommendationQueryPayload, RecommendationStagePayload) {
    let mut hydrated = query.clone();
    SubscribedUserIdsQueryHydrator::hydrate(&mut hydrated);
    let stage = build_hydrator_stage(HYDRATOR_NAME, 1, 1, None);
    (hydrated, stage)
}
