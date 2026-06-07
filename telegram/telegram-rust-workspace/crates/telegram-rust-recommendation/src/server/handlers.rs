use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use tracing::error;

use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};

use super::auth::require_internal_token;
use super::readiness::build_readiness_response;
use super::runtime::build_runtime;
use super::state::AppState;
use super::types::{
    HealthResponse, ReadinessResponse, RecommendationOpsResponse, RecommendationOpsSummaryResponse,
};

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "rust_recommendation",
        stage: state.config.stage.clone(),
    })
}

pub async fn recommendation_candidates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(query): Json<RecommendationQueryPayload>,
) -> Result<Json<RecommendationResultPayload>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

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

pub async fn recommendation_readiness(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ReadinessResponse>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let definition = state.pipeline.definition();
    Ok(Json(build_readiness_response(&state.config, definition)))
}

pub async fn recommendation_ops(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RecommendationOpsResponse>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let recent_snapshot = state.recent_store.snapshot();
    let recent_control_plane = state.recent_store.control_plane_snapshot();
    let cache_control_plane = state.pipeline.cache_control_plane_snapshot();
    let summary = {
        let metrics = state.metrics.lock().await;
        metrics.build_summary(&state.config.stage, recent_snapshot.clone())
    };

    Ok(Json(RecommendationOpsResponse {
        status: summary.status.clone(),
        runtime: build_runtime(&state.config, state.pipeline.definition()),
        summary,
        recent_store: recent_snapshot,
        cache_control_plane,
        recent_control_plane,
    }))
}

pub async fn recommendation_ops_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RecommendationOpsSummaryResponse>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let recent_snapshot = state.recent_store.snapshot();
    let recent_control_plane = state.recent_store.control_plane_snapshot();
    let cache_control_plane = state.pipeline.cache_control_plane_snapshot();
    let summary = {
        let metrics = state.metrics.lock().await;
        metrics.build_summary(&state.config.stage, recent_snapshot)
    };

    Ok(Json(RecommendationOpsSummaryResponse {
        runtime: build_runtime(&state.config, state.pipeline.definition()),
        summary,
        cache_control_plane,
        recent_control_plane,
    }))
}
