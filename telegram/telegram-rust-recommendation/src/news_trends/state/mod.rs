use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use redis::AsyncCommands;
use tokio::sync::Mutex;

use crate::config::RecommendationConfig;
use crate::news_trends::contracts::{NewsTrendRequestPayload, NewsTrendResponsePayload};
use crate::news_trends::core::util::stable_hash_u64;

#[derive(Debug, Clone)]
struct NewsTrendsCacheEntry {
    result: NewsTrendResponsePayload,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewsTrendsCache {
    enabled: bool,
    ttl_secs: usize,
    prefix: String,
    redis_client: Option<redis::Client>,
    memory: Arc<Mutex<HashMap<String, NewsTrendsCacheEntry>>>,
}

impl NewsTrendsCache {
    pub fn from_config(config: &RecommendationConfig) -> Self {
        let redis_client = if config.news_trends_cache_enabled {
            redis::Client::open(config.redis_url.clone()).ok()
        } else {
            None
        };
        Self {
            enabled: config.news_trends_cache_enabled,
            ttl_secs: config.news_trends_cache_ttl_secs,
            prefix: config.news_trends_cache_prefix.clone(),
            redis_client,
            memory: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    fn memory_only(ttl_secs: usize) -> Self {
        Self {
            enabled: true,
            ttl_secs,
            prefix: "test:news:trends".to_string(),
            redis_client: None,
            memory: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn fingerprint(request: &NewsTrendRequestPayload) -> String {
        let mut cache_request = request.clone();
        cache_request.request_id.clear();
        cache_request.now_ms = 0;
        let serialized = serde_json::to_string(&cache_request).unwrap_or_default();
        format!(
            "{}:{}:{}:{:016x}",
            mode_key(&cache_request),
            cache_request.window_hours,
            cache_request.limit,
            stable_hash_u64(&serialized)
        )
    }

    pub async fn get(&self, fingerprint: &str) -> Option<NewsTrendResponsePayload> {
        if !self.enabled {
            return None;
        }

        let key = self.redis_key(fingerprint);
        if let Some(client) = &self.redis_client {
            if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                if let Ok(Some(value)) = connection.get::<_, Option<String>>(&key).await {
                    if let Ok(result) = serde_json::from_str::<NewsTrendResponsePayload>(&value) {
                        return Some(result);
                    }
                }
            }
        }

        let mut memory = self.memory.lock().await;
        if let Some(entry) = memory.get(&key) {
            if entry.expires_at > Utc::now() {
                return Some(entry.result.clone());
            }
        }
        memory.remove(&key);
        None
    }

    pub async fn store(&self, fingerprint: &str, result: &NewsTrendResponsePayload) {
        if !self.enabled {
            return;
        }

        let key = self.redis_key(fingerprint);
        if let Ok(serialized) = serde_json::to_string(result) {
            if let Some(client) = &self.redis_client {
                if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                    let _: redis::RedisResult<()> = connection
                        .set_ex(&key, serialized.clone(), self.ttl_secs as u64)
                        .await;
                }
            }
        }

        let mut memory = self.memory.lock().await;
        memory.insert(
            key,
            NewsTrendsCacheEntry {
                result: result.clone(),
                expires_at: Utc::now() + Duration::seconds(self.ttl_secs as i64),
            },
        );
    }

    fn redis_key(&self, fingerprint: &str) -> String {
        format!("{}:{fingerprint}", self.prefix)
    }
}

fn mode_key(request: &NewsTrendRequestPayload) -> &'static str {
    match request.mode {
        crate::news_trends::contracts::NewsTrendMode::NewsTopics => "news_topics",
        crate::news_trends::contracts::NewsTrendMode::SpaceTrends => "space_trends",
    }
}

#[cfg(test)]
mod tests {
    use crate::news_trends::contracts::{NewsTrendMode, NewsTrendRequestPayload};
    use crate::news_trends::core::pipeline::run_news_trends_pipeline;

    use super::NewsTrendsCache;

    #[tokio::test]
    async fn memory_cache_stores_and_reads_trend_response() {
        let cache = NewsTrendsCache::memory_only(60);
        let request = NewsTrendRequestPayload {
            request_id: "a".to_string(),
            mode: NewsTrendMode::NewsTopics,
            limit: 6,
            window_hours: 24,
            now_ms: 1,
            documents: Vec::new(),
        };
        let fingerprint = NewsTrendsCache::fingerprint(&request);
        let response = run_news_trends_pipeline(request);
        cache.store(&fingerprint, &response).await;

        let cached = cache.get(&fingerprint).await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().request_id, "a");
    }
}
