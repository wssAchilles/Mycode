use std::collections::HashMap;
use std::collections::HashSet;

use async_trait::async_trait;
use tracing::info;

use super::{DiversityStats, SideEffect, SideEffectContext, SideEffectError};

/// Side effect that computes and logs diversity statistics.
///
/// Diversity metrics help monitor the quality of recommendations by tracking
/// how varied the results are across sources, authors, and topics.
pub struct DiversityStatsSideEffect {
    /// Minimum number of candidates to compute stats for.
    min_candidates: usize,
}

impl DiversityStatsSideEffect {
    /// Create a new diversity stats side effect.
    pub fn new(min_candidates: usize) -> Self {
        Self { min_candidates }
    }

    /// Create with default settings.
    pub fn default_config() -> Self {
        Self::new(1)
    }

    /// Compute diversity statistics from candidates.
    pub fn compute_stats(
        candidates: &[crate::contracts::RecommendationCandidatePayload],
    ) -> DiversityStats {
        if candidates.is_empty() {
            return DiversityStats::default();
        }

        let total_candidates = candidates.len();

        // Compute source distribution.
        let source_distribution: HashMap<String, usize> = candidates
            .iter()
            .filter_map(|c| c.recall_source.as_deref())
            .fold(HashMap::new(), |mut acc, source| {
                *acc.entry(source.to_string()).or_insert(0) += 1;
                acc
            });
        let unique_source_count = source_distribution.len();

        // Compute author distribution.
        let author_distribution: HashMap<String, usize> = candidates
            .iter()
            .fold(HashMap::new(), |mut acc, candidate| {
                *acc.entry(candidate.author_id.clone()).or_insert(0) += 1;
                acc
            });
        let unique_author_count = author_distribution.len();

        // Compute topic distribution.
        let all_topics: HashSet<String> = candidates
            .iter()
            .flat_map(|c| c.topic_ids.iter().cloned())
            .collect();
        let unique_topic_count = all_topics.len();

        let topic_distribution: HashMap<String, usize> = candidates
            .iter()
            .flat_map(|c| c.topic_ids.iter().cloned())
            .fold(HashMap::new(), |mut acc, topic| {
                *acc.entry(topic).or_insert(0) += 1;
                acc
            });

        let total = total_candidates as f64;

        DiversityStats {
            unique_source_count,
            total_candidates,
            unique_source_ratio: unique_source_count as f64 / total,
            unique_author_count,
            unique_author_ratio: unique_author_count as f64 / total,
            unique_topic_count,
            unique_topic_ratio: if unique_topic_count > 0 {
                unique_topic_count as f64 / total
            } else {
                0.0
            },
            source_distribution,
            author_distribution,
            topic_distribution,
        }
    }
}

