use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;
use crate::candidate_hydrators::tweet_type_metrics::TweetTypeMetricsHydrator;

const HYDRATOR_NAME: &str = "TweetTypeMetricsCandidateHydrator";

pub fn tweet_type_metrics_hydrator(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (Vec<RecommendationCandidatePayload>, RecommendationStagePayload) {
    let input_count = candidates.len();
    let hydrated: Vec<RecommendationCandidatePayload> = candidates
        .into_iter()
        .map(|mut c| {
            TweetTypeMetricsHydrator::hydrate(&mut c);
            c
        })
        .collect();
    let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, hydrated.len(), None);
    (hydrated, stage)
}
