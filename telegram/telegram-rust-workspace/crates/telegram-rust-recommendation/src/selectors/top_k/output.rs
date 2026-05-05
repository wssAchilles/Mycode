use crate::contracts::RecommendationCandidatePayload;

use super::candidates::{candidate_selection_pool, selection_reason};

pub(super) fn build_selector_output(
    sorted: &[RecommendationCandidatePayload],
    window: &[RecommendationCandidatePayload],
    window_size: usize,
    selection_order: Vec<usize>,
    target_size: usize,
) -> Vec<RecommendationCandidatePayload> {
    let mut output = selection_order
        .into_iter()
        .map(|index| window[index].clone())
        .collect::<Vec<_>>();

    if output.len() < target_size {
        for candidate in sorted.iter().skip(window_size).cloned() {
            if output.len() >= target_size {
                break;
            }
            output.push(candidate);
        }
    }

    for candidate in &mut output {
        let pool = candidate_selection_pool(candidate).to_string();
        candidate.selection_reason = Some(selection_reason(candidate, &pool));
        candidate.selection_pool = Some(pool);
    }

    output.truncate(target_size);
    output
}
