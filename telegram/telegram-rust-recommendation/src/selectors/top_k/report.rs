use std::collections::HashMap;

use crate::contracts::RecommendationCandidatePayload;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectorSelectionReport {
    pub target_size: usize,
    pub window_size: usize,
    pub selected_count: usize,
    pub first_blocking_reason: Option<String>,
    pub deferred_reason_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone)]
pub struct SelectorSelectionOutput {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub report: SelectorSelectionReport,
}

pub(super) fn first_blocking_reason(reason_counts: &HashMap<String, usize>) -> Option<String> {
    reason_counts
        .iter()
        .max_by(|(left_reason, left_count), (right_reason, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_reason.cmp(left_reason))
        })
        .map(|(reason, _)| reason.clone())
}
