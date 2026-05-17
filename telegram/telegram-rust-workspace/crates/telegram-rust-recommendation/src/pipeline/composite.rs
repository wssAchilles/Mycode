use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::Result;

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationResultPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;

use super::executor::RecommendationPipeline;

/// A content source that produces ranked candidates for blending into the feed.
///
/// Each implementation represents a distinct content type (posts, ads, suggestions)
/// with its own retrieval, scoring, and filtering logic.
pub trait ContentPipeline: Send + Sync {
    /// Human-readable name for telemetry and logging.
    fn name(&self) -> &str;

    /// Produce ranked candidates for the given query.
    fn retrieve_candidates(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<RecommendationCandidatePayload>>> + Send + '_>>;
}

/// Merges candidates from multiple content pipelines into a single ordered list.
///
/// The merger applies inter-source diversity rules and priority balancing
/// before handing off to the final selector.
pub trait CandidateMerger: Send + Sync {
    fn merge(
        &self,
        groups: Vec<(String, Vec<RecommendationCandidatePayload>)>,
        max_size: usize,
    ) -> Vec<RecommendationCandidatePayload>;
}

/// Round-robin interleave merger that balances content types.
///
/// Picks candidates from each source group in round-robin order,
/// ensuring no single source dominates the feed.
pub struct InterleaveMerger;

impl CandidateMerger for InterleaveMerger {
    fn merge(
        &self,
        groups: Vec<(String, Vec<RecommendationCandidatePayload>)>,
        max_size: usize,
    ) -> Vec<RecommendationCandidatePayload> {
        let mut iterators: Vec<_> = groups
            .into_iter()
            .map(|(_name, candidates)| candidates.into_iter())
            .collect();

        let mut merged = Vec::with_capacity(max_size);
        loop {
            let mut any_advanced = false;
            for iter in &mut iterators {
                if let Some(candidate) = iter.next() {
                    merged.push(candidate);
                    any_advanced = true;
                    if merged.len() >= max_size {
                        return merged;
                    }
                }
            }
            if !any_advanced {
                break;
            }
        }
        merged
    }
}

/// Two-level composite pipeline modeled after X's `ForYouCandidatePipeline`.
///
/// Architecture:
/// - **Inner pipeline**: `RecommendationPipeline` — handles post retrieval, scoring, and selection
/// - **Outer content sources**: pluggable `ContentPipeline` implementations for ads, suggestions, etc.
/// - **Merger**: combines candidates from all sources before final selection
///
/// Currently the outer sources are empty (ads/prompts not implemented).
/// The composite structure provides the extension point for future content types.
pub struct CompositeRecommendationPipeline {
    inner: RecommendationPipeline,
    outer_sources: Vec<Arc<dyn ContentPipeline>>,
    merger: Arc<dyn CandidateMerger>,
    config: RecommendationConfig,
}

impl CompositeRecommendationPipeline {
    pub fn new(inner: RecommendationPipeline, config: RecommendationConfig) -> Self {
        Self {
            inner,
            outer_sources: Vec::new(),
            merger: Arc::new(InterleaveMerger),
            config,
        }
    }

    /// Register an outer content pipeline (ads, suggestions, prompts, etc.).
    pub fn with_outer_source(mut self, source: Arc<dyn ContentPipeline>) -> Self {
        self.outer_sources.push(source);
        self
    }

    /// Replace the default interleave merger with a custom implementation.
    pub fn with_merger(mut self, merger: Arc<dyn CandidateMerger>) -> Self {
        self.merger = merger;
        self
    }

    pub fn definition(&self) -> &RecommendationPipelineDefinition {
        self.inner.definition()
    }

    /// Run the composite pipeline.
    ///
    /// When no outer sources are registered, delegates directly to the inner pipeline
    /// with zero overhead. When outer sources exist, runs them concurrently with the
    /// inner pipeline and merges all candidates before selection.
    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        if self.outer_sources.is_empty() {
            return self.inner.run(query).await;
        }

        // Run inner pipeline and all outer sources concurrently.
        let inner_handle = {
            let pipeline = self.inner.clone();
            let query = query.clone();
            tokio::spawn(async move { pipeline.run(query).await })
        };

