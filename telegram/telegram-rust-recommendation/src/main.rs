mod candidate_hydrators;
mod clients;
mod config;
mod contracts;
mod filters;
mod ops;
mod pipeline;
mod query_hydrators;
mod scorers;
mod selectors;
mod server;
mod serving;
mod side_effects;
mod sources;
mod state;

pub use clients::backend_client;
pub use ops::metrics;
pub use selectors::top_k;
pub use sources::orchestrator;
pub use state::recent_store;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use axum::Router;
use axum::routing::{get, post};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::info;

use crate::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::metrics::RecommendationMetrics;
use crate::pipeline::builder::RecommendationPipelineBuilder;
use crate::recent_store::RecentHotStore;
use crate::server::handlers::{
    health, recommendation_candidates, recommendation_ops, recommendation_ops_summary,
};
use crate::server::state::AppState;

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
    let pipeline = Arc::new(
        RecommendationPipelineBuilder::new(
            backend_client,
            config.clone(),
            Arc::clone(&recent_store),
            Arc::clone(&metrics),
        )
        .build(),
    );
    let app_state = AppState {
        config: config.clone(),
        pipeline,
        recent_store,
        metrics,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route(
            "/recommendation/candidates",
            post(recommendation_candidates),
        )
        .route("/ops/recommendation", get(recommendation_ops))
        .route(
            "/ops/recommendation/summary",
            get(recommendation_ops_summary),
        )
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
