use std::collections::{HashMap, HashSet};
use chrono::{DateTime, Utc};
use crate::contracts::RecommendationCandidatePayload;

/// Shared context computed once per rescoring pass, then borrowed by each factor.
///
/// Pre-computes per-author counts, per-source counts, and impression sets
/// so that individual factors avoid O(N) scans per candidate.
/// All data is owned so the context can be created from a candidate slice
/// without holding borrows that conflict with the mutable iteration loop.
pub(super) struct HeuristicRescoringContext {
    /// Total number of candidates in this batch.
    pub candidate_count: usize,
    /// Number of candidates per author_id.
    pub author_counts: HashMap<String, usize>,
    /// Number of candidates per recall_source.
    pub source_counts: HashMap<String, usize>,
    /// Set of post_ids the user has already seen (from query.seen_ids).
    pub seen_post_ids: HashSet<String>,
    /// Current timestamp for age calculations.
    pub now: DateTime<Utc>,
}

impl HeuristicRescoringContext {
    pub fn new(
        candidates: &[RecommendationCandidatePayload],
        seen_post_ids: &HashSet<String>,
    ) -> Self {
        let mut author_counts: HashMap<String, usize> = HashMap::new();
        let mut source_counts: HashMap<String, usize> = HashMap::new();

        for c in candidates {
            *author_counts.entry(c.author_id.clone()).or_insert(0) += 1;
            if let Some(source) = &c.recall_source {
                *source_counts.entry(source.clone()).or_insert(0) += 1;
            }
        }

        Self {
            candidate_count: candidates.len(),
            author_counts,
            source_counts,
            seen_post_ids: seen_post_ids.clone(),
            now: Utc::now(),
        }
    }
}
