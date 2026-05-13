use std::sync::Arc;

use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};
use crate::serving::policy::evaluate_store_policy;
use crate::side_effects::runtime::dispatch_post_response_side_effects;

use super::RecommendationPipeline;

impl RecommendationPipeline {
    pub(super) fn dispatch_live_post_response_side_effects(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        query_fingerprint: String,
        result: &mut RecommendationResultPayload,
    ) {
        let cache_store_policy =
            evaluate_store_policy(hydrated_query, result, self.serve_cache.enabled());
        result.summary.serving.cache_policy_reason = cache_store_policy.reason.clone();
        dispatch_post_response_side_effects(
            Arc::clone(&self.metrics),
            Arc::clone(&self.recent_store),
            self.serve_cache.clone(),
            hydrated_query.user_id.clone(),
            query_fingerprint,
            result,
            cache_store_policy.cacheable,
        );
    }
}
