use std::collections::{HashMap, HashSet};

use crate::contracts::RecommendationCandidatePayload;
use crate::pipeline::local::context::source_retrieval_lane;

pub(super) fn record_candidate_state(
    candidate: &RecommendationCandidatePayload,
    related_ids: &[String],
    seen_related_ids: &mut HashSet<String>,
    seen_conversations: &mut HashSet<String>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
) {
    for id in related_ids {
        seen_related_ids.insert(id.clone());
    }

    if let Some(conversation_id) = candidate.conversation_id.as_ref() {
        seen_conversations.insert(conversation_id.clone());
    }

    if let Some(source_key) = candidate_source_context_key(candidate) {
        *source_counts.entry(source_key).or_insert(0) += 1;
    }
    if let Some(topic_key) = candidate_topic_context_key(candidate) {
        *topic_counts.entry(topic_key).or_insert(0) += 1;
    }
}

pub(super) fn candidate_source_context_key(
    candidate: &RecommendationCandidatePayload,
) -> Option<String> {
    candidate
        .recall_source
        .as_deref()
        .or(candidate.retrieval_lane.as_deref())
        .map(normalize_context_key)
        .filter(|value| !value.is_empty())
        .or_else(|| Some(normalize_context_key(source_retrieval_lane(""))))
}

pub(super) fn candidate_topic_context_key(
    candidate: &RecommendationCandidatePayload,
) -> Option<String> {
    if let Some(cluster_id) = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
    {
        return Some(format!("news_cluster:{cluster_id}"));
    }
    if let Some(conversation_id) = candidate
        .conversation_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!(
            "conversation:{}",
            normalize_context_key(conversation_id)
        ));
    }
    if let Some(pool_kind) = candidate
        .interest_pool_kind
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!(
            "interest_pool:{}",
            normalize_context_key(pool_kind)
        ));
    }
    Some(format!("format:{}", candidate_format_key(candidate)))
}

pub(super) fn normalize_context_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub(super) fn related_ids(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();

    for value in [
        candidate.model_post_id.as_ref(),
        Some(&candidate.post_id),
        candidate.original_post_id.as_ref(),
        candidate.reply_to_post_id.as_ref(),
        candidate.conversation_id.as_ref(),
    ] {
        if let Some(value) = value {
            push_unique_id(&mut ids, &mut seen, value);
        }
    }

    if candidate.is_news == Some(true) {
        if let Some(metadata) = candidate.news_metadata.as_ref() {
            if let Some(external_id) = metadata.external_id.as_ref() {
                push_unique_id(&mut ids, &mut seen, external_id);
            }
            if let Some(cluster_id) = metadata.cluster_id {
                push_unique_id(&mut ids, &mut seen, &format!("news:cluster:{cluster_id}"));
            }
        }
    }

    ids
}

fn candidate_format_key(candidate: &RecommendationCandidatePayload) -> &'static str {
    if candidate.is_news == Some(true) {
        "news"
    } else if candidate.has_video == Some(true) {
        "video"
    } else if candidate.has_image == Some(true) {
        "image"
    } else if candidate.is_reply {
        "reply"
    } else if candidate.is_repost {
        "repost"
    } else {
        "text"
    }
}

fn push_unique_id(ids: &mut Vec<String>, seen: &mut HashSet<String>, value: &str) {
    let value = value.trim();
    if value.is_empty() || !seen.insert(value.to_string()) {
        return;
    }
    ids.push(value.to_string());
}
