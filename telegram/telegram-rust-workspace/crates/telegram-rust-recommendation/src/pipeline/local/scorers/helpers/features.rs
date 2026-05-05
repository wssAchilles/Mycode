use std::collections::HashSet;

use crate::contracts::RecommendationCandidatePayload;

use super::normalization::clamp01;

pub(in crate::pipeline::local::scorers) fn candidate_keyword_set(
    candidate: &RecommendationCandidatePayload,
) -> Vec<String> {
    let text = format!(
        "{} {} {}",
        candidate.content,
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.title.as_deref())
            .unwrap_or_default(),
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.summary.as_deref())
            .unwrap_or_default()
    );
    let mut seen = std::collections::HashSet::new();
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 2)
        .filter(|token| seen.insert(token.clone()))
        .take(32)
        .collect()
}

pub(in crate::pipeline::local::scorers) fn candidate_semantic_tokens(
    candidate: &RecommendationCandidatePayload,
) -> Vec<String> {
    let text = format!(
        "{} {} {}",
        candidate.content,
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.title.as_deref())
            .unwrap_or_default(),
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.summary.as_deref())
            .unwrap_or_default()
    );
    tokenize_semantic_text(&text)
}

pub(super) fn tokenize_semantic_text(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 3)
        .filter(|token| !semantic_stop_word(token))
        .filter(|token| seen.insert(token.clone()))
        .take(48)
        .collect()
}

pub(super) fn semantic_stop_word(token: &str) -> bool {
    matches!(
        token,
        "the"
            | "and"
            | "for"
            | "with"
            | "from"
            | "that"
            | "this"
            | "have"
            | "has"
            | "was"
            | "were"
            | "are"
            | "you"
            | "your"
            | "they"
            | "their"
            | "into"
            | "about"
            | "today"
            | "news"
            | "note"
            | "demo"
            | "post"
    )
}

pub(in crate::pipeline::local::scorers) fn keyword_overlap_ratio(
    candidate_keywords: &[String],
    policy_keywords: &[String],
) -> f64 {
    if candidate_keywords.is_empty() || policy_keywords.is_empty() {
        return 0.0;
    }
    let matched = policy_keywords
        .iter()
        .filter(|keyword| {
            candidate_keywords.iter().any(|candidate_keyword| {
                candidate_keyword == *keyword
                    || candidate_keyword.contains(keyword.as_str())
                    || keyword.contains(candidate_keyword.as_str())
            })
        })
        .count();
    clamp01(matched as f64 / policy_keywords.len().max(1) as f64)
}

pub(in crate::pipeline::local::scorers) fn jaccard_overlap(
    left: &HashSet<String>,
    right: &HashSet<String>,
) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count() as f64;
    let union = left.union(right).count().max(1) as f64;
    intersection / union
}
