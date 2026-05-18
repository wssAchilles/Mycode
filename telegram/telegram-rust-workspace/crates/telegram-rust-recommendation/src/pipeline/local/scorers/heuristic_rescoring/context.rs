use std::collections::{HashMap, HashSet};
use chrono::{DateTime, Utc};
use crate::contracts::RecommendationCandidatePayload;
use super::media_cluster_diversity::media_cluster_key;

/// Batch-wise statistics for phoenix score normalization.
#[derive(Debug, Default)]
pub(super) struct PhoenixScoreStats {
    pub count: usize,
    pub mean: f64,
    pub std: f64,
}

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
    /// Number of candidates per media cluster key (video_only, image_only, etc.).
    pub media_cluster_counts: HashMap<&'static str, usize>,
    /// Number of candidates per topic_affinity quantile bucket.
    pub topic_affinity_buckets: HashMap<i32, usize>,
    /// Batch-wise phoenix score statistics for MTL normalization.
    pub phoenix_score_stats: PhoenixScoreStats,
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
        let mut media_cluster_counts: HashMap<&str, usize> = HashMap::new();
        let mut topic_affinity_buckets: HashMap<i32, usize> = HashMap::new();
        let mut phoenix_scores: Vec<f64> = Vec::new();

        for c in candidates {
            *author_counts.entry(c.author_id.clone()).or_insert(0) += 1;
            if let Some(source) = &c.recall_source {
                *source_counts.entry(source.clone()).or_insert(0) += 1;
            }
            if let Some(key) = media_cluster_key(c) {
                *media_cluster_counts.entry(key).or_insert(0) += 1;
            }
            let topic_affinity = c
                .ranking_signals
                .as_ref()
                .map(|s| s.topic_affinity)
                .unwrap_or(0.0);
            let bucket = (topic_affinity / 0.2).floor() as i32;
            *topic_affinity_buckets.entry(bucket).or_insert(0) += 1;
            if let Some(like_score) = c.phoenix_scores.as_ref().and_then(|s| s.like_score) {
                phoenix_scores.push(like_score);
            }
        }

        let phoenix_score_stats = compute_phoenix_stats(&phoenix_scores);

        Self {
            candidate_count: candidates.len(),
            author_counts,
            source_counts,
            media_cluster_counts,
            topic_affinity_buckets,
            phoenix_score_stats,
            seen_post_ids: seen_post_ids.clone(),
            now: Utc::now(),
        }
    }
}

fn compute_phoenix_stats(scores: &[f64]) -> PhoenixScoreStats {
    if scores.len() < 2 {
        return PhoenixScoreStats::default();
    }
    let count = scores.len();
    let sum: f64 = scores.iter().sum();
    let mean = sum / count as f64;
    let variance = scores.iter().map(|s| (s - mean).powi(2)).sum::<f64>() / count as f64;
    PhoenixScoreStats {
        count,
        mean,
        std: variance.sqrt(),
    }
}
