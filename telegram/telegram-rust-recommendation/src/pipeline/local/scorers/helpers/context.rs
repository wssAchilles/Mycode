use std::collections::{HashMap, HashSet};

use reqwest::Url;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_keywords, related_post_ids,
};

use super::super::OON_WEIGHT_FACTOR;
use super::actions::action_policy_keywords;
use super::features::candidate_semantic_tokens;

pub(in crate::pipeline::local::scorers) fn diversity_key(
    candidate: &RecommendationCandidatePayload,
) -> String {
    if candidate.is_news == Some(true) {
        if let Some(url) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source_url.clone().or(metadata.url.clone()))
        {
            if let Ok(parsed) = Url::parse(&url) {
                if parsed.scheme() == "http" || parsed.scheme() == "https" {
                    if let Some(host) = parsed.host_str() {
                        return format!("news:domain:{host}");
                    }
                }
            }
        }
        if let Some(cluster_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
        {
            return format!("news:cluster:{cluster_id}");
        }
        if let Some(source) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source.clone())
        {
            return format!("news:source:{source}");
        }
        return format!("news:author:{}", candidate.author_id);
    }

    format!("author:{}", candidate.author_id)
}

pub(in crate::pipeline::local::scorers) fn request_source_key(
    candidate: &RecommendationCandidatePayload,
) -> String {
    if candidate.is_news == Some(true) {
        if let Some(url) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source_url.clone().or(metadata.url.clone()))
        {
            if let Ok(parsed) = Url::parse(&url) {
                if let Some(host) = parsed.host_str() {
                    return format!("domain:{host}");
                }
            }
        }
        if let Some(source) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source.as_deref())
        {
            return format!("news_source:{source}");
        }
    }
    candidate
        .recall_source
        .as_deref()
        .or(candidate.retrieval_lane.as_deref())
        .unwrap_or("unknown")
        .to_string()
}

pub(in crate::pipeline::local::scorers) fn request_topic_key(
    candidate: &RecommendationCandidatePayload,
) -> String {
    if let Some(cluster_id) = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
    {
        return format!("news_cluster:{cluster_id}");
    }
    if let Some(conversation_id) = candidate
        .conversation_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return format!("conversation:{conversation_id}");
    }
    if let Some(pool) = candidate
        .interest_pool_kind
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return format!("interest_pool:{pool}");
    }
    let semantic_key = candidate_semantic_tokens(candidate)
        .into_iter()
        .take(3)
        .collect::<Vec<_>>()
        .join("|");
    if semantic_key.is_empty() {
        "format:text".to_string()
    } else {
        semantic_key
    }
}

pub(in crate::pipeline::local::scorers) fn oon_factor(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");
    let lane = candidate.retrieval_lane.as_deref().unwrap_or("");
    let secondary_source_count = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get("retrievalSecondarySourceCount"))
        .copied()
        .unwrap_or_default();
    let evidence_relief = (secondary_source_count * 0.01).min(0.05);
    let recall_evidence_relief = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| {
            (evidence.confidence * 0.035 + (evidence.source_count - 1.0).max(0.0) * 0.008).min(0.06)
        })
        .unwrap_or_default();

    let base = match state {
        "cold_start" => 0.88,
        "sparse" => match lane {
            INTEREST_LANE | SOCIAL_EXPANSION_LANE => 0.82,
            FALLBACK_LANE => 0.78,
            _ => OON_WEIGHT_FACTOR,
        },
        "heavy" => match lane {
            INTEREST_LANE | SOCIAL_EXPANSION_LANE => 0.68,
            FALLBACK_LANE => 0.64,
            _ => OON_WEIGHT_FACTOR,
        },
        _ => match lane {
            INTEREST_LANE | SOCIAL_EXPANSION_LANE => 0.74,
            FALLBACK_LANE => 0.70,
            _ => OON_WEIGHT_FACTOR,
        },
    };

    (base + evidence_relief.max(recall_evidence_relief)).min(0.9)
}

pub(in crate::pipeline::local::scorers) fn default_exploration_rate(state: &str) -> f64 {
    match state {
        "cold_start" => 0.26,
        "sparse" => 0.18,
        "heavy" => 0.08,
        _ => 0.12,
    }
}

pub(in crate::pipeline::local::scorers) fn cross_page_pressure(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let related = related_post_ids(candidate);
    if related.is_empty() {
        return 0.0;
    }
    let seen_match = related
        .iter()
        .any(|id| query.seen_ids.iter().any(|seen_id| seen_id == id));
    let served_match = related
        .iter()
        .any(|id| query.served_ids.iter().any(|served_id| served_id == id));
    match (seen_match, served_match) {
        (true, true) => 1.0,
        (true, false) => 0.75,
        (false, true) => 0.62,
        _ => 0.0,
    }
}

pub(in crate::pipeline::local::scorers) fn served_context_count(
    query: &RecommendationQueryPayload,
    prefix: &str,
    key: &str,
) -> usize {
    let normalized = key.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return 0;
    }
    query
        .served_ids
        .iter()
        .filter_map(|value| value.strip_prefix(prefix))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| value == &normalized)
        .count()
}

pub(in crate::pipeline::local::scorers) fn user_state<'a>(
    query: &'a RecommendationQueryPayload,
) -> &'a str {
    query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("")
}

pub(in crate::pipeline::local::scorers) fn breakdown_value(
    breakdown: Option<&HashMap<String, f64>>,
    key: &str,
) -> f64 {
    breakdown
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .unwrap_or_default()
}

pub(in crate::pipeline::local::scorers) fn bootstrapped_cold_start_keywords(
    query: &RecommendationQueryPayload,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut keywords = Vec::new();
    for value in ranking_policy_keywords(query, "cold_start_keywords")
        .into_iter()
        .chain(ranking_policy_keywords(query, "trend_keywords"))
        .chain(
            query
                .language_code
                .clone()
                .into_iter()
                .map(|value| value.to_lowercase()),
        )
        .chain(action_policy_keywords(query))
    {
        let value = value.trim().to_ascii_lowercase();
        if !value.is_empty() && seen.insert(value.clone()) {
            keywords.push(value);
        }
        if keywords.len() >= 48 {
            break;
        }
    }
    keywords
}
