use std::collections::HashMap;

use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::query_hydrators::batch::hydrate_query_patches_batch_or_fallback;

use super::RecommendationPipeline;

impl RecommendationPipeline {
    pub(super) async fn hydrate_query_parallel_bounded(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        HashMap<String, u64>,
        Vec<String>,
    ) {
        let output = hydrate_query_patches_batch_or_fallback(
            &self.backend_client,
            &self.definition.query_hydrators,
            self.definition.query_hydrator_concurrency,
            query,
        )
        .await;

        (
            output.hydrated_query,
            output.stages,
            output.provider_calls,
            output.provider_latency_ms,
            output.degraded_reasons,
        )
    }
}
