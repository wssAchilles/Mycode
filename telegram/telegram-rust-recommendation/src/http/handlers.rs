use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use tracing::error;

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationOpsRuntime, RecommendationQueryPayload, RecommendationResultPayload,
};

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
        runtime: build_runtime(&state.config),
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
        runtime: build_runtime(&state.config),
        summary,
    })
}

pub fn build_runtime(config: &RecommendationConfig) -> RecommendationOpsRuntime {
    RecommendationOpsRuntime {
        stage: config.stage.clone(),
        backend_url: config.backend_url.clone(),
        retrieval_mode: config.retrieval_mode.clone(),
        ranking_mode: config.ranking_mode.clone(),
        recent_global_capacity: config.recent_global_capacity,
        recent_per_user_capacity: config.recent_per_user_capacity,
        selector_oversample_factor: config.selector_oversample_factor,
        selector_max_size: config.selector_max_size,
    }
}
