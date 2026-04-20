use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use redis::AsyncCommands;
use tokio::sync::Mutex;

use crate::contracts::RecommendationResultPayload;

#[derive(Debug, Clone)]
struct MemoryCacheEntry {
    result: RecommendationResultPayload,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ServeCache {
    enabled: bool,
    ttl_secs: usize,
    prefix: String,
    redis_client: Option<redis::Client>,
    memory: Arc<Mutex<HashMap<String, MemoryCacheEntry>>>,
}

#[derive(Debug, Clone)]
pub struct ServeCacheGetResult {
    pub result: Option<RecommendationResultPayload>,
}

#[derive(Debug, Clone, Default)]
pub struct ServeCacheStoreResult {
    pub drifted: bool,
}

impl ServeCache {
    pub fn from_config(config: &crate::config::RecommendationConfig) -> Self {
        let redis_client = if config.serve_cache_enabled {
            redis::Client::open(config.redis_url.clone()).ok()
        } else {
            None
        };

        Self {
            enabled: config.serve_cache_enabled,
            ttl_secs: config.serve_cache_ttl_secs,
            prefix: config.serve_cache_prefix.clone(),
            redis_client,
            memory: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub async fn get(&self, fingerprint: &str) -> ServeCacheGetResult {
        if !self.enabled {
            return ServeCacheGetResult { result: None };
        }

        let key = self.redis_key(fingerprint);
        if let Some(client) = &self.redis_client {
            if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                if let Ok(value) = connection.get::<_, Option<String>>(&key).await {
                    if let Some(value) = value {
                        if let Ok(result) =
                            serde_json::from_str::<RecommendationResultPayload>(&value)
                        {
                            return ServeCacheGetResult {
                                result: Some(result),
                            };
                        }
                    }
                }
            }
        }

        let mut memory = self.memory.lock().await;
        if let Some(entry) = memory.get(&key) {
            if entry.expires_at > Utc::now() {
                return ServeCacheGetResult {
                    result: Some(entry.result.clone()),
                };
            }
        }
        memory.remove(&key);

        ServeCacheGetResult { result: None }
    }

    pub async fn store(
        &self,
        fingerprint: &str,
        result: &RecommendationResultPayload,
    ) -> Result<ServeCacheStoreResult> {
        if !self.enabled {
            return Ok(ServeCacheStoreResult::default());
        }

        let key = self.redis_key(fingerprint);
        let serialized = serde_json::to_string(result)?;
        let mut store_result = ServeCacheStoreResult::default();

        let existing = self.get(fingerprint).await;
        if let Some(existing_result) = existing.result {
            store_result.drifted = existing_result.stable_order_key != result.stable_order_key;
        }

        if let Some(client) = &self.redis_client {
            if let Ok(mut connection) = client.get_multiplexed_async_connection().await {
                let _: () = connection
                    .set_ex(&key, serialized.clone(), self.ttl_secs as u64)
                    .await?;
            }
        }

        let mut memory = self.memory.lock().await;
        memory.insert(
            key,
            MemoryCacheEntry {
                result: result.clone(),
                expires_at: Utc::now() + Duration::seconds(self.ttl_secs as i64),
            },
        );

        Ok(store_result)
    }

    fn redis_key(&self, fingerprint: &str) -> String {
        format!("{}:{fingerprint}", self.prefix)
    }
}
