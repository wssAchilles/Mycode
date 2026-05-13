use std::collections::HashMap;

use crate::contracts::{
    RecommendationQueryPatchPayload, RecommendationQueryPayload, RecommendationStagePayload,
};

pub(crate) type QueryHydratorResult = Option<(
    RecommendationStagePayload,
    RecommendationQueryPatchPayload,
    HashMap<String, usize>,
    Option<String>,
)>;

pub(crate) struct QueryHydrationOutput {
    pub(crate) hydrated_query: RecommendationQueryPayload,
    pub(crate) stages: Vec<RecommendationStagePayload>,
    pub(crate) provider_calls: HashMap<String, usize>,
    pub(crate) provider_latency_ms: HashMap<String, u64>,
    pub(crate) degraded_reasons: Vec<String>,
}

impl QueryHydrationOutput {
    pub(crate) fn new(
        hydrated_query: RecommendationQueryPayload,
        stages: Vec<RecommendationStagePayload>,
        provider_calls: HashMap<String, usize>,
        provider_latency_ms: HashMap<String, u64>,
        degraded_reasons: Vec<String>,
    ) -> Self {
        Self {
            hydrated_query,
            stages,
            provider_calls,
            provider_latency_ms,
            degraded_reasons,
        }
    }
}
