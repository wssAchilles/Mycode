use anyhow::{Result, anyhow};

#[derive(Debug, Clone)]
pub struct RecommendationConfig {
    pub bind_addr: String,
    pub backend_url: String,
    pub redis_url: String,
    pub internal_token: Option<String>,
    pub timeout_ms: u64,
    pub graph_kernel_enabled: bool,
    pub graph_kernel_url: String,
    pub graph_kernel_timeout_ms: u64,
    pub graph_materializer_limit_per_author: usize,
    pub graph_materializer_lookback_days: usize,
    pub stage: String,
    pub retrieval_mode: String,
    pub ranking_mode: String,
    pub selector_oversample_factor: usize,
    pub selector_max_size: usize,
    pub recent_per_user_capacity: usize,
    pub recent_global_capacity: usize,
    pub recent_source_enabled: bool,
    pub source_order: Vec<String>,
    pub graph_source_enabled: bool,
    pub serve_cache_enabled: bool,
    pub serve_cache_ttl_secs: usize,
    pub serve_cache_prefix: String,
    pub serving_author_soft_cap: usize,
    pub news_trends_cache_enabled: bool,
    pub news_trends_cache_ttl_secs: usize,
    pub news_trends_cache_prefix: String,
}

impl RecommendationConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            bind_addr: read_env("RUST_RECOMMENDATION_BIND_ADDR")
                .unwrap_or_else(|| "0.0.0.0:4200".to_string()),
            backend_url: read_env("RUST_RECOMMENDATION_BACKEND_URL")
                .unwrap_or_else(|| "http://backend:5000/internal/recommendation".to_string()),
            redis_url: read_env("RUST_RECOMMENDATION_REDIS_URL")
                .or_else(|| read_env("REDIS_URL"))
                .unwrap_or_else(|| "redis://redis:6379".to_string()),
            internal_token: read_env("RECOMMENDATION_INTERNAL_TOKEN"),
            timeout_ms: parse_env("RUST_RECOMMENDATION_TIMEOUT_MS", 3500)?,
            graph_kernel_enabled: parse_bool_env("CPP_GRAPH_KERNEL_ENABLED", true),
            graph_kernel_url: read_env("CPP_GRAPH_KERNEL_URL")
                .unwrap_or_else(|| "http://graph_kernel:4300".to_string()),
            graph_kernel_timeout_ms: parse_env("CPP_GRAPH_KERNEL_TIMEOUT_MS", 1200)?,
            graph_materializer_limit_per_author: parse_env(
                "RUST_RECOMMENDATION_GRAPH_MATERIALIZER_LIMIT_PER_AUTHOR",
                2,
            )?,
            graph_materializer_lookback_days: parse_env(
                "RUST_RECOMMENDATION_GRAPH_MATERIALIZER_LOOKBACK_DAYS",
                7,
            )?,
            stage: read_env("RUST_RECOMMENDATION_STAGE")
                .unwrap_or_else(|| "retrieval_ranking_v2".to_string()),
            retrieval_mode: read_env("RUST_RECOMMENDATION_RETRIEVAL_MODE")
                .unwrap_or_else(|| "source_orchestrated_graph_v2".to_string()),
            ranking_mode: read_env("RUST_RECOMMENDATION_RANKING_MODE")
                .unwrap_or_else(|| "phoenix_standardized".to_string()),
            selector_oversample_factor: parse_env(
                "RUST_RECOMMENDATION_SELECTOR_OVERSAMPLE_FACTOR",
                5,
            )?,
            selector_max_size: parse_env("RUST_RECOMMENDATION_SELECTOR_MAX_SIZE", 200)?,
            recent_per_user_capacity: parse_env(
                "RUST_RECOMMENDATION_RECENT_PER_USER_CAPACITY",
                64,
            )?,
            recent_global_capacity: parse_env("RUST_RECOMMENDATION_RECENT_GLOBAL_CAPACITY", 256)?,
            recent_source_enabled: parse_bool_env(
                "RUST_RECOMMENDATION_RECENT_SOURCE_ENABLED",
                true,
            ),
            source_order: parse_csv_env(
                "RUST_RECOMMENDATION_SOURCE_ORDER",
                &[
                    "FollowingSource",
                    "GraphSource",
                    "NewsAnnSource",
                    "EmbeddingAuthorSource",
                    "PopularSource",
                    "TwoTowerSource",
                    "ColdStartSource",
                ],
            ),
            graph_source_enabled: parse_bool_env("RUST_RECOMMENDATION_GRAPH_SOURCE_ENABLED", true),
            serve_cache_enabled: parse_bool_env("RUST_RECOMMENDATION_SERVE_CACHE_ENABLED", true),
            serve_cache_ttl_secs: parse_env("RUST_RECOMMENDATION_SERVE_CACHE_TTL_SECS", 45)?,
            serve_cache_prefix: read_env("RUST_RECOMMENDATION_SERVE_CACHE_PREFIX")
                .unwrap_or_else(|| "recommendation:serve:v1".to_string()),
            serving_author_soft_cap: parse_env("RUST_RECOMMENDATION_SERVING_AUTHOR_SOFT_CAP", 2)?,
            news_trends_cache_enabled: parse_bool_env("NEWS_TRENDS_RUST_CACHE_ENABLED", true),
            news_trends_cache_ttl_secs: parse_env("NEWS_TRENDS_RUST_CACHE_TTL_SECS", 60)?,
            news_trends_cache_prefix: read_env("NEWS_TRENDS_RUST_CACHE_PREFIX")
                .unwrap_or_else(|| "news:trends:rust:v1".to_string()),
        })
    }
}

fn read_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_env<T>(key: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
    <T as std::str::FromStr>::Err: std::fmt::Display,
{
    match read_env(key) {
        Some(value) => value
            .parse::<T>()
            .map_err(|error| anyhow!("failed to parse {key}={value}: {error}")),
        None => Ok(default),
    }
}

fn parse_bool_env(key: &str, default: bool) -> bool {
    match read_env(key) {
        Some(value) => matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        None => default,
    }
}

fn parse_csv_env(key: &str, default: &[&str]) -> Vec<String> {
    match read_env(key) {
        Some(value) => {
            let parsed = value
                .split(',')
                .map(|entry| entry.trim())
                .filter(|entry| !entry.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();

            if parsed.is_empty() {
                default.iter().map(|entry| (*entry).to_string()).collect()
            } else {
                parsed
            }
        }
        None => default.iter().map(|entry| (*entry).to_string()).collect(),
    }
}
