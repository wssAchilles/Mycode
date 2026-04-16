mod backend_client;
mod config;
mod contracts;
mod metrics;
mod pipeline;
mod recent_store;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationOpsRuntime, RecommendationOpsSummary, RecommendationQueryPayload,
    RecommendationResultPayload, RecentStoreSnapshot,
};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::RecommendationPipeline;
use crate::recent_store::RecentHotStore;

#[derive(Clone)]
struct AppState {
    config: RecommendationConfig,
    pipeline: Arc<RecommendationPipeline>,
    recent_store: Arc<Mutex<RecentHotStore>>,
    metrics: Arc<Mutex<RecommendationMetrics>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    stage: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecommendationOpsSummaryResponse {
    runtime: RecommendationOpsRuntime,
    summary: RecommendationOpsSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecommendationOpsResponse {
    status: String,
    runtime: RecommendationOpsRuntime,
    summary: RecommendationOpsSummary,
    recent_store: RecentStoreSnapshot,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let config = RecommendationConfig::from_env()?;
    let recent_store = Arc::new(Mutex::new(RecentHotStore::new(
        config.recent_per_user_capacity,
        config.recent_global_capacity,
    )));
    let metrics = Arc::new(Mutex::new(RecommendationMetrics::default()));
    let backend_client = BackendRecommendationClient::new(&config)?;
    let pipeline = Arc::new(RecommendationPipeline::new(
        backend_client,
        config.clone(),
        Arc::clone(&recent_store),
    ));
    let app_state = AppState {
        config: config.clone(),
        pipeline,
        recent_store,
        metrics,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/recommendation/candidates", post(recommendation_candidates))
        .route("/ops/recommendation", get(recommendation_ops))
        .route("/ops/recommendation/summary", get(recommendation_ops_summary))
        .with_state(app_state);

    let bind_addr: SocketAddr = config
        .bind_addr
        .parse()
        .with_context(|| format!("parse bind addr {}", config.bind_addr))?;
    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("bind rust recommendation service {}", config.bind_addr))?;

    info!(
        bind_addr = %config.bind_addr,
        stage = %config.stage,
        "rust recommendation service listening"
    );

    axum::serve(listener, app)
        .await
        .context("serve rust recommendation axum app")?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "rust_recommendation",
        stage: state.config.stage.clone(),
    })
}

async fn recommendation_candidates(
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

async fn recommendation_ops(
    State(state): State<AppState>,
) -> Json<RecommendationOpsResponse> {
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

async fn recommendation_ops_summary(
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

fn build_runtime(config: &RecommendationConfig) -> RecommendationOpsRuntime {
    RecommendationOpsRuntime {
        stage: config.stage.clone(),
        backend_url: config.backend_url.clone(),
        recent_global_capacity: config.recent_global_capacity,
        recent_per_user_capacity: config.recent_per_user_capacity,
        selector_oversample_factor: config.selector_oversample_factor,
        selector_max_size: config.selector_max_size,
    }
}
