use std::collections::HashMap;
use crate::contracts::RecommendationCandidatePayload;

/// Groups candidates by a key for listwise reranking.
///
/// Pre-computes group membership so that the reranking pass can apply
/// position-dependent decay without re-scanning the full candidate list.
pub(super) struct ListwiseGroups {
    /// Maps group key → sorted indices into the candidates slice.
    /// Indices are sorted by weighted_score descending (highest first).
    pub groups: HashMap<String, Vec<usize>>,
}

impl ListwiseGroups {
    /// Group candidates by `author_id`.
    pub fn by_author(candidates: &[RecommendationCandidatePayload]) -> Self {
        let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, c) in candidates.iter().enumerate() {
            groups.entry(c.author_id.clone()).or_default().push(idx);
        }
        // Sort each group by weighted_score descending so the best post comes first.
        for indices in groups.values_mut() {
            indices.sort_by(|&a, &b| {
                let sa = candidates[a].weighted_score.unwrap_or(0.0);
                let sb = candidates[b].weighted_score.unwrap_or(0.0);
                sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        Self { groups }
    }

    /// Group candidates by `recall_source`.
    pub fn by_source(candidates: &[RecommendationCandidatePayload]) -> Self {
        let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, c) in candidates.iter().enumerate() {
            let key = c.recall_source.clone().unwrap_or_default();
            groups.entry(key).or_default().push(idx);
        }
        for indices in groups.values_mut() {
            indices.sort_by(|&a, &b| {
                let sa = candidates[a].weighted_score.unwrap_or(0.0);
                let sb = candidates[b].weighted_score.unwrap_or(0.0);
                sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        Self { groups }
    }
}
