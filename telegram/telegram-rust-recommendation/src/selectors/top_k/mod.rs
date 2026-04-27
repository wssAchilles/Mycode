use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

mod audit;
mod candidates;
mod constraints;
mod fill;
mod output;
mod state;
#[cfg(test)]
mod tests;

pub use audit::{SelectorAuditSnapshot, build_selector_audit};
pub use candidates::sort_candidates;

use constraints::{SelectorSoftCaps, selector_constraints, window_factor};
use fill::{run_relaxed_selection_phases, run_required_selection_phases};
use output::build_selector_output;
use state::SelectionState;

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
    author_soft_cap: usize,
) -> Vec<RecommendationCandidatePayload> {
    let target_size = selector_target_size(query.limit, oversample_factor, max_size);
    let mut sorted = candidates.to_vec();
    sort_candidates(&mut sorted, query.in_network_only);
    if query.in_network_only {
        sorted.truncate(target_size);
        return sorted;
    }

    let soft_caps = SelectorSoftCaps::for_query(query, target_size, author_soft_cap);
    let window_size = sorted.len().min(
        target_size
            .saturating_mul(window_factor(query))
            .max(target_size),
    );
    let window = &sorted[..window_size];
    let constraints = selector_constraints(query, target_size);
    let mut selection = SelectionState::default();

    run_required_selection_phases(
        query,
        window,
        target_size,
        &constraints,
        &mut selection,
        soft_caps,
    );
    run_relaxed_selection_phases(window, target_size, &constraints, &mut selection, soft_caps);

    build_selector_output(
        &sorted,
        window,
        window_size,
        selection.selection_order,
        target_size,
    )
}
