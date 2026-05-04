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
pub const SERVING_STAGE_HAS_MORE_FIELD: &str = "hasMore";
pub const SERVING_STAGE_PAGE_UNDERFILLED_FIELD: &str = "pageUnderfilled";
pub const SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD: &str = "pageUnderfillReason";
pub const SERVING_STAGE_SUPPRESSION_REASONS_FIELD: &str = "suppressionReasons";

pub const SERVE_CACHE_LATENCY_KEY: &str = "serveCache";
pub const PAGE_BUILD_LATENCY_KEY: &str = "pageBuild";

#[cfg(test)]
mod tests {
    use super::{
        PAGE_BUILD_LATENCY_KEY, RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME,
        SERVE_CACHE_LATENCY_KEY, SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD,
    };

    #[test]
    fn exports_stable_serving_stage_detail_contract() {
        assert_eq!(RUST_SERVE_CACHE_STAGE_NAME, "RustServeCache");
        assert_eq!(RUST_SERVING_LANE_STAGE_NAME, "RustServingLane");
        assert_eq!(
            SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD,
            "duplicateSuppressedCount"
        );
        assert_eq!(SERVE_CACHE_LATENCY_KEY, "serveCache");
        assert_eq!(PAGE_BUILD_LATENCY_KEY, "pageBuild");
    }
}
