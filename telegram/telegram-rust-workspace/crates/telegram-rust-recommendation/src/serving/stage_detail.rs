use std::collections::HashMap;

use serde_json::Value;
use telegram_pipeline_primitives::{
    PIPELINE_OWNER_RUST, PIPELINE_STAGE_DETAIL_ERROR_FIELD, PIPELINE_STAGE_DETAIL_OWNER_FIELD,
    PIPELINE_STAGE_KIND_SERVING, annotate_stage_contract_detail,
};
use telegram_serving_primitives::{
    RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME,
    SELF_POST_RESCUE_DETAIL_LOOKBACK_DAYS_FIELD, SELF_POST_RESCUE_DETAIL_MODE_FIELD,
    SELF_POST_RESCUE_DETAIL_PROVIDER_FIELD, SELF_POST_RESCUE_MODE, SELF_POST_RESCUE_PROVIDER_NAME,
    SELF_POST_RESCUE_STAGE_NAME, SERVING_PAGE_BUILD_VERSION, SERVING_PAGE_BUILD_VERSION_FIELD,
    SERVING_SCORE_INPUT_SELECTOR_ORDER, SERVING_STABLE_ORDER_MODE, SERVING_STAGE_CACHE_HIT_FIELD,
    SERVING_STAGE_CACHE_KEY_MODE_FIELD, SERVING_STAGE_CACHE_POLICY_FIELD,
    SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD, SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD,
    SERVING_STAGE_HAS_MORE_FIELD, SERVING_STAGE_MUTATES_SCORE_FIELD,
    SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD, SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD,
    SERVING_STAGE_PAGE_UNDERFILLED_FIELD, SERVING_STAGE_QUERY_FINGERPRINT_FIELD,
    SERVING_STAGE_REQUESTED_LIMIT_FIELD, SERVING_STAGE_SCORE_INPUT_FIELD,
    SERVING_STAGE_STABLE_ORDER_KEY_FIELD, SERVING_STAGE_STABLE_ORDER_MODE_FIELD,
    SERVING_STAGE_SUPPRESSION_REASONS_FIELD, ServingPageBuildSummary,
    serving_page_build_detail_contract_violations, serving_stage_detail_contract_violations,
};

use crate::serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE};

pub struct SelfPostRescueStageDetailInput<'a> {
    pub requested_limit: usize,
    pub lookback_days: usize,
    pub error: Option<&'a str>,
}

pub fn self_post_rescue_stage_detail(
    input: SelfPostRescueStageDetailInput<'_>,
) -> HashMap<String, Value> {
    let mut detail = HashMap::from([
        (
            SELF_POST_RESCUE_DETAIL_MODE_FIELD.to_string(),
            Value::String(SELF_POST_RESCUE_MODE.to_string()),
        ),
        (
            SELF_POST_RESCUE_DETAIL_PROVIDER_FIELD.to_string(),
            Value::String(SELF_POST_RESCUE_PROVIDER_NAME.to_string()),
        ),
        (
            PIPELINE_STAGE_DETAIL_OWNER_FIELD.to_string(),
            Value::String(PIPELINE_OWNER_RUST.to_string()),
        ),
        (
            SELF_POST_RESCUE_DETAIL_LOOKBACK_DAYS_FIELD.to_string(),
            Value::from(input.lookback_days as u64),
        ),
        (
            SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
            Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            Value::Bool(false),
        ),
        (
            SERVING_STAGE_REQUESTED_LIMIT_FIELD.to_string(),
            Value::from(input.requested_limit as u64),
        ),
    ]);

    if let Some(error) = input.error {
        detail.insert(
            PIPELINE_STAGE_DETAIL_ERROR_FIELD.to_string(),
            Value::String(error.to_string()),
        );
    }
    annotate_stage_contract_detail(
        &mut detail,
        SELF_POST_RESCUE_STAGE_NAME,
        PIPELINE_STAGE_KIND_SERVING,
    );
    debug_assert!(
        serving_stage_detail_contract_violations(Some(&detail)).is_empty(),
        "self-post rescue serving stage must not mutate score"
    );
    detail
}

pub struct ServeCacheStageDetailInput<'a> {
    pub hit: bool,
    pub query_fingerprint: &'a str,
}

pub fn serve_cache_stage_detail(input: ServeCacheStageDetailInput<'_>) -> HashMap<String, Value> {
    let mut detail = HashMap::from([
        (
            SERVING_STAGE_CACHE_HIT_FIELD.to_string(),
            Value::Bool(input.hit),
        ),
        (
            SERVING_STAGE_CACHE_KEY_MODE_FIELD.to_string(),
            Value::String(CACHE_KEY_MODE.to_string()),
        ),
        (
            SERVING_STAGE_CACHE_POLICY_FIELD.to_string(),
            Value::String(CACHE_POLICY_MODE.to_string()),
        ),
        (
            SERVING_STAGE_QUERY_FINGERPRINT_FIELD.to_string(),
            Value::String(input.query_fingerprint.to_string()),
        ),
        (
            SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
            Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            Value::Bool(false),
        ),
    ]);
    annotate_stage_contract_detail(
        &mut detail,
        RUST_SERVE_CACHE_STAGE_NAME,
        PIPELINE_STAGE_KIND_SERVING,
    );
    debug_assert!(
        serving_stage_detail_contract_violations(Some(&detail)).is_empty(),
        "serve cache stage must not mutate score"
    );
    detail
}

