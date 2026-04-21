use std::sync::Arc;

use tokio::sync::Mutex;

use crate::candidate_pipeline::definition::build_pipeline_definition;
use crate::metrics::RecommendationMetrics;
use crate::{
    clients::backend_client::BackendRecommendationClient,
    clients::graph_kernel_client::GraphKernelClient,
    config::RecommendationConfig,
    sources::{graph_source::GraphSourceRuntime, orchestrator::RecommendationSourceOrchestrator},
    state::recent_store::RecentHotStore,
};

use super::executor::RecommendationPipeline;

pub struct RecommendationPipelineBuilder {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    recent_store: Arc<Mutex<RecentHotStore>>,
    metrics: Arc<Mutex<RecommendationMetrics>>,
}

impl RecommendationPipelineBuilder {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
        metrics: Arc<Mutex<RecommendationMetrics>>,
    ) -> Self {
        Self {
            backend_client,
            config,
            recent_store,
            metrics,
        }
    }

    pub fn build(self) -> RecommendationPipeline {
        let definition = build_pipeline_definition(&self.config);
        let graph_source_runtime = GraphSourceRuntime::new(
            self.backend_client.clone(),
            GraphKernelClient::from_config(&self.config),
            self.config.graph_materializer_limit_per_author,
            self.config.graph_materializer_lookback_days,
        );
        let source_orchestrator = RecommendationSourceOrchestrator::new(
            self.backend_client.clone(),
            graph_source_runtime,
            definition.sources.clone(),
            self.config.graph_source_enabled,
            definition.source_concurrency,
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
}
