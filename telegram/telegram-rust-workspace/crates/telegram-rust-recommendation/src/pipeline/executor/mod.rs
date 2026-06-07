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
use crate::serving::cache::ServeCacheSnapshot;
use crate::serving::policy::build_query_fingerprint;
use crate::serving::singleflight::{CacheSingleflight, CacheSingleflightSnapshot};
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
    recent_store: Arc<RecentHotStore>,
    metrics: Arc<Mutex<RecommendationMetrics>>,
    source_orchestrator: RecommendationSourceOrchestrator,
    serve_cache: ServeCache,
    cache_singleflight: CacheSingleflight,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<RecentHotStore>,
        metrics: Arc<Mutex<RecommendationMetrics>>,
        definition: RecommendationPipelineDefinition,
        source_orchestrator: RecommendationSourceOrchestrator,
    ) -> Self {
        Self {
            serve_cache: ServeCache::from_config(&config),
            cache_singleflight: CacheSingleflight::new(config.cache_singleflight_enabled),
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

    pub fn cache_control_plane_snapshot(&self) -> CacheControlPlaneSnapshot {
        CacheControlPlaneSnapshot {
            serve_cache: self.serve_cache.snapshot(),
            singleflight: self.cache_singleflight.snapshot(),
        }
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

        if self.cache_singleflight.enabled() {
            let singleflight_query = query.clone();
            let singleflight_fingerprint = query_fingerprint.clone();
            let mut result = self
                .cache_singleflight
                .run(query_fingerprint.clone(), || async move {
                    self.run_live(
                        singleflight_query,
                        singleflight_fingerprint,
                        request_start,
                        serve_cache_duration_ms,
                    )
                    .await
                })
                .await?;
            rewrite_result_request_id(&mut result, &query);
            return Ok(result);
        }

        self.run_live(
            query,
            query_fingerprint,
            request_start,
            serve_cache_duration_ms,
        )
        .await
    }

    async fn run_live(
        &self,
        query: RecommendationQueryPayload,
        query_fingerprint: String,
        request_start: Instant,
        serve_cache_duration_ms: u64,
    ) -> Result<RecommendationResultPayload> {
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

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheControlPlaneSnapshot {
    pub serve_cache: ServeCacheSnapshot,
    pub singleflight: CacheSingleflightSnapshot,
}

fn rewrite_result_request_id(
    result: &mut RecommendationResultPayload,
    query: &RecommendationQueryPayload,
) {
    result.request_id = query.request_id.clone();
    result.cursor = query.cursor;
    result.summary.request_id = query.request_id.clone();
    result.summary.serving.cursor = query.cursor;
    if let Some(trace) = result.summary.trace.as_mut() {
        trace.request_id = query.request_id.clone();
    }
}
