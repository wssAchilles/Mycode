use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::ranking_policy_number;

use super::super::NegativeFeedbackSummary;
use super::context::request_source_key;
use super::features::{
    candidate_keyword_set, candidate_semantic_tokens, keyword_overlap_ratio, semantic_stop_word,
    tokenize_semantic_text,
};
use super::normalization::clamp01;

pub(in crate::pipeline::local::scorers) fn early_suppression(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> NegativeFeedbackSummary {
    let mut strength: f64 = 0.0;

    if query
        .user_features
        .as_ref()
        .is_some_and(|features| features.blocked_user_ids.contains(&candidate.author_id))
    {
        strength = strength.max(1.0);
    }

    let content = format!(
        "{} {}",
        candidate.content.to_lowercase(),
        candidate
            .author_username
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
    );
    for keyword in query
        .user_features
        .as_ref()
        .map(|features| features.muted_keywords.as_slice())
        .unwrap_or_default()
    {
        let normalized = keyword.trim().to_lowercase();
        if !normalized.is_empty() && content.contains(&normalized) {
            strength = strength.max(0.52);
        }
    }

    if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
    {
        strength = strength.max(0.9);
    } else if candidate.is_nsfw == Some(true) {
        strength = strength.max(0.46);
    }

    let strength = clamp01(strength);
    NegativeFeedbackSummary {
        strength,
        multiplier: (1.0 - strength * 0.86).clamp(0.08, 1.0),
    }
}

pub(in crate::pipeline::local::scorers) fn direct_negative_feedback(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> NegativeFeedbackSummary {
    let Some(actions) = query.user_action_sequence.as_ref() else {
        return NegativeFeedbackSummary {
            strength: 0.0,
            multiplier: 1.0,
        };
    };

    let now = Utc::now();
    let mut strength: f64 = 0.0;
    for action in actions {
        let action_name = action
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let base = match action_name {
            "dismiss" => 0.32,
            "not_interested" => 0.45,
            "mute_author" => 0.62,
            "block_author" => 0.84,
            "report" => 0.78,
            _ => 0.0,
        };
        if base <= 0.0 {
            continue;
        }

        let post_match = action_string(
            action,
            &[
                "targetPostId",
                "target_post_id",
                "modelPostId",
                "model_post_id",
            ],
        )
        .is_some_and(|target| {
            target == candidate.post_id
                || candidate
                    .model_post_id
                    .as_ref()
                    .is_some_and(|model_id| target == *model_id)
        });
        let author_match = action_string(action, &["targetAuthorId", "target_author_id"])
            .is_some_and(|target| target == candidate.author_id);
        let propagated_match = negative_feedback_semantic_match(action, candidate);
        if !post_match && !author_match && propagated_match <= 0.0 {
            continue;
        }

        let age_days = action
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|timestamp| {
                now.signed_duration_since(timestamp.with_timezone(&Utc))
                    .num_seconds()
                    .max(0) as f64
                    / 86_400.0
            })
            .unwrap_or_default();
        let half_life_days =
            ranking_policy_number(query, "negative_feedback_half_life_days", 22.8).clamp(1.0, 90.0);
        let recency = 0.5_f64.powf(age_days.min(90.0) / half_life_days);
        let propagation_weight =
            ranking_policy_number(query, "negative_feedback_propagation_weight", 0.34)
                .clamp(0.0, 0.8);
        let target_factor = if post_match {
            1.0
        } else if author_match {
            0.56
        } else {
            propagated_match * propagation_weight
        };
        strength += base * recency * target_factor;
    }

    let strength = clamp01(strength);
    NegativeFeedbackSummary {
        strength,
        multiplier: (1.0 - strength * 0.45).clamp(0.52, 1.0),
    }
}

pub(super) fn negative_feedback_semantic_match(
    action: &HashMap<String, Value>,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let mut match_strength: f64 = 0.0;

    let candidate_cluster = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
        .map(|cluster_id| cluster_id.to_string());
    if candidate_cluster.is_some()
        && action_number_string(
            action,
            &[
                "targetClusterId",
                "target_cluster_id",
                "clusterId",
                "cluster_id",
                "newsClusterId",
            ],
        ) == candidate_cluster
    {
        match_strength = match_strength.max(0.74);
    }

    if let Some(target_conversation) = action_string(
        action,
        &[
            "targetConversationId",
            "target_conversation_id",
            "conversationId",
        ],
    ) {
        if candidate
            .conversation_id
            .as_ref()
            .is_some_and(|conversation_id| conversation_id == &target_conversation)
        {
            match_strength = match_strength.max(0.7);
        }
    }

    if let Some(target_source) = action_string(
        action,
        &[
            "targetSource",
            "target_source",
            "source",
            "recallSource",
            "recall_source",
        ],
    ) {
        let candidate_source = request_source_key(candidate).to_ascii_lowercase();
        let target_source = target_source.trim().to_ascii_lowercase();
        if !target_source.is_empty()
            && (candidate_source == target_source
                || candidate_source.contains(&target_source)
                || target_source.contains(&candidate_source))
        {
            match_strength = match_strength.max(0.46);
        }
    }

    let candidate_keywords = candidate_keyword_set(candidate);
    let action_keywords = action_keywords_for_policy(action);
    let keyword_match = keyword_overlap_ratio(&candidate_keywords, &action_keywords);
    if keyword_match > 0.0 {
        match_strength = match_strength.max(keyword_match * 0.62);
    }

    clamp01(match_strength)
}

pub(super) fn action_number_string(
    action: &HashMap<String, Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(text) = value.as_str().filter(|value| !value.trim().is_empty()) {
            return Some(text.to_string());
        }
        if let Some(number) = value.as_i64() {
            return Some(number.to_string());
        }
        if let Some(number) = value.as_u64() {
            return Some(number.to_string());
        }
    }
    None
}

