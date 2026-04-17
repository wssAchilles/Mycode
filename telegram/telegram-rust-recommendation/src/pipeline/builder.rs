use std::sync::Arc;

use tokio::sync::Mutex;

use crate::{
    candidate_hydrators::configured_candidate_hydrators,
    clients::backend_client::BackendRecommendationClient,
    config::RecommendationConfig,
    filters::configured_filters,
    query_hydrators::configured_query_hydrators,
    scorers::configured_scorers,
    selectors,
    side_effects::configured_side_effects,
    sources::{configured_sources, orchestrator::RecommendationSourceOrchestrator},
    state::recent_store::RecentHotStore,
};

use super::{definition::RecommendationPipelineDefinition, executor::RecommendationPipeline};

pub struct RecommendationPipelineBuilder {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    recent_store: Arc<Mutex<RecentHotStore>>,
}

impl RecommendationPipelineBuilder {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
    ) -> Self {
        Self {
            backend_client,
            config,
            recent_store,
        }
    }

    pub fn build(self) -> RecommendationPipeline {
        let definition = build_pipeline_definition(&self.config);
        let source_orchestrator = RecommendationSourceOrchestrator::new(
            self.backend_client.clone(),
            definition.sources.clone(),
            self.config.graph_source_enabled,
        );

        RecommendationPipeline::new(
            self.backend_client,
            self.config,
            self.recent_store,
            definition,
            source_orchestrator,
        )
    }
}

pub fn build_pipeline_definition(
    config: &RecommendationConfig,
) -> RecommendationPipelineDefinition {
    RecommendationPipelineDefinition {
        pipeline_version: "xalgo_builder_v1".to_string(),
        owner: "rust".to_string(),
        fallback_mode: "node_provider_surface".to_string(),
        query_hydrators: configured_query_hydrators(),
        sources: configured_sources(&config.source_order),
        candidate_hydrators: configured_candidate_hydrators(),
        filters: configured_filters(),
        scorers: configured_scorers(),
        selectors: selectors::configured_selectors(),
        side_effects: configured_side_effects(),
    }
}

#[cfg(test)]
mod tests {
    use crate::config::RecommendationConfig;

    use super::build_pipeline_definition;

    #[test]
    fn builds_xalgorithm_aligned_stage_layout() {
        let config = RecommendationConfig {
            bind_addr: "0.0.0.0:4200".to_string(),
            backend_url: "http://backend:5000/internal/recommendation".to_string(),
            internal_token: None,
            timeout_ms: 3500,
            stage: "retrieval_ranking_v2".to_string(),
            retrieval_mode: "source_orchestrated_graph_v2".to_string(),
            ranking_mode: "phoenix_standardized".to_string(),
            selector_oversample_factor: 5,
            selector_max_size: 200,
            recent_per_user_capacity: 64,
            recent_global_capacity: 256,
            recent_source_enabled: true,
            source_order: vec![
                "FollowingSource".to_string(),
                "GraphSource".to_string(),
                "NewsAnnSource".to_string(),
                "PopularSource".to_string(),
                "TwoTowerSource".to_string(),
                "ColdStartSource".to_string(),
            ],
            graph_source_enabled: true,
        };

        let definition = build_pipeline_definition(&config);

        assert_eq!(definition.pipeline_version, "xalgo_builder_v1");
        assert_eq!(definition.owner, "rust");
        assert_eq!(definition.fallback_mode, "node_provider_surface");
        assert_eq!(
            definition.query_hydrators,
            vec![
                "UserFeaturesHydrator",
                "UserActionSequenceHydrator",
                "ExperimentContextHydrator",
                "NewsModelContextHydrator",
            ]
        );
        assert_eq!(
            definition.sources,
            vec![
                "FollowingSource",
                "GraphSource",
                "NewsAnnSource",
                "PopularSource",
                "TwoTowerSource",
                "ColdStartSource",
            ]
        );
        assert_eq!(
            definition.scorers,
            vec![
                "PhoenixScorer",
                "WeightedScorer",
                "ContentQualityScorer",
                "AuthorAffinityScorer",
                "RecencyScorer",
                "AuthorDiversityScorer",
                "OutOfNetworkScorer",
            ]
        );
        assert_eq!(definition.selectors, vec!["RustTopKSelector"]);
    }
}
