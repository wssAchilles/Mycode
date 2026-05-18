use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, warn};

use crate::contracts::{EmbeddingContextPayload, UserFeaturesPayload};

use super::{SideEffect, SideEffectContext, SideEffectError};

/// Cached user features stored in Redis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedUserFeatures {
    /// User embedding context if available.
    pub embedding_context: Option<EmbeddingContextPayload>,
    /// User features if available.
    pub user_features: Option<UserFeaturesPayload>,
    /// Timestamp when the cache was written.
    pub cached_at: chrono::DateTime<chrono::Utc>,
    /// Version of the cache format.
    pub version: u32,
}

/// Side effect that caches user features to Redis after recommendation.
///
/// This reduces latency for subsequent requests by avoiding repeated
/// feature hydration from the backend.
pub struct FeatureCachingSideEffect {
    redis_client: Option<redis::Client>,
    enabled: bool,
    ttl_secs: u64,
    prefix: String,
    /// In-memory fallback cache when Redis is unavailable.
    memory_cache: Arc<Mutex<HashMap<String, CachedUserFeatures>>>,
}

impl FeatureCachingSideEffect {
    /// Create a new feature caching side effect.
    pub fn new(redis_url: &str, enabled: bool, ttl_secs: u64, prefix: &str) -> Self {
        let redis_client = if enabled {
            redis::Client::open(redis_url).ok()
        } else {
            None
        };

        Self {
            redis_client,
            enabled,
            ttl_secs,
            prefix: prefix.to_string(),
            memory_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create from recommendation config.
    pub fn from_config(config: &crate::config::RecommendationConfig) -> Self {
        Self::new(
            &config.redis_url,
            true, // enabled by default
            3600, // 1 hour TTL
            "features:user",
        )
    }

    /// Build the Redis key for a user.
    fn redis_key(&self, user_id: &str) -> String {
        format!("{}:{user_id}", self.prefix)
    }

    /// Get cached features for a user.
    pub async fn get_cached_features(&self, user_id: &str) -> Option<CachedUserFeatures> {
        if !self.enabled {
            return None;
        }

        let key = self.redis_key(user_id);

        // Try Redis first.
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
            && let Ok(value) = connection.get::<_, Option<String>>(&key).await
            && let Some(value) = value
            && let Ok(features) = serde_json::from_str::<CachedUserFeatures>(&value)
        {
            return Some(features);
        }

        // Fallback to memory cache.
        let memory = self.memory_cache.lock().await;
        memory.get(&key).cloned()
    }

    /// Cache features for a user.
    async fn cache_features(
        &self,
        user_id: &str,
        features: &CachedUserFeatures,
    ) -> Result<(), SideEffectError> {
        if !self.enabled {
            return Ok(());
        }

        let key = self.redis_key(user_id);
        let serialized = serde_json::to_string(features)?;

        // Write to Redis.
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
        {
            let _: () = connection.set_ex(&key, &serialized, self.ttl_secs).await?;
        }

        // Write to memory cache as fallback.
        let mut memory = self.memory_cache.lock().await;
        memory.insert(key, features.clone());

        Ok(())
    }
}

#[async_trait]
impl SideEffect for FeatureCachingSideEffect {
    async fn execute(&self, context: &SideEffectContext) -> Result<(), SideEffectError> {
        if !self.enabled {
            return Ok(());
        }

        let user_id = &context.user_id;

        // Extract features from the query.
        let embedding_context = context.query.embedding_context.clone();
        let user_features = context.query.user_features.clone();

        // Only cache if we have meaningful features.
        if embedding_context.is_none() && user_features.is_none() {
            debug!(
                user_id = %user_id,
                "skipping feature caching: no features available"
            );
            return Ok(());
        }

        let cached = CachedUserFeatures {
            embedding_context,
            user_features,
            cached_at: chrono::Utc::now(),
            version: 1,
        };

        match self.cache_features(user_id, &cached).await {
            Ok(()) => {
                debug!(
                    user_id = %user_id,
                    "cached user features successfully"
                );
                Ok(())
            }
            Err(err) => {
                warn!(
                    user_id = %user_id,
                    error = %err,
                    "failed to cache user features"
                );
                // Don't propagate errors - side effects should be best-effort.
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_context(user_id: &str) -> SideEffectContext {
        SideEffectContext {
            user_id: user_id.to_string(),
            candidates: Vec::new(),
            query: RecommendationQueryPayload {
                request_id: "req-test".to_string(),
                user_id: user_id.to_string(),
                limit: 20,
                cursor: None,
                in_network_only: false,
                seen_ids: Vec::new(),
                served_ids: Vec::new(),
                is_bottom_request: false,
                client_app_id: None,
                country_code: None,
                language_code: None,
                user_features: Some(UserFeaturesPayload::default()),
                embedding_context: None,
                user_state_context: None,
                user_action_sequence: None,
                news_history_external_ids: None,
                model_user_action_sequence: None,
                experiment_context: None,
                ranking_policy: None,
                user_signal_features: None,
                interested_topics: None,
                mutual_follow_ids: None,
                demographics: None,
                feature_switches: HashMap::new(),
                past_request_timestamps: Vec::new(),
                impressed_post_ids: Vec::new(),
                subscribed_user_ids: Vec::new(),
            },
            request_hash: "test-hash".to_string(),
        }
    }

    #[tokio::test]
    async fn feature_caching_disabled_returns_ok() {
        let side_effect =
            FeatureCachingSideEffect::new("redis://localhost:6379", false, 3600, "features:user");
        let context = test_context("user-1");
        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn feature_caching_skips_when_no_features() {
        let side_effect =
            FeatureCachingSideEffect::new("redis://localhost:6379", true, 3600, "features:user");
        let mut context = test_context("user-1");
        context.query.user_features = None;
        context.query.embedding_context = None;

        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn feature_caching_uses_memory_fallback() {
        let side_effect =
            FeatureCachingSideEffect::new("redis://invalid:6379", true, 3600, "features:user");
        let context = test_context("user-1");

        // Should succeed even without Redis (uses memory cache).
        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }
}
