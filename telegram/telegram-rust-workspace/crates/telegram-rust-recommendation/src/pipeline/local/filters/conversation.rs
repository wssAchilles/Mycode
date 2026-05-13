use std::collections::HashMap;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::CONVERSATION_DEDUP_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_CONVERSATION_DUPLICATE;

use super::detail::build_stage;

pub(super) fn conversation_dedup_filter(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let mut kept: Vec<RecommendationCandidatePayload> = Vec::new();
    let mut removed = Vec::new();
    let mut best_by_conversation: HashMap<String, (usize, f64)> = HashMap::new();

    for candidate in candidates {
        let key = candidate
            .conversation_id
            .clone()
            .unwrap_or_else(|| candidate.post_id.clone());
        let score = candidate.score.unwrap_or_default();
        match best_by_conversation.get(&key).copied() {
            Some((index, existing_score)) if score > existing_score => {
                removed.push(kept[index].clone());
                kept[index] = candidate;
                best_by_conversation.insert(key, (index, score));
            }
            Some(_) => removed.push(candidate),
            None => {
                best_by_conversation.insert(key, (kept.len(), score));
                kept.push(candidate);
            }
        }
    }
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            CONVERSATION_DEDUP_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_CONVERSATION_DUPLICATE),
        ),
        true,
    )
}