        let outer_handles: Vec<_> = self
            .outer_sources
            .iter()
            .map(|source| {
                let source = Arc::clone(source);
                let query = query.clone();
                tokio::spawn(async move {
                    let name = source.name().to_string();
                    let candidates = source.retrieve_candidates(&query).await?;
                    Ok::<_, anyhow::Error>((name, candidates))
                })
            })
            .collect();

        // Wait for inner pipeline result.
        let inner_result = inner_handle.await??;

        // Collect outer candidates.
        let mut outer_groups = Vec::new();
        for handle in outer_handles {
            let (name, candidates) = handle.await??;
            if !candidates.is_empty() {
                outer_groups.push((name, candidates));
            }
        }

        // If no outer candidates produced, return inner result as-is.
        if outer_groups.is_empty() {
            return Ok(inner_result);
        }

        // Merge outer candidates into the inner result.
        // For now this is a placeholder — the merger combines outer candidates
        // but the inner pipeline's selection already happened. A full implementation
        // would re-run selection after merging. This provides the structural hook.
        let _merged = self.merger.merge(
            outer_groups,
            self.config.selector_max_size,
        );

        // TODO: Re-run selection with merged candidates when ads/prompts are implemented.
        // For now, return the inner result unchanged.
        Ok(inner_result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn interleave_merger_balances_sources() {
        let merger = InterleaveMerger;

        let a: Vec<_> = (0..3)
            .map(|i| make_test_candidate(&format!("a-{i}")))
            .collect();
        let b: Vec<_> = (0..3)
            .map(|i| make_test_candidate(&format!("b-{i}")))
            .collect();

        let groups = vec![("SourceA".to_string(), a), ("SourceB".to_string(), b)];

        let merged = merger.merge(groups, 10);
        assert_eq!(merged.len(), 6);

        // Verify interleaving: a0, b0, a1, b1, a2, b2
        let ids: Vec<_> = merged.iter().map(|c| c.post_id.clone()).collect();
        assert_eq!(ids[0], "a-0");
        assert_eq!(ids[1], "b-0");
        assert_eq!(ids[2], "a-1");
        assert_eq!(ids[3], "b-1");
        assert_eq!(ids[4], "a-2");
        assert_eq!(ids[5], "b-2");
    }

    #[test]
    fn interleave_merger_respects_max_size() {
        let merger = InterleaveMerger;

        let a: Vec<_> = (0..5)
            .map(|i| make_test_candidate(&format!("a-{i}")))
            .collect();
        let b: Vec<_> = (0..5)
            .map(|i| make_test_candidate(&format!("b-{i}")))
            .collect();

        let groups = vec![("SourceA".to_string(), a), ("SourceB".to_string(), b)];

        let merged = merger.merge(groups, 4);
        assert_eq!(merged.len(), 4);
    }

    #[test]
    fn interleave_merger_handles_empty_source() {
        let merger = InterleaveMerger;

        let a: Vec<_> = (0..2)
            .map(|i| make_test_candidate(&format!("a-{i}")))
            .collect();

        let groups = vec![("SourceA".to_string(), a), ("SourceB".to_string(), vec![])];

        let merged = merger.merge(groups, 10);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn interleave_merger_handles_all_empty() {
        let merger = InterleaveMerger;
        let groups = vec![
            ("A".to_string(), vec![]),
            ("B".to_string(), vec![]),
        ];
        let merged = merger.merge(groups, 10);
        assert!(merged.is_empty());
    }

    #[test]
    fn interleave_merger_single_source() {
        let merger = InterleaveMerger;
        let a: Vec<_> = (0..3)
            .map(|i| make_test_candidate(&format!("a-{i}")))
            .collect();
        let groups = vec![("Only".to_string(), a)];
        let merged = merger.merge(groups, 10);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].post_id, "a-0");
        assert_eq!(merged[1].post_id, "a-1");
        assert_eq!(merged[2].post_id, "a-2");
    }

    fn make_test_candidate(id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
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
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            pipeline_score: None,
            score_breakdown: None,
        }
    }
}