#[async_trait]
impl SideEffect for DiversityStatsSideEffect {
    async fn execute(&self, context: &SideEffectContext) -> Result<(), SideEffectError> {
        let candidates = &context.candidates;

        if candidates.len() < self.min_candidates {
            return Ok(());
        }

        let stats = Self::compute_stats(candidates);

        info!(
            user_id = %context.user_id,
            request_id = %context.query.request_id,
            total_candidates = stats.total_candidates,
            unique_sources = stats.unique_source_count,
            unique_source_ratio = %format!("{:.3}", stats.unique_source_ratio),
            unique_authors = stats.unique_author_count,
            unique_author_ratio = %format!("{:.3}", stats.unique_author_ratio),
            unique_topics = stats.unique_topic_count,
            unique_topic_ratio = %format!("{:.3}", stats.unique_topic_ratio),
            "diversity stats computed"
        );

        // Log top sources.
        let mut top_sources: Vec<_> = stats.source_distribution.iter().collect();
        top_sources.sort_by(|a, b| b.1.cmp(a.1));
        let top_source_summary: Vec<String> = top_sources
            .iter()
            .take(5)
            .map(|(source, count)| format!("{source}:{count}"))
            .collect();

        if !top_source_summary.is_empty() {
            info!(
                user_id = %context.user_id,
                top_sources = %top_source_summary.join(", "),
                "top recommendation sources"
            );
        }

        // Log top authors.
        let mut top_authors: Vec<_> = stats.author_distribution.iter().collect();
        top_authors.sort_by(|a, b| b.1.cmp(a.1));
        let top_author_summary: Vec<String> = top_authors
            .iter()
            .take(5)
            .map(|(author, count)| format!("{author}:{count}"))
            .collect();

        if !top_author_summary.is_empty() {
            info!(
                user_id = %context.user_id,
                top_authors = %top_author_summary.join(", "),
                "top recommendation authors"
            );
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

    fn candidate(
        post_id: &str,
        author_id: &str,
        source: Option<&str>,
        topics: Vec<&str>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: "test content".to_string(),
            created_at: chrono::Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: source.map(|s| s.to_string()),
            retrieval_lane: None,
            interest_pool_kind: None,
            topic_ids: topics.iter().map(|t| t.to_string()).collect(),
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: Default::default(),
            video_duration_ms: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            author_blocks_viewer: None,
            language_code: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            is_subscription_only: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
        }
    }

    #[test]
    fn computes_diversity_stats_correctly() {
        let candidates = vec![
            candidate("post-1", "author-1", Some("GraphSource"), vec!["topic-a"]),
            candidate("post-2", "author-2", Some("GraphSource"), vec!["topic-b"]),
            candidate("post-3", "author-1", Some("PopularSource"), vec!["topic-a"]),
            candidate("post-4", "author-3", Some("TwoTowerSource"), vec!["topic-c"]),
        ];

        let stats = DiversityStatsSideEffect::compute_stats(&candidates);

        assert_eq!(stats.total_candidates, 4);
        assert_eq!(stats.unique_source_count, 3);
        assert_eq!(stats.unique_author_count, 3);
        assert_eq!(stats.unique_topic_count, 3);
        assert!((stats.unique_source_ratio - 0.75).abs() < f64::EPSILON);
        assert!((stats.unique_author_ratio - 0.75).abs() < f64::EPSILON);
    }

    #[test]
    fn handles_empty_candidates() {
        let candidates = Vec::new();
        let stats = DiversityStatsSideEffect::compute_stats(&candidates);

        assert_eq!(stats.total_candidates, 0);
        assert_eq!(stats.unique_source_count, 0);
        assert_eq!(stats.unique_author_count, 0);
    }

    #[test]
    fn computes_source_distribution() {
        let candidates = vec![
            candidate("post-1", "author-1", Some("GraphSource"), vec![]),
            candidate("post-2", "author-2", Some("GraphSource"), vec![]),
            candidate("post-3", "author-3", Some("PopularSource"), vec![]),
        ];

        let stats = DiversityStatsSideEffect::compute_stats(&candidates);

        assert_eq!(stats.source_distribution.get("GraphSource"), Some(&2));
        assert_eq!(stats.source_distribution.get("PopularSource"), Some(&1));
    }

    #[tokio::test]
    async fn diversity_stats_side_effect_logs_stats() {
        let side_effect = DiversityStatsSideEffect::new(1);
        let context = SideEffectContext {
            user_id: "user-1".to_string(),
            candidates: vec![
                candidate("post-1", "author-1", Some("GraphSource"), vec!["topic-a"]),
                candidate("post-2", "author-2", Some("PopularSource"), vec!["topic-b"]),
            ],
            query: RecommendationQueryPayload {
                request_id: "req-test".to_string(),
                user_id: "user-1".to_string(),
                limit: 20,
                cursor: None,
                in_network_only: false,
                seen_ids: Vec::new(),
                served_ids: Vec::new(),
                is_bottom_request: false,
                client_app_id: None,
                country_code: None,
                language_code: None,
                user_features: None,
                embedding_context: None,
                user_state_context: None,
                user_action_sequence: None,
                news_history_external_ids: None,
                model_user_action_sequence: None,
                experiment_context: None,
                ranking_policy: None,
                user_signal_features: None,
                interested_topics: None,
                mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
            },
            request_hash: "test-hash".to_string(),
        };

        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn diversity_stats_side_effect_skips_small_results() {
        let side_effect = DiversityStatsSideEffect::new(5);
        let context = SideEffectContext {
            user_id: "user-1".to_string(),
            candidates: vec![
                candidate("post-1", "author-1", Some("GraphSource"), vec![]),
            ],
            query: RecommendationQueryPayload {
                request_id: "req-test".to_string(),
                user_id: "user-1".to_string(),
                limit: 20,
                cursor: None,
                in_network_only: false,
                seen_ids: Vec::new(),
                served_ids: Vec::new(),
                is_bottom_request: false,
                client_app_id: None,
                country_code: None,
                language_code: None,
                user_features: None,
                embedding_context: None,
                user_state_context: None,
                user_action_sequence: None,
                news_history_external_ids: None,
                model_user_action_sequence: None,
                experiment_context: None,
                ranking_policy: None,
                user_signal_features: None,
                interested_topics: None,
                mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
            },
            request_hash: "test-hash".to_string(),
        };

        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }
}
