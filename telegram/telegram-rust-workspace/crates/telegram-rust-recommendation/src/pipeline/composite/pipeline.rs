use std::sync::Arc;

use anyhow::Result;

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationResultPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::selectors::top_k::select_candidates;

use super::interleave_merger::InterleaveMerger;
use super::traits::{CandidateGroup, CandidateMerger, ContentPipeline};
use super::weighted_merger::WeightedScoreMerger;
use crate::pipeline::executor::RecommendationPipeline;

/// Default oversample factor for re-selection after merging.
const COMPOSITE_OVERSAMPLE_FACTOR: usize = 2;

/// Default author soft cap for diversity in re-selection.
const COMPOSITE_AUTHOR_SOFT_CAP: usize = 3;

/// Two-level composite pipeline modeled after X's `ForYouCandidatePipeline`.
///
/// Architecture:
/// - **Inner pipeline**: `RecommendationPipeline` — handles post retrieval, scoring, and selection
/// - **Outer content sources**: pluggable `ContentPipeline` implementations for ads, suggestions, etc.
/// - **Merger**: combines candidates from all sources before final selection
///
/// When no outer sources are registered, the composite delegates directly to the inner
/// pipeline with zero overhead. When outer sources exist, it runs them concurrently with
/// the inner pipeline, merges all candidates, and re-runs TopK selection on the combined pool.
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

    /// Build a composite pipeline from an existing inner pipeline with weighted merger.
    pub fn with_weighted_merger(
        inner: RecommendationPipeline,
        config: RecommendationConfig,
        max_source_ratio: f64,
    ) -> Self {
        Self {
            inner,
            outer_sources: Vec::new(),
            merger: Arc::new(WeightedScoreMerger::new(max_source_ratio)),
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
    /// When no outer sources are registered, delegates directly to the inner pipeline.
    /// When outer sources exist, runs them concurrently with the inner pipeline,
    /// merges all candidates, and re-runs TopK selection on the combined pool.
    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        if self.outer_sources.is_empty() {
            return self.inner.run(query).await;
        }

        self.run_composite(query).await
    }

    /// Execute the composite pipeline with outer sources.
    ///
    /// Steps:
    /// 1. Run inner pipeline (full scoring + selection)
    /// 2. Run outer sources concurrently
    /// 3. Merge all candidate groups
    /// 4. Re-run TopK selection on the merged pool
    /// 5. Build result with merged candidates
    async fn run_composite(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        // Step 1 & 2: Run inner pipeline and outer sources concurrently.
        let (inner_result, outer_groups) = self.run_all_sources(&query).await?;

        // Step 3: If no outer candidates produced, return inner result as-is.
        if outer_groups.is_empty() {
            return Ok(inner_result);
        }

        // Step 4: Merge inner and outer candidates, then re-select.
        let final_candidates = self.merge_and_select(
            &query,
            &inner_result,
            outer_groups,
            self.config.selector_max_size,
        );

        // Step 5: Build result with merged candidates.
        Ok(self.build_merged_result(inner_result, final_candidates))
    }

    /// Run the inner pipeline and all outer sources concurrently.
    async fn run_all_sources(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<(RecommendationResultPayload, Vec<CandidateGroup>)> {
        // Spawn inner pipeline.
        let inner_handle = {
            let pipeline = self.inner.clone();
            let query = query.clone();
            tokio::spawn(async move { pipeline.run(query).await })
        };

        // Spawn outer sources.
        let outer_handles: Vec<_> = self
            .outer_sources
            .iter()
            .map(|source| {
                let source = Arc::clone(source);
                let query = query.clone();
                tokio::spawn(async move {
                    let name = source.name().to_string();
                    let candidates = source.retrieve_candidates(&query).await?;
                    Ok::<_, anyhow::Error>(CandidateGroup::new(name, candidates))
                })
            })
            .collect();

        // Collect results.
        let inner_result = inner_handle.await??;

        let mut outer_groups = Vec::new();
        for handle in outer_handles {
            let group = handle.await??;
            if !group.candidates.is_empty() {
                outer_groups.push(group);
            }
        }

        Ok((inner_result, outer_groups))
    }

    /// Merge inner pipeline candidates with outer candidates and re-run TopK selection.
    fn merge_and_select(
        &self,
        query: &RecommendationQueryPayload,
        inner_result: &RecommendationResultPayload,
        outer_groups: Vec<CandidateGroup>,
        max_size: usize,
    ) -> Vec<RecommendationCandidatePayload> {
        // Build the inner candidate group from the inner pipeline's result.
        let inner_group = CandidateGroup::new(
            "inner_pipeline",
            inner_result.candidates.clone(),
        );

        // Combine inner and outer groups.
        let mut all_groups = vec![inner_group];
        all_groups.extend(outer_groups);

        // Merge using the configured merger.
        let merged = self.merger.merge(all_groups, max_size * COMPOSITE_OVERSAMPLE_FACTOR);

        // Re-run TopK selection on merged candidates.
        select_candidates(
            query,
            &merged,
            COMPOSITE_OVERSAMPLE_FACTOR,
            max_size,
            COMPOSITE_AUTHOR_SOFT_CAP,
        )
    }

    /// Build the final result, replacing candidates with the merged selection.
    fn build_merged_result(
        &self,
        inner_result: RecommendationResultPayload,
        final_candidates: Vec<RecommendationCandidatePayload>,
    ) -> RecommendationResultPayload {
        RecommendationResultPayload {
            candidates: final_candidates,
            ..inner_result
        }
    }
}
