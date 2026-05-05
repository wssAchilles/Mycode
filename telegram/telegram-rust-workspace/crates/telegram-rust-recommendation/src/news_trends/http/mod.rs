use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};

use crate::news_trends::contracts::{NewsTrendRequestPayload, NewsTrendResponsePayload};
use crate::news_trends::core::pipeline::run_news_trends_pipeline;
use crate::news_trends::state::NewsTrendsCache;
use crate::server::auth::require_internal_token;
use crate::server::state::AppState;

pub async fn news_trends(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(query): Json<NewsTrendRequestPayload>,
) -> Result<Json<NewsTrendResponsePayload>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let fingerprint = NewsTrendsCache::fingerprint(&query);
    if let Some(mut cached) = state.news_trends_cache.get(&fingerprint).await {
        cached.request_id = query.request_id;
        cached.cache_hit = true;
        cached.cache_key = Some(fingerprint);
        return Ok(Json(cached));
    }

    let mut result = run_news_trends_pipeline(query);
    result.cache_key = Some(fingerprint.clone());
    state.news_trends_cache.store(&fingerprint, &result).await;
    Ok(Json(result))
}