pub(super) fn action_string(action: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(as_string) = value.as_str() {
            return Some(as_string.to_string());
        }
        if let Some(as_oid) = value
            .as_object()
            .and_then(|object| object.get("$oid").or_else(|| object.get("oid")))
            .and_then(Value::as_str)
        {
            return Some(as_oid.to_string());
        }
    }
    None
}

pub(in crate::pipeline::local::scorers) fn recent_action_token_overlap(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let candidate_tokens = candidate_semantic_tokens(candidate);
    if candidate_tokens.is_empty() {
        return 0.0;
    }
    let candidate_set = candidate_tokens.into_iter().collect::<HashSet<_>>();

    query
        .user_action_sequence
        .as_ref()
        .into_iter()
        .flatten()
        .chain(
            query
                .model_user_action_sequence
                .as_ref()
                .into_iter()
                .flatten(),
        )
        .filter(|action| {
            action
                .get("action")
                .and_then(Value::as_str)
                .map(|name| {
                    matches!(
                        name,
                        "delivery" | "impression" | "view" | "click" | "dwell" | "read"
                    )
                })
                .unwrap_or(false)
        })
        .filter_map(action_text)
        .map(|text| tokenize_semantic_text(&text))
        .filter(|tokens| !tokens.is_empty())
        .map(|tokens| {
            let action_set = tokens.into_iter().collect::<HashSet<_>>();
            let intersection = candidate_set.intersection(&action_set).count() as f64;
            let union = candidate_set.union(&action_set).count().max(1) as f64;
            intersection / union
        })
        .fold(0.0, f64::max)
}

pub(super) fn action_text(action: &HashMap<String, Value>) -> Option<String> {
    let mut parts = Vec::new();
    for key in [
        "content",
        "text",
        "body",
        "title",
        "summary",
        "targetContent",
        "targetText",
        "targetTitle",
        "actionText",
        "action_text",
    ] {
        if let Some(value) = action.get(key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

pub(super) fn action_policy_keywords(query: &RecommendationQueryPayload) -> Vec<String> {
    query
        .user_action_sequence
        .as_ref()
        .into_iter()
        .flatten()
        .chain(
            query
                .model_user_action_sequence
                .as_ref()
                .into_iter()
                .flatten(),
        )
        .flat_map(action_keywords_for_policy)
        .collect()
}

pub(super) fn action_keywords_for_policy(action: &HashMap<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for key in ["targetKeywords", "target_keywords", "keywords"] {
        if let Some(values) = action.get(key).and_then(Value::as_array) {
            for value in values {
                if let Some(keyword) = value.as_str() {
                    push_policy_keyword(keyword, &mut out, &mut seen);
                }
            }
        }
    }
    for key in [
        "targetTitle",
        "target_title",
        "content",
        "summary",
        "actionText",
        "action_text",
    ] {
        if let Some(text) = action_string(action, &[key]) {
            for token in text.split(|ch: char| !ch.is_ascii_alphanumeric()) {
                push_policy_keyword(token, &mut out, &mut seen);
                if out.len() >= 16 {
                    return out;
                }
            }
        }
    }
    out
}

pub(super) fn push_policy_keyword(token: &str, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    let normalized = token.trim().to_ascii_lowercase();
    if normalized.len() < 2 || semantic_stop_word(&normalized) {
        return;
    }
    if seen.insert(normalized.clone()) {
        out.push(normalized);
    }
}
