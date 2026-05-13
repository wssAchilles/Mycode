use std::collections::HashSet;

use crate::contracts::RecommendationCandidatePayload;

#[derive(Debug, Default)]
pub(super) struct TrustedFallbackResult {
    pub(super) used_count: usize,
    pub(super) empty_selection_recovered: bool,
}

pub(super) fn apply_trusted_underfill_fallback(
    kept: &mut Vec<RecommendationCandidatePayload>,
    removed: &mut Vec<RecommendationCandidatePayload>,
    fallback: Vec<RecommendationCandidatePayload>,
    target_count: usize,
) -> TrustedFallbackResult {
    let empty_selection_candidate = kept.is_empty() && !fallback.is_empty();
    let mut used_count = 0usize;

    if kept.len() < target_count && !fallback.is_empty() {
        let fallback_needed = target_count.saturating_sub(kept.len());
        let mut seen_ids = kept
            .iter()
            .map(|candidate| candidate.post_id.clone())
            .collect::<HashSet<_>>();
        let mut fallback_ids = HashSet::new();

        for candidate in fallback {
            if used_count >= fallback_needed {
                break;
            }
            if seen_ids.insert(candidate.post_id.clone()) {
                fallback_ids.insert(candidate.post_id.clone());
                kept.push(candidate);
                used_count += 1;
            }
        }

        removed.retain(|candidate| !fallback_ids.contains(&candidate.post_id));
    }

    TrustedFallbackResult {
        used_count,
        empty_selection_recovered: empty_selection_candidate && used_count > 0,
    }
}

pub(super) fn partition(
    candidates: Vec<RecommendationCandidatePayload>,
    keep: impl Fn(&RecommendationCandidatePayload) -> bool,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
) {
    let mut kept = Vec::new();
    let mut removed = Vec::new();
    for candidate in candidates {
        if keep(&candidate) {
            kept.push(candidate);
        } else {
            removed.push(candidate);
        }
    }
    (kept, removed)
}
