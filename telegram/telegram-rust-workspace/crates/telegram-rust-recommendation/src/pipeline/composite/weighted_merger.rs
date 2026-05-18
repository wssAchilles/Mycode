use crate::contracts::RecommendationCandidatePayload;

use super::traits::{CandidateGroup, CandidateMerger};

/// Score-based merger that ranks candidates across sources by weighted_score.
///
/// Unlike the round-robin `InterleaveMerger`, this merger produces a globally
/// optimal ordering by sorting all candidates by their weighted_score descending.
/// Source diversity is ensured by applying a per-source cap: no single source
/// may occupy more than `max_source_ratio` of the final slots.
///
/// Modeled after X's approach where the inner pipeline (Phoenix) produces
/// scored posts and outer pipelines (ads, WTF) produce scored suggestions,
/// then a global ranking selects the best candidates.
pub struct WeightedScoreMerger {
    /// Maximum fraction of slots a single source can occupy (0.0 - 1.0).
    pub max_source_ratio: f64,
}

impl WeightedScoreMerger {
    pub fn new(max_source_ratio: f64) -> Self {
        Self {
            max_source_ratio: max_source_ratio.clamp(0.0, 1.0),
        }
    }
}

impl Default for WeightedScoreMerger {
    fn default() -> Self {
        Self::new(0.7)
    }
}

impl CandidateMerger for WeightedScoreMerger {
    fn merge(
        &self,
        groups: Vec<CandidateGroup>,
        max_size: usize,
    ) -> Vec<RecommendationCandidatePayload> {
        let max_per_source = ((max_size as f64) * self.max_source_ratio).ceil() as usize;

        // Flatten all candidates with source tracking.
        let mut all_candidates: Vec<(String, RecommendationCandidatePayload)> = Vec::new();
        for group in groups {
            for candidate in group.candidates {
                all_candidates.push((group.source_name.clone(), candidate));
            }
        }

        // Sort by weighted_score descending (None treated as 0.0).
        all_candidates.sort_by(|a, b| {
            let score_a = a.1.weighted_score.unwrap_or(0.0);
            let score_b = b.1.weighted_score.unwrap_or(0.0);
            score_b
                .partial_cmp(&score_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Greedy selection with per-source cap.
        let mut merged = Vec::with_capacity(max_size);
        let mut source_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

        for (source, candidate) in all_candidates {
            if merged.len() >= max_size {
                break;
            }

            let count = source_counts.entry(source).or_insert(0);
            if *count >= max_per_source {
                continue;
            }

            *count += 1;
            merged.push(candidate);
        }

        merged
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::make_test_candidate;
    use super::*;

    #[test]
    fn sorts_by_score_descending() {
        let merger = WeightedScoreMerger::new(1.0);
        let group = CandidateGroup::new(
            "posts",
            vec![
                make_candidate("low", 0.2),
                make_candidate("high", 0.9),
                make_candidate("mid", 0.5),
            ],
        );

        let merged = merger.merge(vec![group], 10);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].post_id, "high");
        assert_eq!(merged[1].post_id, "mid");
        assert_eq!(merged[2].post_id, "low");
    }

    #[test]
    fn respects_max_size() {
        let merger = WeightedScoreMerger::new(1.0);
        let group = CandidateGroup::new(
            "posts",
            (0..10)
                .map(|i| make_candidate(&format!("p-{i}"), 0.5))
                .collect(),
        );

        let merged = merger.merge(vec![group], 5);
        assert_eq!(merged.len(), 5);
    }

    #[test]
    fn source_cap_prevents_dominance() {
        let merger = WeightedScoreMerger::new(0.5);
        let posts = CandidateGroup::new(
            "posts",
            (0..8)
                .map(|i| make_candidate(&format!("p-{i}"), 0.9 - i as f64 * 0.1))
                .collect(),
        );
        let ads = CandidateGroup::new(
            "ads",
            vec![
                make_candidate("ad-0", 0.95),
                make_candidate("ad-1", 0.85),
                make_candidate("ad-2", 0.75),
            ],
        );

        let merged = merger.merge(vec![posts, ads], 4);
        assert_eq!(merged.len(), 4);
        let post_count = merged.iter().filter(|c| c.post_id.starts_with('p')).count();
        assert!(post_count <= 2, "posts dominated: {post_count}/4");
    }

    #[test]
    fn merges_across_sources_by_score() {
        let merger = WeightedScoreMerger::new(1.0);
        let posts = CandidateGroup::new(
            "posts",
            vec![make_candidate("p-0", 0.8), make_candidate("p-1", 0.4)],
        );
        let ads = CandidateGroup::new("ads", vec![make_candidate("ad-0", 0.6)]);

        let merged = merger.merge(vec![posts, ads], 10);
        assert_eq!(merged[0].post_id, "p-0");
        assert_eq!(merged[1].post_id, "ad-0");
        assert_eq!(merged[2].post_id, "p-1");
    }

    #[test]
    fn treats_none_score_as_zero() {
        let merger = WeightedScoreMerger::new(1.0);
        let group = CandidateGroup::new(
            "posts",
            vec![
                make_candidate("scored", 0.7),
                make_candidate("unscored", f64::NAN),
            ],
        );

        let merged = merger.merge(vec![group], 10);
        assert_eq!(merged[0].post_id, "scored");
    }

    fn make_candidate(id: &str, score: f64) -> RecommendationCandidatePayload {
        let mut candidate = make_test_candidate(id, "author-1");
        candidate.weighted_score = Some(score);
        candidate
    }
}
