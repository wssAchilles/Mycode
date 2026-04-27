use crate::contracts::RecommendationResultPayload;

pub(super) fn store_rejection_reason(
    result: &RecommendationResultPayload,
    enabled: bool,
) -> Option<&'static str> {
    if !enabled {
        return Some("cache_disabled");
    }

    if result.candidates.is_empty() {
        return Some("empty_result");
    }

    if result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason.contains("self_post_rescue"))
    {
        return Some("self_post_rescue_applied");
    }

    if result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason.contains("timeout"))
    {
        return Some("timeout_degraded");
    }

    None
}
