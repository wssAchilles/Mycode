use std::sync::Arc;

use tokio::sync::Mutex;

use crate::contracts::RecommendationResultPayload;
use crate::metrics::RecommendationMetrics;
use crate::serving::cache::ServeCache;
use crate::state::recent_store::RecentHotStore;

pub const ASYNC_SIDE_EFFECT_MODE: &str = "post_response_background_v1";
pub const RECENT_STORE_SIDE_EFFECT: &str = "RecentStoreSideEffect";
pub const SERVE_CACHE_WRITE_SIDE_EFFECT: &str = "ServeCacheWriteSideEffect";

pub fn dispatch_post_response_side_effects(
    metrics: Arc<Mutex<RecommendationMetrics>>,
    recent_store: Arc<Mutex<RecentHotStore>>,
    serve_cache: ServeCache,
    user_id: String,
    query_fingerprint: String,
    result: RecommendationResultPayload,
    cacheable: bool,
) {
    let mut names = Vec::new();
    if !result.candidates.is_empty() {
        names.push(RECENT_STORE_SIDE_EFFECT.to_string());
    }
    if cacheable {
        names.push(SERVE_CACHE_WRITE_SIDE_EFFECT.to_string());
    }
    if names.is_empty() {
        return;
    }

    tokio::spawn(async move {
        {
            let mut metrics = metrics.lock().await;
            metrics.record_side_effect_dispatch(&names);
        }

        let mut errors = Vec::new();
        let mut cache_store_drifted = false;

        if !result.candidates.is_empty() {
            let mut store = recent_store.lock().await;
            store.record(&user_id, &result.candidates);
        }

        if cacheable {
            match serve_cache.store(&query_fingerprint, &result).await {
                Ok(store_result) => {
                    cache_store_drifted = store_result.drifted;
                }
                Err(error) => {
                    errors.push(format!("serve_cache_store_failed:{error}"));
                }
            }
        }

        let mut metrics = metrics.lock().await;
        if errors.is_empty() {
            metrics.record_side_effect_completion(&names, cache_store_drifted);
        } else {
            metrics.record_side_effect_failure(&names, &errors.join("; "));
        }
    });
}
