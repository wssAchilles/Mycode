use std::collections::{HashMap, HashSet};

use telegram_pipeline_primitives::{
    PIPELINE_OWNER_RUST, PIPELINE_STAGE_DETAIL_ERROR_FIELD, PIPELINE_STAGE_DETAIL_OWNER_FIELD,
    circuit_breaker_skip_detail,
};
use telegram_serving_primitives::{
    RUST_SERVE_CACHE_STAGE_NAME, RUST_SERVING_LANE_STAGE_NAME,
    SELF_POST_RESCUE_DETAIL_LOOKBACK_DAYS_FIELD, SELF_POST_RESCUE_DETAIL_MODE_FIELD,
    SELF_POST_RESCUE_DETAIL_PROVIDER_FIELD, SELF_POST_RESCUE_MODE, SELF_POST_RESCUE_PROVIDER_NAME,
    SELF_POST_RESCUE_STAGE_NAME, SERVING_PAGE_BUILD_VERSION, SERVING_PAGE_BUILD_VERSION_FIELD,
    SERVING_STABLE_ORDER_MODE, SERVING_STAGE_CACHE_HIT_FIELD, SERVING_STAGE_CACHE_KEY_MODE_FIELD,
    SERVING_STAGE_CACHE_POLICY_FIELD, SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD,
    SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD, SERVING_STAGE_HAS_MORE_FIELD,
    SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD, SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD,
    SERVING_STAGE_PAGE_UNDERFILLED_FIELD, SERVING_STAGE_QUERY_FINGERPRINT_FIELD,
    SERVING_STAGE_REQUESTED_LIMIT_FIELD, SERVING_STAGE_STABLE_ORDER_KEY_FIELD,
    SERVING_STAGE_STABLE_ORDER_MODE_FIELD, SERVING_STAGE_SUPPRESSION_REASONS_FIELD,
    ServingPageBuildSummary,
};

use crate::contracts::RecommendationStagePayload;
use crate::serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE};

use super::SELF_POST_RESCUE_LOOKBACK_DAYS;

pub(super) fn active_component_names(
    configured_components: &[String],
    circuit_open_components: &[String],
    input_count: usize,
) -> (Option<Vec<String>>, Vec<RecommendationStagePayload>) {
    if configured_components.is_empty() {
        return (None, Vec::new());
    }

    let circuit_open = circuit_open_components
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    let mut active = Vec::new();
    let mut skipped = Vec::new();
    for component in configured_components {
        if circuit_open.contains(component.as_str()) {
            skipped.push(build_circuit_disabled_component_stage(
                component,
                input_count,
            ));
        } else {
            active.push(component.clone());
        }
    }

    (Some(active), skipped)
}

pub(super) fn build_self_post_rescue_stage(
    duration_ms: u64,
    output_count: usize,
    error: Option<&str>,
    requested_limit: usize,
) -> RecommendationStagePayload {
    let mut detail = HashMap::from([
        (
            SELF_POST_RESCUE_DETAIL_MODE_FIELD.to_string(),
            serde_json::Value::String(SELF_POST_RESCUE_MODE.to_string()),
        ),
        (
            SELF_POST_RESCUE_DETAIL_PROVIDER_FIELD.to_string(),
            serde_json::Value::String(SELF_POST_RESCUE_PROVIDER_NAME.to_string()),
        ),
        (
            PIPELINE_STAGE_DETAIL_OWNER_FIELD.to_string(),
            serde_json::Value::String(PIPELINE_OWNER_RUST.to_string()),
        ),
        (
            SELF_POST_RESCUE_DETAIL_LOOKBACK_DAYS_FIELD.to_string(),
            serde_json::Value::from(SELF_POST_RESCUE_LOOKBACK_DAYS as u64),
        ),
        (
            "requestedLimit".to_string(),
            serde_json::Value::from(requested_limit as u64),
        ),
    ]);

    if let Some(error) = error {
        detail.insert(
            PIPELINE_STAGE_DETAIL_ERROR_FIELD.to_string(),
            serde_json::Value::String(error.to_string()),
        );
    }

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

pub(super) fn build_serve_cache_stage(
    hit: bool,
    duration_ms: u64,
    output_count: usize,
    enabled: bool,
    query_fingerprint: &str,
) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: RUST_SERVE_CACHE_STAGE_NAME.to_string(),
        enabled,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(HashMap::from([
            (
                SERVING_STAGE_CACHE_HIT_FIELD.to_string(),
                serde_json::Value::Bool(hit),
            ),
            (
                SERVING_STAGE_CACHE_KEY_MODE_FIELD.to_string(),
                serde_json::Value::String(CACHE_KEY_MODE.to_string()),
            ),
            (
                SERVING_STAGE_CACHE_POLICY_FIELD.to_string(),
                serde_json::Value::String(CACHE_POLICY_MODE.to_string()),
            ),
            (
                SERVING_STAGE_QUERY_FINGERPRINT_FIELD.to_string(),
                serde_json::Value::String(query_fingerprint.to_string()),
            ),
        ])),
    }
}

