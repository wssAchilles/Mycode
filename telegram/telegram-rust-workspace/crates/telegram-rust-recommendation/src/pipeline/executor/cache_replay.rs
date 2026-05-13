use telegram_pipeline_primitives::PIPELINE_TRACE_MODE_CACHE_REPLAY;
use telegram_serving_primitives::{
    PAGE_BUILD_LATENCY_KEY, RUST_SERVE_CACHE_STAGE_NAME, SERVE_CACHE_LATENCY_KEY,
};

use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};
use crate::serving::stage_payload::build_serve_cache_stage;

use super::RecommendationPipeline;
use super::telemetry::RunTelemetry;

impl RecommendationPipeline {
    pub(super) fn record_serve_cache_miss_stage(
        &self,
        telemetry: &mut RunTelemetry,
        query_fingerprint: &str,
        serve_cache_duration_ms: u64,
    ) {
        telemetry.add_stage(build_serve_cache_stage(
            false,
            serve_cache_duration_ms,
            0,
            self.serve_cache.enabled(),
            query_fingerprint,
        ));
        telemetry
            .stage_latency_ms
            .insert(SERVE_CACHE_LATENCY_KEY.to_string(), serve_cache_duration_ms);
    }

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
            trace.trace_mode = PIPELINE_TRACE_MODE_CACHE_REPLAY.to_string();
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
        cached_result.summary.stage_timings.insert(
            RUST_SERVE_CACHE_STAGE_NAME.to_string(),
            serve_cache_duration_ms,
        );
        cached_result
            .summary
            .stage_latency_ms
            .insert(SERVE_CACHE_LATENCY_KEY.to_string(), serve_cache_duration_ms);
        cached_result
            .summary
            .stage_latency_ms
            .insert(PAGE_BUILD_LATENCY_KEY.to_string(), page_build_duration_ms);
        cached_result
    }
}
