use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;
use crate::query_hydrators::past_request_timestamps::PastRequestTimestampsQueryHydrator;

const HYDRATOR_NAME: &str = "PastRequestTimestampsQueryHydrator";

pub fn past_request_timestamps_hydrator(
    query: &RecommendationQueryPayload,
) -> (RecommendationQueryPayload, RecommendationStagePayload) {
    let mut hydrated = query.clone();
    PastRequestTimestampsQueryHydrator::hydrate(&mut hydrated);
    let stage = build_hydrator_stage(HYDRATOR_NAME, 1, 1, None);
    (hydrated, stage)
}
