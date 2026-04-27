use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};

use super::{ServeCacheStorePolicy, guard::store_rejection_reason};

pub const CACHE_KEY_MODE: &str = "normalized_query_v2";
pub const CACHE_POLICY_MODE: &str = "bounded_short_ttl_v1";

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
        "first_page_stable"
    } else if query.cursor.is_some() {
        "cursor_replay_stable"
    } else if !query.served_ids.is_empty() {
        "served_state_replay_stable"
    } else {
        "bounded_replay_stable"
    }
}
