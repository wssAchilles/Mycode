use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Mutex;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::serving::cache::ServeCache;
use crate::serving::policy::build_query_fingerprint;
use crate::sources::orchestrator::RecommendationSourceOrchestrator;
use crate::state::recent_store::RecentHotStore;

mod cache_replay;
mod completion;
mod component_activation;
mod post_selection_stage;
mod query_hydration;
mod query_stage;
mod ranking_stage;
mod recent_hot_topup;
mod rescue_stage;
mod response;
mod retrieval_stage;
mod selection_stage;
mod serving_stage;
mod stage_runner;
mod summary;
mod telemetry;
mod trace;

use response::{LiveRecommendationResultInput, build_live_recommendation_result};
use telemetry::RunTelemetry;

const SELF_POST_RESCUE_LOOKBACK_DAYS: usize = 180;

#[derive(Clone)]
pub struct RecommendationPipeline {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    definition: RecommendationPipelineDefinition,
    recent_store: Arc<Mutex<RecentHotStore>>,
    metrics: Arc<Mutex<RecommendationMetrics>>,
    source_orchestrator: RecommendationSourceOrchestrator,
    serve_cache: ServeCache,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
        metrics: Arc<Mutex<RecommendationMetrics>>,
        definition: RecommendationPipelineDefinition,
        source_orchestrator: RecommendationSourceOrchestrator,
    ) -> Self {
        Self {
            serve_cache: ServeCache::from_config(&config),
            backend_client,
            config,
            definition,
            recent_store,
            metrics,
            source_orchestrator,
        }
    }

    pub fn definition(&self) -> &RecommendationPipelineDefinition {
        &self.definition
    }

    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        let request_start = Instant::now();
        let query_fingerprint = build_query_fingerprint(&query);
        let serve_cache_start = Instant::now();
        let serve_cache_lookup = self.serve_cache.get(&query_fingerprint).await;
        let serve_cache_duration_ms = serve_cache_start.elapsed().as_millis() as u64;
        if let Some(cached_result) = serve_cache_lookup.result {
            return Ok(self.rebuild_cached_result(
                cached_result,
                &query,
                &query_fingerprint,
                serve_cache_duration_ms,
                request_start.elapsed().as_millis() as u64,
            ));
        }

        let mut telemetry = RunTelemetry::default();
        self.record_serve_cache_miss_stage(
            &mut telemetry,
            &query_fingerprint,
            serve_cache_duration_ms,
        );

        let query_stage = self.execute_query_stage(&query, &mut telemetry).await;
        let hydrated_query = query_stage.hydrated_query;
        let retrieval_stage = self
            .execute_retrieval_stage(
                &hydrated_query,
                &query_stage.circuit_open_sources,
                &mut telemetry,
            )
            .await?;
        let ranking_stage = self
            .execute_ranking_stage(
                &hydrated_query,
                &retrieval_stage.retrieved,
                &query_stage.circuit_open_hydrators,
                &mut telemetry,
            )
            .await?;
        let oversampled = self.execute_selector_stage(
            &hydrated_query,
            &ranking_stage.scored_candidates,
            &mut telemetry,
        );
        let final_candidates = self
            .execute_post_selection_stage(
                &hydrated_query,
                &oversampled,
                &query_stage.circuit_open_hydrators,
                &mut telemetry,
            )
            .await?;
        let final_candidates = self
            .rescue_empty_selection(&hydrated_query, final_candidates, &mut telemetry)
            .await;
        let serving = self.execute_serving_stage(&hydrated_query, final_candidates, &mut telemetry);

        let mut result = build_live_recommendation_result(LiveRecommendationResultInput {
            config: &self.config,
            definition: &self.definition,
            hydrated_query: &hydrated_query,
            retrieval: retrieval_stage,
            ranking: ranking_stage,
            serving,
            telemetry,
            page_build_duration_ms: request_start.elapsed().as_millis() as u64,
        });

        self.dispatch_live_post_response_side_effects(
            &hydrated_query,
            query_fingerprint,
            &mut result,
        );

        Ok(result)
    }
}
