use std::sync::Arc;

use tokio::sync::Mutex;

use crate::contracts::RecommendationResultPayload;
use crate::metrics::RecommendationMetrics;
use crate::serving::cache::ServeCache;
use crate::state::recent_store::RecentHotStore;

pub use telegram_component_primitives::side_effects::{
    DIVERSITY_STATS_SIDE_EFFECT, RECENT_STORE_SIDE_EFFECT, SERVE_CACHE_WRITE_SIDE_EFFECT,
};
pub use telegram_serving_primitives::ASYNC_SIDE_EFFECT_MODE;

pub fn dispatch_post_response_side_effects(
    metrics: Arc<Mutex<RecommendationMetrics>>,
    recent_store: Arc<Mutex<RecentHotStore>>,
    serve_cache: ServeCache,
    user_id: String,
    query_fingerprint: String,
    result: &RecommendationResultPayload,
    cacheable: bool,
) {
    let mut names = Vec::new();
    if !result.candidates.is_empty() {
        names.push(RECENT_STORE_SIDE_EFFECT.to_string());
        names.push(DIVERSITY_STATS_SIDE_EFFECT.to_string());
    }
    if cacheable {
        names.push(SERVE_CACHE_WRITE_SIDE_EFFECT.to_string());
    }
    if names.is_empty() {
        return;
    }
    let cache_result = cacheable.then(|| result.clone());
    let recent_candidates = if cache_result.is_none() && !result.candidates.is_empty() {
        Some(result.candidates.clone())
    } else {
        None
    };

    tokio::spawn(async move {
        {
            let mut metrics = metrics.lock().await;
            metrics.record_side_effect_dispatch(&names);
        }

        let mut errors = Vec::new();
        let mut cache_store_drifted = false;

        if cache_result
            .as_ref()
            .is_some_and(|result| !result.candidates.is_empty())
            || recent_candidates
                .as_ref()
                .is_some_and(|candidates| !candidates.is_empty())
        {
            let mut store = recent_store.lock().await;
            if let Some(result) = cache_result.as_ref() {
                store.record(&user_id, &result.candidates);
            } else if let Some(candidates) = recent_candidates.as_ref() {
                store.record(&user_id, candidates);
            }
        }

        // Diversity stats: record source and author distribution.
        let diversity_candidates = cache_result
            .as_ref()
            .map(|r| r.candidates.as_slice())
            .or(recent_candidates.as_deref());
        if let Some(candidates) = diversity_candidates.filter(|c| !c.is_empty()) {
            let source_counts = candidates
                .iter()
                .filter_map(|c| c.recall_source.as_deref())
                .fold(std::collections::HashMap::new(), |mut acc, source| {
                    *acc.entry(source.to_string()).or_insert(0usize) += 1;
                    acc
                });
            let unique_authors = candidates
                .iter()
                .map(|c| c.author_id.as_str())
                .collect::<std::collections::HashSet<_>>()
                .len();
            {
                let mut metrics = metrics.lock().await;
                metrics.record_diversity_stats(source_counts, unique_authors);
            }
        }

        if let Some(result) = cache_result.as_ref() {
            match serve_cache.store(&query_fingerprint, result).await {
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
