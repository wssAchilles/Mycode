use crate::contracts::RecommendationCandidatePayload;

use super::candidates::{candidate_selection_pool, selection_reason};

const RANK_BEFORE_SELECTOR_FIELD: &str = "rankBeforeSelector";
const RANK_AFTER_SELECTOR_FIELD: &str = "rankAfterSelector";

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
    annotate_selector_rank_provenance(sorted, &mut output);
    output
}

pub(super) fn annotate_selector_rank_provenance(
    sorted: &[RecommendationCandidatePayload],
    output: &mut [RecommendationCandidatePayload],
) {
    for (output_index, candidate) in output.iter_mut().enumerate() {
        let rank_before = sorted
            .iter()
            .position(|item| item.post_id == candidate.post_id)
            .map(|index| index + 1)
            .unwrap_or(output_index + 1);
        let breakdown = candidate
            .score_breakdown
            .get_or_insert_with(Default::default);
        breakdown.insert(RANK_BEFORE_SELECTOR_FIELD.to_string(), rank_before as f64);
        breakdown.insert(
            RANK_AFTER_SELECTOR_FIELD.to_string(),
            (output_index + 1) as f64,
        );
    }
}
