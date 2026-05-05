use std::collections::{HashMap, HashSet};

use crate::contracts::RecommendationCandidatePayload;
use telegram_serving_primitives::{
    SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP,
    SERVING_DEDUP_REASON_CROSS_PAGE_SOURCE_SOFT_CAP,
    SERVING_DEDUP_REASON_CROSS_PAGE_TOPIC_SOFT_CAP,
};

use super::identity::{
    candidate_source_context_key, candidate_topic_context_key, normalize_context_key,
};

pub(super) const CROSS_PAGE_AUTHOR_SOFT_CAP_REASON: &str =
    SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP;
pub(super) const CROSS_PAGE_SOURCE_SOFT_CAP_REASON: &str =
    SERVING_DEDUP_REASON_CROSS_PAGE_SOURCE_SOFT_CAP;
pub(super) const CROSS_PAGE_TOPIC_SOFT_CAP_REASON: &str =
    SERVING_DEDUP_REASON_CROSS_PAGE_TOPIC_SOFT_CAP;

pub(super) struct CrossRequestSoftCapContext<'a> {
    pub(super) served_author_counts: &'a HashMap<String, usize>,
    pub(super) served_source_counts: &'a HashMap<String, usize>,
    pub(super) served_topic_counts: &'a HashMap<String, usize>,
    pub(super) author_counts: &'a HashMap<String, usize>,
    pub(super) source_counts: &'a HashMap<String, usize>,
    pub(super) topic_counts: &'a HashMap<String, usize>,
    pub(super) author_cap: usize,
    pub(super) source_cap: usize,
    pub(super) topic_cap: usize,
}

pub(super) fn cross_request_soft_cap_reason(
    candidate: &RecommendationCandidatePayload,
    context: &CrossRequestSoftCapContext<'_>,
) -> Option<&'static str> {
    if context.author_cap > 0
        && context_count(
            context.served_author_counts,
            context.author_counts,
            &candidate.author_id,
        ) >= context.author_cap
    {
        return Some(CROSS_PAGE_AUTHOR_SOFT_CAP_REASON);
    }

    if context.source_cap > 0
        && let Some(source_key) = candidate_source_context_key(candidate)
        && context_count(
            context.served_source_counts,
            context.source_counts,
            &source_key,
        ) >= context.source_cap
    {
        return Some(CROSS_PAGE_SOURCE_SOFT_CAP_REASON);
    }

    if context.topic_cap > 0
        && let Some(topic_key) = candidate_topic_context_key(candidate)
        && context_count(
            context.served_topic_counts,
            context.topic_counts,
            &topic_key,
        ) >= context.topic_cap
    {
        return Some(CROSS_PAGE_TOPIC_SOFT_CAP_REASON);
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
