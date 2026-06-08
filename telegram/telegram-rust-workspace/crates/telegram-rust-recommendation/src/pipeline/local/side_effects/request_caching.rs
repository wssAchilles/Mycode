use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, warn};

use crate::contracts::RecommendationResultPayload;

use super::{SideEffect, SideEffectContext, SideEffectError};

/// Cached recommendation result stored in Redis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedRecommendationResult {
    /// The recommendation result payload.
    pub result: RecommendationResultPayload,
    /// Timestamp when the cache was written.
    pub cached_at: chrono::DateTime<chrono::Utc>,
    /// Version of the cache format.
    pub version: u32,
}

/// Side effect that caches recommendation results to Redis.
///
/// This enables:
/// - Debouncing: Prevents duplicate requests from triggering full pipeline runs.
/// - Fast retry: Returns cached results for identical requests within TTL.
pub struct RequestCachingSideEffect {
    redis_client: Option<redis::Client>,
    enabled: bool,
    ttl_secs: u64,
    prefix: String,
    /// In-memory fallback cache when Redis is unavailable.
    memory_cache: Arc<Mutex<HashMap<String, CachedRecommendationResult>>>,
}

impl RequestCachingSideEffect {
    /// Create a new request caching side effect.
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
            30,   // 30 seconds TTL for request caching
            "response",
        )
    }

    /// Build the Redis key for a request.
    fn redis_key(&self, user_id: &str, request_hash: &str) -> String {
        format!("{}:{user_id}:{request_hash}", self.prefix)
    }

    /// Get cached result for a request.
    pub async fn get_cached_result(
        &self,
        user_id: &str,
        request_hash: &str,
    ) -> Option<CachedRecommendationResult> {
        if !self.enabled {
            return None;
        }

        let key = self.redis_key(user_id, request_hash);

        // Try Redis first.
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
            && let Ok(value) = connection.get::<_, Option<String>>(&key).await
            && let Some(value) = value
            && let Ok(result) = serde_json::from_str::<CachedRecommendationResult>(&value)
        {
            return Some(result);
        }

        // Fallback to memory cache.
        let memory = self.memory_cache.lock().await;
        memory.get(&key).cloned()
    }

    /// Cache a recommendation result.
    async fn cache_result(
        &self,
        user_id: &str,
        request_hash: &str,
        result: &CachedRecommendationResult,
    ) -> Result<(), SideEffectError> {
        if !self.enabled {
            return Ok(());
        }

        let key = self.redis_key(user_id, request_hash);
        let serialized = serde_json::to_string(result)?;

        // Write to Redis.
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
        {
            let _: () = connection.set_ex(&key, &serialized, self.ttl_secs).await?;
        }

        // Write to memory cache as fallback.
        let mut memory = self.memory_cache.lock().await;
        memory.insert(key, result.clone());

        Ok(())
    }

    /// Purge expired entries from the memory cache.
    pub async fn purge_expired(&self) {
        let mut memory = self.memory_cache.lock().await;
        let now = chrono::Utc::now();
        memory.retain(|_, entry| {
            let age = now.signed_duration_since(entry.cached_at);
            age.num_seconds() < self.ttl_secs as i64
        });
    }
}

#[async_trait]
impl SideEffect for RequestCachingSideEffect {
    async fn execute(&self, context: &SideEffectContext) -> Result<(), SideEffectError> {
        if !self.enabled {
            return Ok(());
        }

        let user_id = &context.user_id;
        let request_hash = &context.request_hash;

        // Build a minimal result from the context for caching.
        // We cache the candidates list for fast retry.
        let cached = CachedRecommendationResult {
            result: RecommendationResultPayload {
                request_id: context.query.request_id.clone(),
                serving_version: "v1".to_string(),
                cursor: None,
                next_cursor: None,
                has_more: false,
                served_state_version: String::new(),
                stable_order_key: String::new(),
                candidates: context.candidates.clone(),
                summary: build_cached_summary(&context.query.request_id, context.candidates.len()),
            },
            cached_at: chrono::Utc::now(),
            version: 1,
        };

        match self.cache_result(user_id, request_hash, &cached).await {
            Ok(()) => {
                debug!(
                    user_id = %user_id,
                    request_hash = %request_hash,
                    candidate_count = context.candidates.len(),
                    "cached recommendation result"
                );
                Ok(())
            }
            Err(err) => {
                warn!(
                    user_id = %user_id,
                    request_hash = %request_hash,
                    error = %err,
                    "failed to cache recommendation result"
                );
                // Don't propagate errors - side effects should be best-effort.
                Ok(())
            }
        }
    }
}

