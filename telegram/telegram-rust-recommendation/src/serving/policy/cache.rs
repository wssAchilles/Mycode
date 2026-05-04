use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};

use super::{ServeCacheStorePolicy, guard::store_rejection_reason};

pub use telegram_serving_primitives::{CACHE_KEY_MODE, CACHE_POLICY_MODE};
use telegram_serving_primitives::{
    SERVE_CACHE_POLICY_REASON_BOUNDED_REPLAY_STABLE,
    SERVE_CACHE_POLICY_REASON_CURSOR_REPLAY_STABLE, SERVE_CACHE_POLICY_REASON_FIRST_PAGE_STABLE,
    SERVE_CACHE_POLICY_REASON_SERVED_STATE_REPLAY_STABLE,
};

pub fn evaluate_store_policy(
    query: &RecommendationQueryPayload,
    result: &RecommendationResultPayload,
    enabled: bool,
) -> ServeCacheStorePolicy {
    if let Some(reason) = store_rejection_reason(result, enabled) {
        return ServeCacheStorePolicy {
            cacheable: false,
            reason: reason.to_string(),
        };
    }

    ServeCacheStorePolicy {
        cacheable: true,
        reason: stable_replay_reason(query).to_string(),
    }
}

fn stable_replay_reason(query: &RecommendationQueryPayload) -> &'static str {
    if query.cursor.is_none() && query.served_ids.is_empty() {
        SERVE_CACHE_POLICY_REASON_FIRST_PAGE_STABLE
    } else if query.cursor.is_some() {
        SERVE_CACHE_POLICY_REASON_CURSOR_REPLAY_STABLE
    } else if !query.served_ids.is_empty() {
        SERVE_CACHE_POLICY_REASON_SERVED_STATE_REPLAY_STABLE
    } else {
        SERVE_CACHE_POLICY_REASON_BOUNDED_REPLAY_STABLE
    }
}
