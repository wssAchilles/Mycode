use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;
use crate::query_hydrators::impressed_posts::ImpressedPostsQueryHydrator;

const HYDRATOR_NAME: &str = "ImpressedPostsQueryHydrator";

pub fn impressed_posts_hydrator(
    query: &RecommendationQueryPayload,
) -> (RecommendationQueryPayload, RecommendationStagePayload) {
    let mut hydrated = query.clone();
    ImpressedPostsQueryHydrator::hydrate(&mut hydrated);
    let stage = build_hydrator_stage(HYDRATOR_NAME, 1, 1, None);
    (hydrated, stage)
}
