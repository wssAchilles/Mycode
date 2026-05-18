use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;
use crate::query_hydrators::ip::IpQueryHydrator;

const HYDRATOR_NAME: &str = "IpQueryHydrator";

pub fn ip_hydrator(
    query: &RecommendationQueryPayload,
) -> (RecommendationQueryPayload, RecommendationStagePayload) {
    let mut hydrated = query.clone();
    IpQueryHydrator::hydrate(&mut hydrated);
    let stage = build_hydrator_stage(HYDRATOR_NAME, 1, 1, None);
    (hydrated, stage)
}
