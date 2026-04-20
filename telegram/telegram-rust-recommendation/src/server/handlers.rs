use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use tracing::error;

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationOpsRuntime, RecommendationQueryPayload, RecommendationResultPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::serving::cursor::{CURSOR_MODE, SERVING_VERSION};
use crate::serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE};
use crate::side_effects::runtime::ASYNC_SIDE_EFFECT_MODE;

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
    RecommendationOpsRuntime {
        stage: config.stage.clone(),
        backend_url: config.backend_url.clone(),
        redis_url: redact_url_credentials(&config.redis_url),
        retrieval_mode: config.retrieval_mode.clone(),
        ranking_mode: config.ranking_mode.clone(),
        serving_version: SERVING_VERSION.to_string(),
        cursor_mode: CURSOR_MODE.to_string(),
        stage_execution_mode: "rust_orchestrated_explicit_provider_stages_parallel_bounded"
            .to_string(),
        query_hydrator_execution_mode: definition.query_hydrator_execution_mode.clone(),
        source_execution_mode: definition.source_execution_mode.clone(),
        query_hydrator_concurrency: definition.query_hydrator_concurrency,
        source_concurrency: definition.source_concurrency,
        pipeline_version: definition.pipeline_version.clone(),
        owner: definition.owner.clone(),
        fallback_mode: definition.fallback_mode.clone(),
        graph_provider_mode: if config.graph_source_enabled && config.graph_kernel_enabled {
            "cpp_graph_kernel_primary_with_node_materializer_fallback".to_string()
        } else if config.graph_source_enabled {
            "node_provider_surface_graph_only".to_string()
        } else {
            "graph_source_disabled".to_string()
        },
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
        serve_cache_key_mode: CACHE_KEY_MODE.to_string(),
        serve_cache_policy_mode: CACHE_POLICY_MODE.to_string(),
        async_side_effect_mode: ASYNC_SIDE_EFFECT_MODE.to_string(),
        serving_author_soft_cap: config.serving_author_soft_cap,
    }
}

fn redact_url_credentials(url: &str) -> String {
    if let Some((_, rest)) = url.rsplit_once('@') {
        return format!("***@{rest}");
    }
    url.to_string()
}
