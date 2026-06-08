use std::sync::Arc;

use crate::candidate_pipeline::definition::build_pipeline_definition;
use crate::metrics::RecommendationMetrics;
use crate::{
    clients::backend_client::BackendRecommendationClient,
    clients::graph_kernel_client::GraphKernelClient,
    config::RecommendationConfig,
    sources::{
        cached_posts::SourceCache, graph_source::GraphSourceRuntime,
        orchestrator::RecommendationSourceOrchestrator,
    },
    state::recent_store::RecentHotStore,
};

use super::composite::CompositeRecommendationPipeline;
use super::executor::RecommendationPipeline;

pub struct RecommendationPipelineBuilder {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    recent_store: Arc<RecentHotStore>,
    metrics: Arc<tokio::sync::Mutex<RecommendationMetrics>>,
}

impl RecommendationPipelineBuilder {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<RecentHotStore>,
        metrics: Arc<tokio::sync::Mutex<RecommendationMetrics>>,
    ) -> Self {
        Self {
            backend_client,
            config,
            recent_store,
            metrics,
        }
    }

    /// Build the inner recommendation pipeline.
    pub fn build(self) -> RecommendationPipeline {
        let definition = build_pipeline_definition(&self.config);
        let graph_source_runtime = GraphSourceRuntime::new(
            self.backend_client.clone(),
            GraphKernelClient::from_config(&self.config),
            self.config.graph_materializer_limit_per_author,
            self.config.graph_materializer_lookback_days,
            self.config
                .graph_kernel_timeout_ms
                .min(self.config.timeout_ms),
        );
        let source_cache = SourceCache::new(
            &self.config.redis_url,
            self.config.source_cache_enabled,
            self.config.source_cache_ttl_secs,
            &self.config.source_cache_prefix,
        );
        let source_orchestrator = RecommendationSourceOrchestrator::new(
            self.backend_client.clone(),
            graph_source_runtime,
            definition.sources.clone(),
            self.config.graph_source_enabled,
            definition.source_concurrency,
            source_cache,
        );

        RecommendationPipeline::new(
            self.backend_client,
            self.config,
            self.recent_store,
            self.metrics,
            definition,
            source_orchestrator,
        )
    }

    /// Build a composite pipeline that wraps the inner pipeline.
    ///
    /// The composite pipeline supports pluggable outer content sources
    /// (ads, suggestions, prompts) that are merged with the inner pipeline's
    /// candidates before final selection.
    pub fn build_composite(self) -> CompositeRecommendationPipeline {
        let config = self.config.clone();
        let inner = self.build();
        CompositeRecommendationPipeline::new(inner, config)
    }
}
