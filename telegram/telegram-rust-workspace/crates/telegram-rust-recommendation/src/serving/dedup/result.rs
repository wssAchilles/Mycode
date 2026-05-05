use std::collections::HashMap;

use crate::contracts::RecommendationCandidatePayload;
use telegram_serving_primitives::{PageUnderfillInput, page_underfill_reason};

use super::state::{DedupWorkset, SuppressionSummary};

#[derive(Debug, Clone)]
pub struct ServingDedupResult {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub has_more: bool,
    pub page_remaining_count: usize,
    pub page_underfilled: bool,
    pub page_underfill_reason: Option<String>,
    pub duplicate_suppressed_count: usize,
    pub cross_page_duplicate_count: usize,
    pub suppression_reasons: HashMap<String, usize>,
}

pub(super) fn build_result(
    limit: usize,
    mut workset: DedupWorkset,
    suppression: SuppressionSummary,
) -> ServingDedupResult {
    let page_remaining_count = workset
        .state
        .kept
        .len()
        .saturating_sub(limit)
        .saturating_add(suppression.cross_request_suppressed)
        .saturating_add(suppression.near_duplicate_suppressed)
        .saturating_add(suppression.author_soft_cap_suppressed);
    let has_more = page_remaining_count > 0;
    if limit > 0 && workset.state.kept.len() > limit {
        workset.state.kept.truncate(limit);
    }

    let duplicate_suppressed_count = workset.state.suppression_reasons.values().sum();
    let page_underfilled = limit > 0 && workset.state.kept.len() < limit;
    let page_underfill_reason = page_underfilled
        .then(|| {
            page_underfill_reason(PageUnderfillInput {
                cross_page_duplicate_count: workset.state.cross_page_duplicate_count,
                duplicate_suppressed_count,
                cross_request_suppressed: suppression.cross_request_suppressed,
                near_duplicate_suppressed: suppression.near_duplicate_suppressed,
                author_soft_cap_suppressed: suppression.author_soft_cap_suppressed,
            })
        })
        .map(ToOwned::to_owned);

    ServingDedupResult {
        candidates: workset.state.kept,
        has_more,
        page_remaining_count,
        page_underfilled,
        page_underfill_reason,
        duplicate_suppressed_count,
        cross_page_duplicate_count: workset.state.cross_page_duplicate_count,
        suppression_reasons: workset.state.suppression_reasons,
    }
}
