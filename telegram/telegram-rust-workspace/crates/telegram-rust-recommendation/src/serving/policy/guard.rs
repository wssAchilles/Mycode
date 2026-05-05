use crate::contracts::RecommendationResultPayload;
use telegram_serving_primitives::{
    SELF_POST_RESCUE_POLICY_REASON_TOKEN, SERVE_CACHE_POLICY_REASON_CACHE_DISABLED,
    SERVE_CACHE_POLICY_REASON_EMPTY_RESULT, SERVE_CACHE_POLICY_REASON_SELF_POST_RESCUE_APPLIED,
    SERVE_CACHE_POLICY_REASON_TIMEOUT_DEGRADED,
};

pub(super) fn store_rejection_reason(
    result: &RecommendationResultPayload,
    enabled: bool,
) -> Option<&'static str> {
    if !enabled {
        return Some(SERVE_CACHE_POLICY_REASON_CACHE_DISABLED);
    }

    if result.candidates.is_empty() {
        return Some(SERVE_CACHE_POLICY_REASON_EMPTY_RESULT);
    }

    if result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason.contains(SELF_POST_RESCUE_POLICY_REASON_TOKEN))
    {
        return Some(SERVE_CACHE_POLICY_REASON_SELF_POST_RESCUE_APPLIED);
    }

    if result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason.contains("timeout"))
    {
        return Some(SERVE_CACHE_POLICY_REASON_TIMEOUT_DEGRADED);
    }

    None
}