fn build_cached_summary(
    request_id: &str,
    candidate_count: usize,
) -> crate::contracts::RecommendationSummaryPayload {
    use crate::contracts::*;
    RecommendationSummaryPayload {
        request_id: request_id.to_string(),
        stage: "cached".to_string(),
        pipeline_version: String::new(),
        owner: String::new(),
        fallback_mode: String::new(),
        provider_calls: HashMap::new(),
        provider_latency_ms: HashMap::new(),
        retrieved_count: candidate_count,
        selected_count: candidate_count,
        source_counts: HashMap::new(),
        filter_drop_counts: HashMap::new(),
        stage_timings: HashMap::new(),
        stage_latency_ms: HashMap::new(),
        degraded_reasons: Vec::new(),
        recent_hot_applied: false,
        online_eval: RecommendationOnlineEvaluationPayload::default(),
        selector: RecommendationSelectorPayload {
            oversample_factor: 0,
            max_size: 0,
            final_limit: 0,
            truncated: false,
            selector_report: None,
            selector_report_unavailable_reason: Some("request_cache_fixture".to_string()),
        },
        serving: RecommendationServingSummaryPayload {
            serving_version: String::new(),
            cursor_mode: String::new(),
            cursor: None,
            next_cursor: None,
            has_more: false,
            served_state_version: String::new(),
            stable_order_key: String::new(),
            duplicate_suppressed_count: 0,
            cross_page_duplicate_count: 0,
            suppression_reasons: HashMap::new(),
            serve_cache_hit: false,
            stable_order_drifted: false,
            cache_key_mode: String::new(),
            cache_policy: String::new(),
            cache_policy_reason: String::new(),
            page_remaining_count: 0,
            page_underfilled: false,
            page_underfill_reason: None,
        },
        retrieval: RecommendationRetrievalSummaryPayload {
            stage: String::new(),
            total_candidates: 0,
            in_network_candidates: 0,
            out_of_network_candidates: 0,
            ml_retrieved_candidates: 0,
            recent_hot_candidates: 0,
            source_counts: HashMap::new(),
            source_outcome_counts: HashMap::new(),
            source_failure_counts: HashMap::new(),
            source_disabled_counts: HashMap::new(),
            lane_counts: HashMap::new(),
            ml_source_counts: HashMap::new(),
            stage_timings: HashMap::new(),
            degraded_reasons: Vec::new(),
            graph: RecommendationGraphRetrievalPayload::default(),
        },
        ranking: RecommendationRankingSummaryPayload {
            stage: String::new(),
            input_candidates: 0,
            hydrated_candidates: 0,
            filtered_candidates: 0,
            scored_candidates: 0,
            ml_eligible_candidates: 0,
            ml_ranked_candidates: 0,
            weighted_candidates: 0,
            stage_timings: HashMap::new(),
            filter_drop_counts: HashMap::new(),
            degraded_reasons: Vec::new(),
        },
        stages: Vec::new(),
        trace: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::RecommendationQueryPayload;

    fn test_context(user_id: &str, request_hash: &str) -> SideEffectContext {
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
                user_features: None,
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
            request_hash: request_hash.to_string(),
        }
    }

    #[tokio::test]
    async fn request_caching_disabled_returns_ok() {
        let side_effect =
            RequestCachingSideEffect::new("redis://localhost:6379", false, 30, "response");
        let context = test_context("user-1", "hash-1");
        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn request_caching_uses_memory_fallback() {
        let side_effect =
            RequestCachingSideEffect::new("redis://invalid:6379", true, 30, "response");
        let context = test_context("user-1", "hash-1");

        // Should succeed even without Redis (uses memory cache).
        let result = side_effect.execute(&context).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn request_caching_purge_expired() {
        let side_effect = RequestCachingSideEffect::new(
            "redis://invalid:6379",
            true,
            0, // 0 second TTL for test
            "response",
        );

        // Insert a cached result.
        let cached = CachedRecommendationResult {
            result: RecommendationResultPayload {
                request_id: "req-test".to_string(),
                serving_version: "v1".to_string(),
                cursor: None,
                next_cursor: None,
                has_more: false,
                served_state_version: String::new(),
                stable_order_key: String::new(),
                candidates: Vec::new(),
                summary: build_test_summary(),
            },
            cached_at: chrono::Utc::now() - chrono::Duration::seconds(10),
            version: 1,
        };

        {
            let mut memory = side_effect.memory_cache.lock().await;
            memory.insert("response:user-1:hash-1".to_string(), cached);
        }

        // Purge should remove expired entries.
        side_effect.purge_expired().await;

        let memory = side_effect.memory_cache.lock().await;
        assert!(memory.is_empty());
    }

    fn build_test_summary() -> crate::contracts::RecommendationSummaryPayload {
        use crate::contracts::*;
        RecommendationSummaryPayload {
            request_id: "req-test".to_string(),
            stage: "test".to_string(),
            pipeline_version: String::new(),
            owner: String::new(),
            fallback_mode: String::new(),
            provider_calls: HashMap::new(),
            provider_latency_ms: HashMap::new(),
            retrieved_count: 0,
            selected_count: 0,
            source_counts: HashMap::new(),
            filter_drop_counts: HashMap::new(),
            stage_timings: HashMap::new(),
            stage_latency_ms: HashMap::new(),
            degraded_reasons: Vec::new(),
            recent_hot_applied: false,
            online_eval: RecommendationOnlineEvaluationPayload::default(),
            selector: RecommendationSelectorPayload {
                oversample_factor: 0,
                max_size: 0,
                final_limit: 0,
                truncated: false,
                selector_report: None,
                selector_report_unavailable_reason: Some("request_cache_fixture".to_string()),
            },
            serving: RecommendationServingSummaryPayload {
                serving_version: String::new(),
                cursor_mode: String::new(),
                cursor: None,
                next_cursor: None,
                has_more: false,
                served_state_version: String::new(),
                stable_order_key: String::new(),
                duplicate_suppressed_count: 0,
                cross_page_duplicate_count: 0,
                suppression_reasons: HashMap::new(),
                serve_cache_hit: false,
                stable_order_drifted: false,
                cache_key_mode: String::new(),
                cache_policy: String::new(),
                cache_policy_reason: String::new(),
                page_remaining_count: 0,
                page_underfilled: false,
                page_underfill_reason: None,
            },
            retrieval: RecommendationRetrievalSummaryPayload {
                stage: String::new(),
                total_candidates: 0,
                in_network_candidates: 0,
                out_of_network_candidates: 0,
                ml_retrieved_candidates: 0,
                recent_hot_candidates: 0,
                source_counts: HashMap::new(),
                source_outcome_counts: HashMap::new(),
                source_failure_counts: HashMap::new(),
                source_disabled_counts: HashMap::new(),
                lane_counts: HashMap::new(),
                ml_source_counts: HashMap::new(),
                stage_timings: HashMap::new(),
                degraded_reasons: Vec::new(),
                graph: RecommendationGraphRetrievalPayload::default(),
            },
            ranking: RecommendationRankingSummaryPayload {
                stage: String::new(),
                input_candidates: 0,
                hydrated_candidates: 0,
                filtered_candidates: 0,
                scored_candidates: 0,
                ml_eligible_candidates: 0,
                ml_ranked_candidates: 0,
                weighted_candidates: 0,
                stage_timings: HashMap::new(),
                filter_drop_counts: HashMap::new(),
                degraded_reasons: Vec::new(),
            },
            stages: Vec::new(),
            trace: None,
        }
    }
}
