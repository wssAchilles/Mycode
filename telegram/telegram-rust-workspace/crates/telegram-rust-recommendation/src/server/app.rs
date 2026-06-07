use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use axum::routing::{get, post};
use tokio::sync::Mutex;

use crate::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::metrics::RecommendationMetrics;
use crate::news_trends::http::news_trends;
use crate::news_trends::state::NewsTrendsCache;
use crate::pipeline::builder::RecommendationPipelineBuilder;
use crate::recent_store::RecentHotStore;

use super::handlers::{
    health, recommendation_candidates, recommendation_ops, recommendation_ops_summary,
    recommendation_readiness,
};
use super::state::AppState;

pub fn build_app_state(config: RecommendationConfig) -> Result<AppState> {
    let recent_store = Arc::new(RecentHotStore::new_sharded(
        config.recent_per_user_capacity,
        config.recent_global_capacity,
        config.recent_hot_shard_count,
    ));
    let metrics = Arc::new(Mutex::new(RecommendationMetrics::default()));
    let news_trends_cache = NewsTrendsCache::from_config(&config);
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

    Ok(AppState {
        config,
        pipeline,
        recent_store,
        metrics,
        news_trends_cache,
    })
}

pub fn build_router(app_state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/readiness", get(recommendation_readiness))
        .route(
            "/recommendation/candidates",
            post(recommendation_candidates),
        )
        .route("/news/trends", post(news_trends))
        .route("/ops/recommendation", get(recommendation_ops))
        .route(
            "/ops/recommendation/summary",
            get(recommendation_ops_summary),
        )
        .with_state(app_state)
}

#[cfg(test)]
mod tests {
    use super::build_router;
    use crate::server::state::AppState;

    #[test]
    fn router_builder_keeps_service_routes_in_server_layer() {
        let _: fn(AppState) -> axum::Router = build_router;
    }
}
