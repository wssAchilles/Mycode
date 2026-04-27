use std::collections::HashMap;

use crate::contracts::RecommendationCandidatePayload;

use super::candidates::{
    candidate_lane, candidate_selection_pool, candidate_source, is_news_candidate,
    is_trend_candidate,
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectorAuditSnapshot {
    pub selected_count: usize,
    pub lane_counts: HashMap<String, usize>,
    pub source_counts: HashMap<String, usize>,
    pub pool_counts: HashMap<String, usize>,
    pub trend_count: usize,
    pub news_count: usize,
    pub exploration_count: usize,
}

pub fn build_selector_audit(
    candidates: &[RecommendationCandidatePayload],
) -> SelectorAuditSnapshot {
    let mut snapshot = SelectorAuditSnapshot {
        selected_count: candidates.len(),
        ..SelectorAuditSnapshot::default()
    };

    for candidate in candidates {
        *snapshot
            .lane_counts
            .entry(candidate_lane(candidate).to_string())
            .or_insert(0) += 1;
        *snapshot
            .source_counts
            .entry(candidate_source(candidate).to_string())
            .or_insert(0) += 1;
        let pool = candidate
            .selection_pool
            .clone()
            .unwrap_or_else(|| candidate_selection_pool(candidate).to_string());
        *snapshot.pool_counts.entry(pool.clone()).or_insert(0) += 1;
        if is_trend_candidate(candidate) || pool == "trend" {
            snapshot.trend_count += 1;
        }
        if is_news_candidate(candidate) {
            snapshot.news_count += 1;
        }
        if pool == "exploration" {
            snapshot.exploration_count += 1;
        }
    }

    snapshot
}