pub(super) struct ServingStageInput<'a> {
    pub(super) duration_ms: u64,
    pub(super) input_count: usize,
    pub(super) summary: &'a ServingPageBuildSummary,
    pub(super) stable_order_key: &'a str,
}

pub(super) fn build_serving_stage(input: ServingStageInput<'_>) -> RecommendationStagePayload {
    let mut detail = HashMap::from([
        (
            SERVING_PAGE_BUILD_VERSION_FIELD.to_string(),
            serde_json::Value::String(SERVING_PAGE_BUILD_VERSION.to_string()),
        ),
        (
            SERVING_STAGE_REQUESTED_LIMIT_FIELD.to_string(),
            serde_json::Value::from(input.summary.requested_limit as u64),
        ),
        (
            SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD.to_string(),
            serde_json::Value::from(input.summary.duplicate_suppressed_count as u64),
        ),
        (
            SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD.to_string(),
            serde_json::Value::from(input.summary.cross_page_duplicate_count as u64),
        ),
        (
            SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD.to_string(),
            serde_json::Value::from(input.summary.page_remaining_count as u64),
        ),
        (
            SERVING_STAGE_STABLE_ORDER_KEY_FIELD.to_string(),
            serde_json::Value::String(input.stable_order_key.to_string()),
        ),
        (
            SERVING_STAGE_STABLE_ORDER_MODE_FIELD.to_string(),
            serde_json::Value::String(SERVING_STABLE_ORDER_MODE.to_string()),
        ),
        (
            SERVING_STAGE_HAS_MORE_FIELD.to_string(),
            serde_json::Value::Bool(input.summary.has_more),
        ),
        (
            SERVING_STAGE_PAGE_UNDERFILLED_FIELD.to_string(),
            serde_json::Value::Bool(input.summary.page_underfilled),
        ),
    ]);
    if let Some(reason) = input.summary.page_underfill_reason.as_deref() {
        detail.insert(
            SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD.to_string(),
            serde_json::Value::String(reason.to_string()),
        );
    }
    detail.insert(
        SERVING_STAGE_SUPPRESSION_REASONS_FIELD.to_string(),
        serde_json::to_value(&input.summary.suppression_reasons).unwrap_or(serde_json::Value::Null),
    );

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

fn build_circuit_disabled_component_stage(
    component: &str,
    input_count: usize,
) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: component.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: None,
        detail: Some(circuit_breaker_skip_detail()),
    }
}

#[cfg(test)]
mod tests {
    use super::active_component_names;

    #[test]
    fn active_component_names_returns_explicit_components_without_circuit_breaks() {
        let configured = vec![
            "AuthorInfoHydrator".to_string(),
            "StatsHydrator".to_string(),
        ];

        let (active, skipped) = active_component_names(&configured, &[], 12);

        assert_eq!(active, Some(configured));
        assert!(skipped.is_empty());
    }

    #[test]
    fn active_component_names_excludes_circuit_open_components() {
        let configured = vec![
            "AuthorInfoHydrator".to_string(),
            "StatsHydrator".to_string(),
        ];

        let (active, skipped) =
            active_component_names(&configured, &["StatsHydrator".to_string()], 12);

        assert_eq!(active, Some(vec!["AuthorInfoHydrator".to_string()]));
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].name, "StatsHydrator");
        assert!(!skipped[0].enabled);
    }
}
