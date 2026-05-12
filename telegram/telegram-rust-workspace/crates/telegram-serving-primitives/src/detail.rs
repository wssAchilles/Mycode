pub const RUST_SERVE_CACHE_STAGE_NAME: &str = "RustServeCache";
pub const RUST_SERVING_LANE_STAGE_NAME: &str = "RustServingLane";

pub const SERVING_STAGE_CACHE_HIT_FIELD: &str = "cacheHit";
pub const SERVING_STAGE_CACHE_KEY_MODE_FIELD: &str = "cacheKeyMode";
pub const SERVING_STAGE_CACHE_POLICY_FIELD: &str = "cachePolicy";
pub const SERVING_STAGE_QUERY_FINGERPRINT_FIELD: &str = "queryFingerprint";
pub const SERVING_STAGE_REQUESTED_LIMIT_FIELD: &str = "requestedLimit";
pub const SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD: &str = "duplicateSuppressedCount";
pub const SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD: &str = "crossPageDuplicateCount";
pub const SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD: &str = "pageRemainingCount";
pub const SERVING_STAGE_STABLE_ORDER_KEY_FIELD: &str = "stableOrderKey";
pub const SERVING_STAGE_STABLE_ORDER_MODE_FIELD: &str = "stableOrderMode";
pub const SERVING_STAGE_HAS_MORE_FIELD: &str = "hasMore";
pub const SERVING_STAGE_PAGE_UNDERFILLED_FIELD: &str = "pageUnderfilled";
pub const SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD: &str = "pageUnderfillReason";
pub const SERVING_STAGE_SUPPRESSION_REASONS_FIELD: &str = "suppressionReasons";
pub const SERVING_STAGE_SCORE_INPUT_FIELD: &str = "servingScoreInput";
pub const SERVING_STAGE_MUTATES_SCORE_FIELD: &str = "servingMutatesScore";
pub const SERVING_SCORE_INPUT_SELECTOR_ORDER: &str = "selector_order";

pub const SERVE_CACHE_LATENCY_KEY: &str = "serveCache";
pub const PAGE_BUILD_LATENCY_KEY: &str = "pageBuild";

pub fn serving_stage_detail_contract_violations(
    detail: Option<&std::collections::HashMap<String, serde_json::Value>>,
) -> Vec<String> {
    let Some(detail) = detail else {
        return vec!["serving_stage_detail_missing".to_string()];
    };

    [
        (
            SERVING_STAGE_SCORE_INPUT_FIELD,
            serde_json::Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD,
            serde_json::Value::Bool(false),
        ),
    ]
    .into_iter()
    .filter_map(|(field, expected)| {
        let actual = detail.get(field);
        (actual != Some(&expected)).then(|| {
            format!(
                "serving_stage_detail_mismatch: field={} expected={} got={:?}",
                field, expected, actual
            )
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        PAGE_BUILD_LATENCY_KEY, RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME,
        SERVE_CACHE_LATENCY_KEY, SERVING_SCORE_INPUT_SELECTOR_ORDER,
        SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD, SERVING_STAGE_MUTATES_SCORE_FIELD,
        SERVING_STAGE_SCORE_INPUT_FIELD, SERVING_STAGE_STABLE_ORDER_MODE_FIELD,
        serving_stage_detail_contract_violations,
    };

    #[test]
    fn exports_stable_serving_stage_detail_contract() {
        assert_eq!(RUST_SERVE_CACHE_STAGE_NAME, "RustServeCache");
        assert_eq!(RUST_SERVING_LANE_STAGE_NAME, "RustServingLane");
        assert_eq!(
            SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD,
            "duplicateSuppressedCount"
        );
        assert_eq!(SERVING_STAGE_STABLE_ORDER_MODE_FIELD, "stableOrderMode");
        assert_eq!(SERVING_STAGE_SCORE_INPUT_FIELD, "servingScoreInput");
        assert_eq!(SERVING_STAGE_MUTATES_SCORE_FIELD, "servingMutatesScore");
        assert_eq!(SERVING_SCORE_INPUT_SELECTOR_ORDER, "selector_order");
        assert_eq!(SERVE_CACHE_LATENCY_KEY, "serveCache");
        assert_eq!(PAGE_BUILD_LATENCY_KEY, "pageBuild");
    }

    #[test]
    fn validates_serving_score_boundary_contract() {
        let mut detail = std::collections::HashMap::from([
            (
                SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
                serde_json::json!(SERVING_SCORE_INPUT_SELECTOR_ORDER),
            ),
            (
                SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
                serde_json::json!(false),
            ),
        ]);

        assert!(serving_stage_detail_contract_violations(Some(&detail)).is_empty());

        detail.insert(
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            serde_json::json!(true),
        );
        assert_eq!(
            serving_stage_detail_contract_violations(Some(&detail)),
            vec![
                "serving_stage_detail_mismatch: field=servingMutatesScore expected=false got=Some(Bool(true))"
            ]
        );
    }
}
