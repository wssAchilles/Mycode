use std::collections::HashSet;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{ranking_policy_number, ranking_policy_usize};

pub(super) fn record_semantic_state(
    seen_semantic_sets: &mut Vec<HashSet<String>>,
    semantic_tokens: HashSet<String>,
) {
    if semantic_tokens.len() >= 3 {
        seen_semantic_sets.push(semantic_tokens);
    }
}

pub(super) fn is_near_duplicate_content(
    query: &RecommendationQueryPayload,
    candidate_tokens: &HashSet<String>,
    seen_semantic_sets: &[HashSet<String>],
) -> bool {
    let min_tokens = ranking_policy_usize(query, "near_duplicate_min_token_count", 5).max(3);
    if candidate_tokens.len() < min_tokens {
        return false;
    }
    let threshold =
        ranking_policy_number(query, "near_duplicate_overlap_threshold", 0.82).clamp(0.5, 0.98);
    seen_semantic_sets
        .iter()
        .any(|seen| semantic_overlap(candidate_tokens, seen) >= threshold)
}

pub(super) fn candidate_semantic_tokens(
    candidate: &RecommendationCandidatePayload,
) -> HashSet<String> {
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
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| token.len() >= 3)
        .filter(|token| !semantic_stop_word(token))
        .collect()
}

fn semantic_overlap(left: &HashSet<String>, right: &HashSet<String>) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count() as f64;
    let smaller = left.len().min(right.len()).max(1) as f64;
    intersection / smaller
}

fn semantic_stop_word(token: &str) -> bool {
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
