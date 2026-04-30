use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};

use crate::config::RecommendationConfig;

pub fn require_internal_token(
    config: &RecommendationConfig,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    let Some(expected) = config
        .internal_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    else {
        return Ok(());
    };

    let header_token = headers
        .get("x-recommendation-internal-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if header_token == Some(expected) {
        return Ok(());
    }

    let bearer_token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if bearer_token == Some(expected) {
        return Ok(());
    }

    Err((
        StatusCode::UNAUTHORIZED,
        "recommendation_internal_token_required".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use crate::config::RecommendationConfig;

    use super::require_internal_token;

    #[test]
    fn allows_requests_when_internal_token_is_not_configured() {
        let config = test_config(None);
        assert!(require_internal_token(&config, &HeaderMap::new()).is_ok());
    }

    #[test]
    fn accepts_bearer_internal_token() {
        let config = test_config(Some("secret"));
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer secret".parse().unwrap());

        assert!(require_internal_token(&config, &headers).is_ok());
    }

    #[test]
    fn rejects_missing_internal_token_when_configured() {
        let config = test_config(Some("secret"));
        assert!(require_internal_token(&config, &HeaderMap::new()).is_err());
    }

    fn test_config(token: Option<&str>) -> RecommendationConfig {
        RecommendationConfig {
            bind_addr: "0.0.0.0:4200".to_string(),
            backend_url: "http://backend:5000/internal/recommendation".to_string(),
            redis_url: "redis://redis:6379".to_string(),
            internal_token: token.map(ToOwned::to_owned),
            timeout_ms: 9000,
            graph_kernel_enabled: true,
            graph_kernel_url: "http://graph_kernel:4300".to_string(),
            graph_kernel_timeout_ms: 1200,
            graph_materializer_limit_per_author: 2,
            graph_materializer_lookback_days: 7,
            stage: "retrieval_ranking_v2".to_string(),
            retrieval_mode: "source_orchestrated_graph_v2".to_string(),
            ranking_mode: "phoenix_standardized".to_string(),
            selector_oversample_factor: 5,
            selector_max_size: 200,
            recent_per_user_capacity: 64,
            recent_global_capacity: 256,
            recent_source_enabled: true,
            source_order: vec![
                "FollowingSource".to_string(),
                "GraphSource".to_string(),
                "PopularSource".to_string(),
                "TwoTowerSource".to_string(),
                "ColdStartSource".to_string(),
            ],
            graph_source_enabled: true,
            serve_cache_enabled: true,
            serve_cache_ttl_secs: 45,
            serve_cache_prefix: "recommendation:serve:v1".to_string(),
            serving_author_soft_cap: 2,
            news_trends_cache_enabled: true,
            news_trends_cache_ttl_secs: 60,
            news_trends_cache_prefix: "news:trends:rust:v1".to_string(),
        }
    }
}
