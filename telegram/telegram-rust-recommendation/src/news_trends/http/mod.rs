use axum::Json;
use axum::extract::State;

use crate::news_trends::contracts::{NewsTrendRequestPayload, NewsTrendResponsePayload};
use crate::news_trends::core::pipeline::run_news_trends_pipeline;
use crate::news_trends::state::NewsTrendsCache;
use crate::server::state::AppState;

pub async fn news_trends(
    State(state): State<AppState>,
    Json(query): Json<NewsTrendRequestPayload>,
) -> Json<NewsTrendResponsePayload> {
    let fingerprint = NewsTrendsCache::fingerprint(&query);
    if let Some(mut cached) = state.news_trends_cache.get(&fingerprint).await {
        cached.request_id = query.request_id;
        cached.cache_hit = true;
        return Json(cached);
    }

    let result = run_news_trends_pipeline(query);
    state.news_trends_cache.store(&fingerprint, &result).await;
    Json(result)
}
