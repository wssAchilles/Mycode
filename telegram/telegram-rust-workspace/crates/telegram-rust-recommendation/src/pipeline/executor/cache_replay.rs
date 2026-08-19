use telegram_pipeline_primitives::PIPELINE_TRACE_MODE_CACHE_REPLAY;
use telegram_serving_primitives::{
    PAGE_BUILD_LATENCY_KEY, RUST_SERVE_CACHE_STAGE_NAME, SERVE_CACHE_LATENCY_KEY,
};

use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};
use crate::serving::cursor::RANKED_CURSOR_ABSTENTION_MODE;
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
        enforce_ranked_cursor_abstention(&mut cached_result, query);
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

fn enforce_ranked_cursor_abstention(
    result: &mut RecommendationResultPayload,
    query: &RecommendationQueryPayload,
) {
    if query.in_network_only {
        return;
    }

    result.has_more = false;
    result.next_cursor = None;
    result.summary.serving.cursor_mode = RANKED_CURSOR_ABSTENTION_MODE.to_string();
    result.summary.serving.has_more = false;
    result.summary.serving.next_cursor = None;
    if !result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason == "ranked_cursor_abstention")
    {
        result
            .summary
            .degraded_reasons
            .push("ranked_cursor_abstention".to_string());
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::contracts::RecommendationQueryPayload;
    use crate::serving::cache::tests::test_result;

    use super::enforce_ranked_cursor_abstention;

    #[test]
    fn cached_general_feed_cannot_replay_a_legacy_cursor() {
        let next_cursor = Utc.with_ymd_and_hms(2026, 7, 15, 0, 0, 0).unwrap();
        let mut result = test_result("stable-ranked-page");
        result.has_more = true;
        result.next_cursor = Some(next_cursor);
        result.summary.serving.has_more = true;
        result.summary.serving.next_cursor = Some(next_cursor);
        let query = RecommendationQueryPayload {
            request_id: "ranked-cache-replay".to_string(),
            in_network_only: false,
            ..RecommendationQueryPayload::default()
        };

        enforce_ranked_cursor_abstention(&mut result, &query);

        assert!(!result.has_more);
        assert!(result.next_cursor.is_none());
        assert!(!result.summary.serving.has_more);
        assert!(result.summary.serving.next_cursor.is_none());
        assert_eq!(
            result.summary.serving.cursor_mode,
            "ranked_cursor_abstention_v1"
        );
        assert!(
            result
                .summary
                .degraded_reasons
                .contains(&"ranked_cursor_abstention".to_string())
        );
    }
}
