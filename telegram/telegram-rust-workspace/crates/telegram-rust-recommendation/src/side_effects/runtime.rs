use std::sync::Arc;

use tokio::sync::Mutex;

use crate::contracts::RecommendationResultPayload;
use crate::metrics::RecommendationMetrics;
use crate::pipeline::local::side_effects::diversity_stats::DiversityStatsSideEffect;
use crate::pipeline::local::side_effects::{SideEffect, SideEffectContext};
use crate::serving::cache::ServeCache;
use crate::state::recent_store::RecentHotStore;

#[allow(unused_imports)]
pub use telegram_component_primitives::side_effects::{
    DIVERSITY_STATS_SIDE_EFFECT, FEATURE_CACHING_SIDE_EFFECT, RECENT_STORE_SIDE_EFFECT,
    REQUEST_CACHING_SIDE_EFFECT, SERVE_CACHE_WRITE_SIDE_EFFECT,
};
pub use telegram_serving_primitives::ASYNC_SIDE_EFFECT_MODE;

pub fn dispatch_post_response_side_effects(
    metrics: Arc<Mutex<RecommendationMetrics>>,
    recent_store: Arc<RecentHotStore>,
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
            if let Some(result) = cache_result.as_ref() {
                recent_store.record(&user_id, &result.candidates);
            } else if let Some(candidates) = recent_candidates.as_ref() {
                recent_store.record(&user_id, candidates);
            }
        }

        // Execute the trait-based diversity stats side effect.
        let diversity_candidates = cache_result
            .as_ref()
            .map(|r| r.candidates.clone())
            .or(recent_candidates.clone())
            .unwrap_or_default();

        if !diversity_candidates.is_empty() {
            let diversity_side_effect = DiversityStatsSideEffect::default_config();
            let diversity_context = SideEffectContext {
                user_id: user_id.clone(),
                candidates: diversity_candidates,
                query: crate::contracts::RecommendationQueryPayload {
                    request_id: query_fingerprint.clone(),
                    user_id: user_id.clone(),
                    limit: 0,
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
                    past_request_timestamps: Vec::new(),
                    impressed_post_ids: Vec::new(),
                    subscribed_user_ids: Vec::new(),
                    feature_switches: std::collections::HashMap::new(),
                },
                request_hash: query_fingerprint.clone(),
            };
            if let Err(err) = diversity_side_effect.execute(&diversity_context).await {
                errors.push(format!("diversity_stats_failed:{err}"));
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