pub struct ServingLaneStageDetailInput<'a> {
    pub summary: &'a ServingPageBuildSummary,
    pub stable_order_key: &'a str,
}

pub fn serving_lane_stage_detail(input: ServingLaneStageDetailInput<'_>) -> HashMap<String, Value> {
    let mut detail = HashMap::from([
        (
            SERVING_PAGE_BUILD_VERSION_FIELD.to_string(),
            Value::String(SERVING_PAGE_BUILD_VERSION.to_string()),
        ),
        (
            SERVING_STAGE_REQUESTED_LIMIT_FIELD.to_string(),
            Value::from(input.summary.requested_limit as u64),
        ),
        (
            SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD.to_string(),
            Value::from(input.summary.duplicate_suppressed_count as u64),
        ),
        (
            SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD.to_string(),
            Value::from(input.summary.cross_page_duplicate_count as u64),
        ),
        (
            SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD.to_string(),
            Value::from(input.summary.page_remaining_count as u64),
        ),
        (
            SERVING_STAGE_STABLE_ORDER_KEY_FIELD.to_string(),
            Value::String(input.stable_order_key.to_string()),
        ),
        (
            SERVING_STAGE_STABLE_ORDER_MODE_FIELD.to_string(),
            Value::String(SERVING_STABLE_ORDER_MODE.to_string()),
        ),
        (
            SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
            Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            Value::Bool(false),
        ),
        (
            SERVING_STAGE_HAS_MORE_FIELD.to_string(),
            Value::Bool(input.summary.has_more),
        ),
        (
            SERVING_STAGE_PAGE_UNDERFILLED_FIELD.to_string(),
            Value::Bool(input.summary.page_underfilled),
        ),
    ]);
    if let Some(reason) = input.summary.page_underfill_reason.as_deref() {
        detail.insert(
            SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD.to_string(),
            Value::String(reason.to_string()),
        );
    }
    detail.insert(
        SERVING_STAGE_SUPPRESSION_REASONS_FIELD.to_string(),
        serde_json::to_value(&input.summary.suppression_reasons).unwrap_or(Value::Null),
    );
    annotate_stage_contract_detail(
        &mut detail,
        RUST_SERVING_LANE_STAGE_NAME,
        PIPELINE_STAGE_KIND_SERVING,
    );
    debug_assert!(
        serving_stage_detail_contract_violations(Some(&detail)).is_empty(),
        "serving lane stage must not mutate score"
    );
    debug_assert!(
        serving_page_build_detail_contract_violations(Some(&detail)).is_empty(),
        "serving lane stage must expose page build contract"
    );
    detail
}

#[cfg(test)]
mod tests {
    use telegram_pipeline_primitives::{
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
        PIPELINE_STAGE_KIND_SERVING, stage_detail_contract_violations,
    };
    use telegram_serving_primitives::{
        RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME, SELF_POST_RESCUE_STAGE_NAME,
        SERVING_SCORE_INPUT_SELECTOR_ORDER, SERVING_STAGE_MUTATES_SCORE_FIELD,
        SERVING_STAGE_SCORE_INPUT_FIELD, ServingPageBuildInput, ServingPageBuildSummary,
        serving_page_build_detail_contract_violations, serving_stage_detail_contract_violations,
    };

    use super::{
        SelfPostRescueStageDetailInput, ServeCacheStageDetailInput, ServingLaneStageDetailInput,
        self_post_rescue_stage_detail, serve_cache_stage_detail, serving_lane_stage_detail,
    };

    #[test]
    fn self_post_rescue_detail_declares_serving_score_boundary() {
        let detail = self_post_rescue_stage_detail(SelfPostRescueStageDetailInput {
            requested_limit: 3,
            lookback_days: 180,
            error: Some("provider_failed"),
        });

        assert_valid_serving_detail(&detail, SELF_POST_RESCUE_STAGE_NAME);
    }

    #[test]
    fn serve_cache_detail_declares_serving_score_boundary() {
        let detail = serve_cache_stage_detail(ServeCacheStageDetailInput {
            hit: true,
            query_fingerprint: "query-fingerprint",
        });

        assert_valid_serving_detail(&detail, RUST_SERVE_CACHE_STAGE_NAME);
    }

    #[test]
    fn serving_lane_detail_exposes_page_build_contract() {
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

        let detail = serving_lane_stage_detail(ServingLaneStageDetailInput {
            summary: &summary,
            stable_order_key: "stable-key",
        });

        assert_valid_serving_detail(&detail, RUST_SERVING_LANE_STAGE_NAME);
        assert!(serving_page_build_detail_contract_violations(Some(&detail)).is_empty());
    }

    fn assert_valid_serving_detail(
        detail: &std::collections::HashMap<String, serde_json::Value>,
        stage_name: &str,
    ) {
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(stage_name)
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_STAGE_KIND_SERVING)
        );
        assert_eq!(
            detail
                .get(SERVING_STAGE_SCORE_INPUT_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(SERVING_SCORE_INPUT_SELECTOR_ORDER)
        );
        assert_eq!(
            detail
                .get(SERVING_STAGE_MUTATES_SCORE_FIELD)
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
        assert!(
            stage_detail_contract_violations(stage_name, PIPELINE_STAGE_KIND_SERVING, Some(detail))
                .is_empty()
        );
        assert!(serving_stage_detail_contract_violations(Some(detail)).is_empty());
    }
}
