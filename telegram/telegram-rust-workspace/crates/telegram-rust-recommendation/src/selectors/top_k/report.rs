use crate::contracts::RecommendationCandidatePayload;
pub use telegram_selector_primitives::SelectorSelectionReport;

#[derive(Debug, Clone)]
pub struct SelectorSelectionOutput {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub report: SelectorSelectionReport,
}

pub(super) use telegram_selector_primitives::first_blocking_reason;
