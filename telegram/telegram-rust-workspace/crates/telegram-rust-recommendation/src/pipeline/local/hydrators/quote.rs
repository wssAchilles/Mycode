use crate::candidate_hydrators::quote::QuoteHydrator;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::hydrators::build_hydrator_stage;

const HYDRATOR_NAME: &str = "QuoteCandidateHydrator";

pub fn quote_hydrator(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let hydrated: Vec<RecommendationCandidatePayload> = candidates
        .into_iter()
        .map(|mut c| {
            QuoteHydrator::hydrate(&mut c);
            c
        })
        .collect();
    let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, hydrated.len(), None);
    (hydrated, stage)
}
