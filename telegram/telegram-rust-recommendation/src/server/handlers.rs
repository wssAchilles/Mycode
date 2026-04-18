use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use tracing::error;

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
    RecommendationOpsRuntime {
        stage: config.stage.clone(),
        backend_url: config.backend_url.clone(),
        retrieval_mode: config.retrieval_mode.clone(),
        ranking_mode: config.ranking_mode.clone(),
        stage_execution_mode: "rust_orchestrated_explicit_provider_stages".to_string(),
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
    }
}
