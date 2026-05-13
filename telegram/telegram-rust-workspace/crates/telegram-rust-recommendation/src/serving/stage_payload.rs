use telegram_serving_primitives::{
    RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME, SELF_POST_RESCUE_STAGE_NAME,
    ServingPageBuildSummary, serving_page_build_summary_contract_violations,
};

use crate::contracts::RecommendationStagePayload;

use super::stage_detail::{
    SelfPostRescueStageDetailInput, ServeCacheStageDetailInput, ServingLaneStageDetailInput,
    self_post_rescue_stage_detail, serve_cache_stage_detail, serving_lane_stage_detail,
};

pub(crate) fn build_self_post_rescue_stage(
    duration_ms: u64,
    output_count: usize,
    error: Option<&str>,
    requested_limit: usize,
    lookback_days: usize,
) -> RecommendationStagePayload {
    let detail = self_post_rescue_stage_detail(SelfPostRescueStageDetailInput {
        requested_limit,
        lookback_days,
        error,
    });

    RecommendationStagePayload {
        name: SELF_POST_RESCUE_STAGE_NAME.to_string(),
        enabled: true,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(detail),
    }
}

pub(crate) fn build_serve_cache_stage(
    hit: bool,
    duration_ms: u64,
    output_count: usize,
    enabled: bool,
    query_fingerprint: &str,
) -> RecommendationStagePayload {
    let detail = serve_cache_stage_detail(ServeCacheStageDetailInput {
        hit,
        query_fingerprint,
    });

    RecommendationStagePayload {
        name: RUST_SERVE_CACHE_STAGE_NAME.to_string(),
        enabled,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(detail),
    }
}

pub(crate) struct ServingStageInput<'a> {
    pub(crate) duration_ms: u64,
    pub(crate) input_count: usize,
    pub(crate) summary: &'a ServingPageBuildSummary,
    pub(crate) stable_order_key: &'a str,
}

pub(crate) fn build_serving_stage(input: ServingStageInput<'_>) -> RecommendationStagePayload {
    debug_assert!(
        serving_page_build_summary_contract_violations(input.summary).is_empty(),
        "serving stage must receive a valid page build summary"
    );
    let detail = serving_lane_stage_detail(ServingLaneStageDetailInput {
        summary: input.summary,
        stable_order_key: input.stable_order_key,
    });

    RecommendationStagePayload {
        name: RUST_SERVING_LANE_STAGE_NAME.to_string(),
        enabled: true,
        duration_ms: input.duration_ms,
        input_count: input.input_count,
        output_count: input.summary.output_count,
        removed_count: Some(input.summary.removed_count()),
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use telegram_serving_primitives::{
        RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME, SELF_POST_RESCUE_STAGE_NAME,
        ServingPageBuildInput, ServingPageBuildSummary,
    };

    use super::{
        ServingStageInput, build_self_post_rescue_stage, build_serve_cache_stage,
        build_serving_stage,
    };

    #[test]
    fn builds_serving_stage_payloads_with_domain_owned_details() {
        let rescue = build_self_post_rescue_stage(5, 1, None, 10, 180);
        assert_eq!(rescue.name, SELF_POST_RESCUE_STAGE_NAME);
        assert_eq!(rescue.output_count, 1);
        assert!(rescue.detail.is_some());

        let cache = build_serve_cache_stage(true, 3, 2, true, "fingerprint");
        assert_eq!(cache.name, RUST_SERVE_CACHE_STAGE_NAME);
        assert!(cache.enabled);
        assert!(cache.detail.is_some());

        let summary = ServingPageBuildSummary::from_input(ServingPageBuildInput {
            requested_limit: 3,
            output_count: 2,
            page_remaining_count: 1,
            duplicate_suppressed_count: 1,
            cross_page_duplicate_count: 0,
            has_more: true,
            page_underfilled: true,
            page_underfill_reason: Some("dedup_underfill".to_string()),
            suppression_reasons: [("content_duplicate".to_string(), 1)].into_iter().collect(),
        });
        let serving = build_serving_stage(ServingStageInput {
            duration_ms: 7,
            input_count: 3,
            summary: &summary,
            stable_order_key: "stable-key",
        });
        assert_eq!(serving.name, RUST_SERVING_LANE_STAGE_NAME);
        assert_eq!(serving.output_count, 2);
        assert_eq!(serving.removed_count, Some(1));
        assert!(serving.detail.is_some());
    }
}
