use std::collections::{HashMap, HashSet};

use crate::contracts::RecommendationCandidatePayload;

use super::identity::{
    candidate_source_context_key, candidate_topic_context_key, normalize_context_key,
};

pub(super) const CROSS_PAGE_AUTHOR_SOFT_CAP_REASON: &str = "cross_page_author_soft_cap";
pub(super) const CROSS_PAGE_SOURCE_SOFT_CAP_REASON: &str = "cross_page_source_soft_cap";
pub(super) const CROSS_PAGE_TOPIC_SOFT_CAP_REASON: &str = "cross_page_topic_soft_cap";

pub(super) fn cross_request_soft_cap_reason(
    candidate: &RecommendationCandidatePayload,
    served_author_counts: &HashMap<String, usize>,
    served_source_counts: &HashMap<String, usize>,
    served_topic_counts: &HashMap<String, usize>,
    author_counts: &HashMap<String, usize>,
    source_counts: &HashMap<String, usize>,
    topic_counts: &HashMap<String, usize>,
    author_cap: usize,
    source_cap: usize,
    topic_cap: usize,
) -> Option<&'static str> {
    if author_cap > 0
        && context_count(served_author_counts, author_counts, &candidate.author_id) >= author_cap
    {
        return Some(CROSS_PAGE_AUTHOR_SOFT_CAP_REASON);
    }

    if source_cap > 0 {
        if let Some(source_key) = candidate_source_context_key(candidate) {
            if context_count(served_source_counts, source_counts, &source_key) >= source_cap {
                return Some(CROSS_PAGE_SOURCE_SOFT_CAP_REASON);
            }
        }
    }

    if topic_cap > 0 {
        if let Some(topic_key) = candidate_topic_context_key(candidate) {
            if context_count(served_topic_counts, topic_counts, &topic_key) >= topic_cap {
                return Some(CROSS_PAGE_TOPIC_SOFT_CAP_REASON);
            }
        }
    }

    None
}

pub(super) fn served_context_counts(
    served_state: &HashSet<String>,
    prefix: &str,
) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for value in served_state {
        let Some(key) = value.strip_prefix(prefix) else {
            continue;
        };
        let key = normalize_context_key(key);
        if !key.is_empty() {
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

fn context_count(
    served_counts: &HashMap<String, usize>,
    current_counts: &HashMap<String, usize>,
    key: &str,
) -> usize {
    served_counts
        .get(key)
        .copied()
        .unwrap_or_default()
        .saturating_add(current_counts.get(key).copied().unwrap_or_default())
}
