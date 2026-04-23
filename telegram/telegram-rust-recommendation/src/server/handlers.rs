use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use tracing::error;

use crate::candidate_pipeline::manifest::build_stage_manifest;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationOpsRuntime, RecommendationQueryPayload, RecommendationResultPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;

use super::state::AppState;
use super::types::{HealthResponse, RecommendationOpsResponse, RecommendationOpsSummaryResponse};

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "rust_recommendation",
        stage: state.config.stage.clone(),
    })
}

pub async fn recommendation_candidates(
    State(state): State<AppState>,
    Json(query): Json<RecommendationQueryPayload>,
) -> Result<Json<RecommendationResultPayload>, (StatusCode, String)> {
    match state.pipeline.run(query.clone()).await {
        Ok(result) => {
            let mut metrics = state.metrics.lock().await;
            metrics.record_success(&result.summary);
            Ok(Json(result))
        }
        Err(error) => {
            error!(
                request_id = %query.request_id,
                err = ?error,
                "recommendation pipeline failed"
            );
            let mut metrics = state.metrics.lock().await;
            metrics.record_failure(Some(&query.request_id), &error.to_string());
            Err((
                StatusCode::BAD_GATEWAY,
                format!("recommendation_pipeline_failed: {error}"),
            ))
        }
    }
}

pub async fn recommendation_ops(State(state): State<AppState>) -> Json<RecommendationOpsResponse> {
    let recent_snapshot = {
        let store = state.recent_store.lock().await;
        store.snapshot()
    };
    let summary = {
        let metrics = state.metrics.lock().await;
        metrics.build_summary(&state.config.stage, recent_snapshot.clone())
    };

    Json(RecommendationOpsResponse {
        status: summary.status.clone(),
        runtime: build_runtime(&state.config, state.pipeline.definition()),
        summary,
        recent_store: recent_snapshot,
    })
}

pub async fn recommendation_ops_summary(
    State(state): State<AppState>,
) -> Json<RecommendationOpsSummaryResponse> {
    let recent_snapshot = {
        let store = state.recent_store.lock().await;
        store.snapshot()
    };
    let summary = {
        let metrics = state.metrics.lock().await;
        metrics.build_summary(&state.config.stage, recent_snapshot)
    };

    Json(RecommendationOpsSummaryResponse {
        runtime: build_runtime(&state.config, state.pipeline.definition()),
        summary,
    })
}

pub fn build_runtime(
    config: &RecommendationConfig,
    definition: &RecommendationPipelineDefinition,
) -> RecommendationOpsRuntime {
    let graph_provider_mode = definition.graph_provider_mode(config);

    RecommendationOpsRuntime {
        stage: config.stage.clone(),
        backend_url: config.backend_url.clone(),
        redis_url: redact_url_credentials(&config.redis_url),
        retrieval_mode: config.retrieval_mode.clone(),
        ranking_mode: config.ranking_mode.clone(),
        serving_version: definition.serving_version.clone(),
        cursor_mode: definition.cursor_mode.clone(),
        stage_execution_mode: definition.stage_execution_mode.clone(),
        runtime_contract_version: definition.runtime_contract_version.clone(),
        component_order_hash: definition.component_order_hash.clone(),
        query_hydrator_execution_mode: definition.query_hydrator_execution_mode.clone(),
        source_execution_mode: definition.source_execution_mode.clone(),
        candidate_hydrator_execution_mode: definition.candidate_hydrator_execution_mode.clone(),
        post_selection_hydrator_execution_mode: definition
            .post_selection_hydrator_execution_mode
            .clone(),
        query_hydrator_transport_mode: definition.query_hydrator_transport_mode.clone(),
        source_transport_mode: definition.source_transport_mode.clone(),
        candidate_hydrator_transport_mode: definition.candidate_hydrator_transport_mode.clone(),
        post_selection_hydrator_transport_mode: definition
            .post_selection_hydrator_transport_mode
            .clone(),
        provider_latency_mode: definition.provider_latency_mode.clone(),
        graph_materializer_cache_mode: definition.graph_materializer_cache_mode.clone(),
        source_policy_mode: definition.source_policy_mode.clone(),
        guardrail_mode: definition.guardrail_mode.clone(),
        provider_latency_budget_ms: definition.provider_latency_budget_ms,
        source_batch_component_timeout_ms: definition.source_batch_component_timeout_ms,
        query_hydrator_concurrency: definition.query_hydrator_concurrency,
        source_concurrency: definition.source_concurrency,
        candidate_hydrator_concurrency: definition.candidate_hydrator_concurrency,
        post_selection_hydrator_concurrency: definition.post_selection_hydrator_concurrency,
        pipeline_version: definition.pipeline_version.clone(),
        owner: definition.owner.clone(),
        fallback_mode: definition.fallback_mode.clone(),
        graph_provider_mode: graph_provider_mode.clone(),
        graph_kernel_url: config.graph_kernel_url.clone(),
        query_hydrators: definition.query_hydrators.clone(),
        source_order: definition.sources.clone(),
        candidate_hydrators: definition.candidate_hydrators.clone(),
        filters: definition.filters.clone(),
        scorers: definition.scorers.clone(),
        selectors: definition.selectors.clone(),
        post_selection_hydrators: definition.post_selection_hydrators.clone(),
        post_selection_filters: definition.post_selection_filters.clone(),
        side_effects: definition.side_effects.clone(),
        graph_source_enabled: config.graph_source_enabled,
        graph_materializer_limit_per_author: config.graph_materializer_limit_per_author,
        graph_materializer_lookback_days: config.graph_materializer_lookback_days,
        recent_global_capacity: config.recent_global_capacity,
        recent_per_user_capacity: config.recent_per_user_capacity,
        selector_oversample_factor: config.selector_oversample_factor,
        selector_max_size: config.selector_max_size,
        serve_cache_enabled: config.serve_cache_enabled,
        serve_cache_ttl_secs: config.serve_cache_ttl_secs,
        serve_cache_prefix: config.serve_cache_prefix.clone(),
        serve_cache_key_mode: definition.serve_cache_key_mode.clone(),
        serve_cache_policy_mode: definition.serve_cache_policy_mode.clone(),
        async_side_effect_mode: definition.async_side_effect_mode.clone(),
        pipeline_stage_manifest: build_stage_manifest(definition, &graph_provider_mode),
        serving_author_soft_cap: config.serving_author_soft_cap,
    }
}

fn redact_url_credentials(url: &str) -> String {
    if let Some((_, rest)) = url.rsplit_once('@') {
        return format!("***@{rest}");
    }
    url.to_string()
}
