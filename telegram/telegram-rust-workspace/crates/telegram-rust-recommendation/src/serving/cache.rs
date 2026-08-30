use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::Result;
use chrono::Duration;
use moka::sync::Cache;
use redis::AsyncCommands;
use telegram_selector_primitives::SELECTOR_POLICY_VERSION;
use telegram_serving_primitives::{
    CACHE_KEY_MODE, CACHE_POLICY_MODE, CURSOR_MODE, RANKED_CURSOR_ABSTENTION_MODE,
    SERVED_STATE_VERSION, SERVING_VERSION,
};

use crate::contracts::RecommendationResultPayload;

const DEFAULT_MEMORY_CAPACITY: u64 = 4_096;

#[derive(Debug, Clone)]
pub struct ServeCache {
    enabled: bool,
    ttl_secs: usize,
    prefix: String,
    redis_url: String,
    redis_client: Option<redis::Client>,
    memory: Cache<String, RecommendationResultPayload>,
    stats: Arc<ServeCacheStats>,
}

#[derive(Debug, Clone)]
pub struct ServeCacheGetResult {
    pub result: Option<RecommendationResultPayload>,
    pub tier: ServeCacheHitTier,
}

#[derive(Debug, Clone, Default)]
pub struct ServeCacheStoreResult {
    pub drifted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeCacheHitTier {
    Local,
    Shared,
    Miss,
    Disabled,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeCacheSnapshot {
    pub local_hit_count: u64,
    pub local_miss_count: u64,
    pub shared_hit_count: u64,
    pub shared_miss_count: u64,
    pub local_capacity: u64,
}

#[derive(Debug, Default)]
struct ServeCacheStats {
    local_hit_count: AtomicU64,
    local_miss_count: AtomicU64,
    shared_hit_count: AtomicU64,
    shared_miss_count: AtomicU64,
}

impl ServeCache {
    pub fn from_config(config: &crate::config::RecommendationConfig) -> Self {
        let redis_client = if config.serve_cache_enabled {
            redis::Client::open(config.redis_url.clone()).ok()
        } else {
            None
        };

        Self::new(
            config.serve_cache_enabled,
            config.serve_cache_ttl_secs,
            config.serve_cache_prefix.clone(),
            config.redis_url.clone(),
            redis_client,
            config.cache_local_capacity,
        )
    }

    pub(crate) fn new(
        enabled: bool,
        ttl_secs: usize,
        prefix: String,
        redis_url: String,
        redis_client: Option<redis::Client>,
        memory_capacity: u64,
    ) -> Self {
        let ttl = Duration::seconds(ttl_secs.max(1) as i64)
            .to_std()
            .unwrap_or_default();
        let memory = Cache::builder()
            .time_to_live(ttl)
            .max_capacity(memory_capacity.max(1))
            .build();

        Self {
            enabled,
            ttl_secs,
            prefix,
            redis_url,
            redis_client,
            memory,
            stats: Arc::new(ServeCacheStats::default()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Get the Redis URL used by this cache.
    pub fn redis_url(&self) -> &str {
        &self.redis_url
    }

    pub async fn get(&self, fingerprint: &str) -> ServeCacheGetResult {
        if !self.enabled {
            return ServeCacheGetResult {
                result: None,
                tier: ServeCacheHitTier::Disabled,
            };
        }

        let key = self.redis_key(fingerprint);
        if let Some(result) = self.memory.get(&key) {
            if cache_result_matches_contract(&result) {
                self.stats.local_hit_count.fetch_add(1, Ordering::Relaxed);
                return ServeCacheGetResult {
                    result: Some(result),
                    tier: ServeCacheHitTier::Local,
                };
            }
            self.memory.invalidate(&key);
        }
        self.stats.local_miss_count.fetch_add(1, Ordering::Relaxed);

        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
            && let Ok(value) = connection.get::<_, Option<String>>(&key).await
            && let Some(value) = value
            && let Ok(result) = serde_json::from_str::<RecommendationResultPayload>(&value)
            && cache_result_matches_contract(&result)
        {
            self.memory.insert(key, result.clone());
            self.stats.shared_hit_count.fetch_add(1, Ordering::Relaxed);
            return ServeCacheGetResult {
                result: Some(result),
                tier: ServeCacheHitTier::Shared,
            };
        }

        self.stats.shared_miss_count.fetch_add(1, Ordering::Relaxed);
        ServeCacheGetResult {
            result: None,
            tier: ServeCacheHitTier::Miss,
        }
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

        if let Some(existing_result) = self.memory.get(&key) {
            store_result.drifted = existing_result.stable_order_key != result.stable_order_key;
        }

        let mut redis_error = None;
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
        {
            let result: redis::RedisResult<()> = connection
                .set_ex(&key, serialized.clone(), self.ttl_secs as u64)
                .await;
            if let Err(error) = result {
                redis_error = Some(error);
            }
        }

        self.memory.insert(key, result.clone());

        if let Some(error) = redis_error {
            return Err(error.into());
        }

        Ok(store_result)
    }

    fn redis_key(&self, fingerprint: &str) -> String {
        format!("{}:{}:{fingerprint}", self.prefix, SELECTOR_POLICY_VERSION)
    }

    pub fn snapshot(&self) -> ServeCacheSnapshot {
        ServeCacheSnapshot {
            local_hit_count: self.stats.local_hit_count.load(Ordering::Relaxed),
            local_miss_count: self.stats.local_miss_count.load(Ordering::Relaxed),
            shared_hit_count: self.stats.shared_hit_count.load(Ordering::Relaxed),
            shared_miss_count: self.stats.shared_miss_count.load(Ordering::Relaxed),
            local_capacity: self.memory.policy().max_capacity().unwrap_or_default(),
        }
    }

    #[cfg(test)]
    fn local_entry_count(&self) -> u64 {
        self.memory.run_pending_tasks();
        self.memory.entry_count()
    }
}

fn cache_result_matches_contract(result: &RecommendationResultPayload) -> bool {
    let serving = &result.summary.serving;
    result.serving_version == SERVING_VERSION
        && serving.serving_version == SERVING_VERSION
        && result.served_state_version == SERVED_STATE_VERSION
        && serving.served_state_version == SERVED_STATE_VERSION
        && (serving.cursor_mode == CURSOR_MODE
            || serving.cursor_mode == RANKED_CURSOR_ABSTENTION_MODE)
        && serving.cache_key_mode == CACHE_KEY_MODE
        && serving.cache_policy == CACHE_POLICY_MODE
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{
        CACHE_KEY_MODE, CACHE_POLICY_MODE, CURSOR_MODE, RANKED_CURSOR_ABSTENTION_MODE,
        SELECTOR_POLICY_VERSION,
    };
    use super::{ServeCache, ServeCacheHitTier};
    use crate::contracts::{
        RecommendationGraphRetrievalPayload, RecommendationOnlineEvaluationPayload,
        RecommendationRankingSummaryPayload, RecommendationResultPayload,
        RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
        RecommendationServingSummaryPayload, RecommendationSummaryPayload,
    };
    use tokio::time::{Duration, sleep};

    pub(crate) fn test_result(stable_order_key: &str) -> RecommendationResultPayload {
        RecommendationResultPayload {
            request_id: "request".to_string(),
            serving_version: "rust_serving_v1".to_string(),
            cursor: None,
            next_cursor: None,
            has_more: false,
            served_state_version: "related_ids_v1".to_string(),
            stable_order_key: stable_order_key.to_string(),
            candidates: Vec::new(),
            summary: RecommendationSummaryPayload {
                request_id: "request".to_string(),
                stage: "stage".to_string(),
                pipeline_version: "pipeline".to_string(),
                owner: "rust".to_string(),
                fallback_mode: "off".to_string(),
                provider_calls: Default::default(),
                provider_latency_ms: Default::default(),
                retrieved_count: 0,
                selected_count: 0,
                source_counts: Default::default(),
                filter_drop_counts: Default::default(),
                stage_timings: Default::default(),
                stage_latency_ms: Default::default(),
                degraded_reasons: Vec::new(),
                recent_hot_applied: false,
                online_eval: RecommendationOnlineEvaluationPayload::default(),
                selector: RecommendationSelectorPayload {
                    oversample_factor: 1,
                    max_size: 1,
                    final_limit: 1,
                    truncated: false,
                    selector_report: None,
                    selector_report_unavailable_reason: Some("serve_cache_fixture".to_string()),
                },
                serving: RecommendationServingSummaryPayload {
                    serving_version: "rust_serving_v1".to_string(),
                    cursor_mode: "created_at_desc_v1".to_string(),
                    cursor: None,
                    next_cursor: None,
                    has_more: false,
                    served_state_version: "related_ids_v1".to_string(),
                    stable_order_key: stable_order_key.to_string(),
                    duplicate_suppressed_count: 0,
                    cross_page_duplicate_count: 0,
                    suppression_reasons: Default::default(),
                    serve_cache_hit: false,
                    stable_order_drifted: false,
                    cache_key_mode: "normalized_query_v2".to_string(),
                    cache_policy: "bounded_short_ttl_v1".to_string(),
                    cache_policy_reason: "first_page_stable".to_string(),
                    page_remaining_count: 0,
                    page_underfilled: false,
                    page_underfill_reason: None,
                },
                retrieval: RecommendationRetrievalSummaryPayload {
                    stage: "retrieval".to_string(),
                    total_candidates: 0,
                    in_network_candidates: 0,
                    out_of_network_candidates: 0,
                    ml_retrieved_candidates: 0,
                    recent_hot_candidates: 0,
                    source_counts: Default::default(),
                    source_outcome_counts: Default::default(),
                    source_failure_counts: Default::default(),
                    source_disabled_counts: Default::default(),
                    lane_counts: Default::default(),
                    ml_source_counts: Default::default(),
                    stage_timings: Default::default(),
                    degraded_reasons: Vec::new(),
                    graph: RecommendationGraphRetrievalPayload::default(),
                },
                ranking: RecommendationRankingSummaryPayload {
                    stage: "ranking".to_string(),
                    input_candidates: 0,
                    hydrated_candidates: 0,
                    filtered_candidates: 0,
                    scored_candidates: 0,
                    ml_eligible_candidates: 0,
                    ml_ranked_candidates: 0,
                    weighted_candidates: 0,
                    stage_timings: Default::default(),
                    filter_drop_counts: Default::default(),
                    degraded_reasons: Vec::new(),
                },
                stages: Vec::new(),
                trace: None,
            },
        }
    }

    fn test_cache(ttl_secs: usize, capacity: u64) -> ServeCache {
        ServeCache::new(
            true,
            ttl_secs,
            "recommendation:serve:test".to_string(),
            "redis://unused".to_string(),
            None,
            capacity,
        )
    }

    #[tokio::test]
    async fn local_entry_expires_after_ttl() {
        let cache = test_cache(1, 16);
        let result = test_result("stable-a");

        cache.store("fp-1", &result).await.expect("store result");
        assert!(cache.get("fp-1").await.result.is_some());

        sleep(Duration::from_millis(1_100)).await;

        assert!(cache.get("fp-1").await.result.is_none());
    }

    #[tokio::test]
    async fn local_cache_respects_capacity() {
        let cache = test_cache(60, 1);

        cache
            .store("fp-1", &test_result("stable-a"))
            .await
            .expect("store first result");
        cache
            .store("fp-2", &test_result("stable-b"))
            .await
            .expect("store second result");
        tokio::task::yield_now().await;

        assert!(cache.local_entry_count() <= 1);
    }

    #[tokio::test]
    async fn drift_detection_uses_local_cached_value() {
        let cache = test_cache(60, 16);

        let first = cache
            .store("fp-1", &test_result("stable-a"))
            .await
            .expect("store first result");
        assert!(!first.drifted);

        let second = cache
            .store("fp-1", &test_result("stable-b"))
            .await
            .expect("store second result");
        assert!(second.drifted);
    }

    #[tokio::test]
    async fn records_local_and_shared_cache_miss_hit_counts() {
        let cache = test_cache(60, 16);

        assert!(cache.get("missing").await.result.is_none());
        cache
            .store("fp-1", &test_result("stable-a"))
            .await
            .expect("store result");
        assert!(cache.get("fp-1").await.result.is_some());

        let snapshot = cache.snapshot();
        assert_eq!(snapshot.local_miss_count, 1);
        assert_eq!(snapshot.shared_miss_count, 1);
        assert_eq!(snapshot.local_hit_count, 1);
        assert_eq!(snapshot.shared_hit_count, 0);
    }

    #[tokio::test]
    async fn rejects_cached_results_with_stale_serving_contract() {
        let mut stale_serving = test_result("stale-serving");
        stale_serving.serving_version = "rust_serving_v0".to_string();
        let mut stale_state = test_result("stale-state");
        stale_state.served_state_version = "related_ids_v0".to_string();
        let mut stale_summary_serving = test_result("stale-summary-serving");
        stale_summary_serving.summary.serving.serving_version = "rust_serving_v0".to_string();
        let mut stale_summary_state = test_result("stale-summary-state");
        stale_summary_state.summary.serving.served_state_version = "related_ids_v0".to_string();
        let mut stale_cursor = test_result("stale-cursor");
        stale_cursor.summary.serving.cursor_mode = "created_at_desc_v0".to_string();
        let mut stale_key = test_result("stale-key");
        stale_key.summary.serving.cache_key_mode = "normalized_query_v1".to_string();
        let mut stale_policy = test_result("stale-policy");
        stale_policy.summary.serving.cache_policy = "bounded_short_ttl_v0".to_string();

        for (index, result) in [
            stale_serving,
            stale_state,
            stale_summary_serving,
            stale_summary_state,
            stale_cursor,
            stale_key,
            stale_policy,
        ]
        .into_iter()
        .enumerate()
        {
            let cache = test_cache(60, 16);
            let key = format!("stale-{index}");
            cache
                .store(&key, &result)
                .await
                .expect("store stale result");
            let lookup = cache.get(&key).await;
            assert_eq!(lookup.tier, ServeCacheHitTier::Miss);
            assert!(lookup.result.is_none());
        }
    }

    #[tokio::test]
    async fn accepts_current_contract_and_ranked_abstention_mode() {
        let cache = test_cache(60, 16);
        let mut result = test_result("current");
        result.summary.serving.cursor_mode = RANKED_CURSOR_ABSTENTION_MODE.to_string();
        result.summary.serving.cache_key_mode = CACHE_KEY_MODE.to_string();
        result.summary.serving.cache_policy = CACHE_POLICY_MODE.to_string();
        assert_eq!(
            result.summary.serving.cursor_mode,
            RANKED_CURSOR_ABSTENTION_MODE
        );
        assert_eq!(CURSOR_MODE, "created_at_desc_v1");

        cache.store("current", &result).await.expect("store result");
        let lookup = cache.get("current").await;
        assert_eq!(lookup.tier, ServeCacheHitTier::Local);
        assert!(lookup.result.is_some());
    }

    #[test]
    fn cache_key_is_namespaced_by_selector_policy_version() {
        let cache = test_cache(60, 16);

        assert_eq!(
            cache.redis_key("fingerprint"),
            format!("recommendation:serve:test:{SELECTOR_POLICY_VERSION}:fingerprint")
        );
        assert!(
            !cache
                .redis_key("fingerprint")
                .contains("rust_top_k_selector_policy_v2")
        );
    }
}
