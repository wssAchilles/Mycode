use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

fn candidate_score(candidate: &RecommendationCandidatePayload) -> f64 {
    candidate
        .score
        .or(candidate.weighted_score)
        .or(candidate.pipeline_score)
        .unwrap_or_default()
}

pub fn selector_target_size(limit: usize, oversample_factor: usize, max_size: usize) -> usize {
    let base = limit.max(1);
    let oversampled = base.saturating_mul(oversample_factor.max(1));
    oversampled.min(max_size.max(1))
}

pub fn select_candidates(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    oversample_factor: usize,
    max_size: usize,
) -> Vec<RecommendationCandidatePayload> {
    let mut selected = candidates.to_vec();
    sort_candidates(&mut selected, query.in_network_only);
    selected.truncate(selector_target_size(
        query.limit,
        oversample_factor,
        max_size,
    ));
    selected
}

pub fn sort_candidates(candidates: &mut [RecommendationCandidatePayload], in_network_only: bool) {
    candidates.sort_by(|left, right| {
        if in_network_only {
            right.created_at.cmp(&left.created_at)
        } else {
            candidate_score(right)
                .partial_cmp(&candidate_score(left))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.created_at.cmp(&left.created_at))
        }
    });
}
