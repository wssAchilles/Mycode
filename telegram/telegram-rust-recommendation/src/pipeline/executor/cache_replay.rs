use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};

use super::RecommendationPipeline;
use super::stages::build_serve_cache_stage;

impl RecommendationPipeline {
    pub(super) fn rebuild_cached_result(
        &self,
        mut cached_result: RecommendationResultPayload,
        query: &RecommendationQueryPayload,
        query_fingerprint: &str,
        serve_cache_duration_ms: u64,
        page_build_duration_ms: u64,
    ) -> RecommendationResultPayload {
        cached_result.request_id = query.request_id.clone();
        cached_result.cursor = query.cursor;
        cached_result.summary.request_id = query.request_id.clone();
        cached_result.summary.serving.cursor = query.cursor;
        cached_result.summary.serving.serve_cache_hit = true;
        if let Some(trace) = cached_result.summary.trace.as_mut() {
            trace.request_id = query.request_id.clone();
            trace.serve_cache_hit = true;
        }
        cached_result.summary.stages.insert(
            0,
            build_serve_cache_stage(
                true,
                serve_cache_duration_ms,
                cached_result.candidates.len(),
                self.serve_cache.enabled(),
                query_fingerprint,
            ),
        );
        cached_result
            .summary
            .stage_timings
            .insert("RustServeCache".to_string(), serve_cache_duration_ms);
        cached_result
            .summary
            .stage_latency_ms
            .insert("serveCache".to_string(), serve_cache_duration_ms);
        cached_result
            .summary
            .stage_latency_ms
            .insert("pageBuild".to_string(), page_build_duration_ms);
        cached_result
    }
}
