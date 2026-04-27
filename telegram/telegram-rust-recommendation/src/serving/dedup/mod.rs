use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

mod deferred;
mod identity;
mod primary;
mod result;
mod semantic;
mod soft_caps;
mod state;

#[cfg(test)]
mod tests;

use deferred::{apply_deferred_suppression_counts, reinsert_deferred_candidates};
use primary::run_primary_dedup_pass;
pub use result::ServingDedupResult;
use result::build_result;
use state::{DedupWorkset, ServedContext};

const AUTHOR_SOFT_CAP_REASON: &str = "author_soft_cap";
const CONTENT_DUPLICATE_REASON: &str = "content_duplicate";
const CONVERSATION_DUPLICATE_REASON: &str = "conversation_duplicate";
const NEAR_DUPLICATE_CONTENT_REASON: &str = "near_duplicate_content";
const SERVED_STATE_REASON: &str = "served_state_duplicate";

pub fn dedup_for_serving(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    limit: usize,
    author_soft_cap: usize,
) -> ServingDedupResult {
    let served_context = ServedContext::from_query(query);
    let mut workset = DedupWorkset::with_capacity(candidates.len());

    run_primary_dedup_pass(
        query,
        candidates,
        author_soft_cap,
        &served_context,
        &mut workset,
    );
    let reinserted = reinsert_deferred_candidates(limit, &mut workset);
    let suppression = apply_deferred_suppression_counts(&mut workset, &reinserted);

    build_result(limit, workset, suppression)
}
