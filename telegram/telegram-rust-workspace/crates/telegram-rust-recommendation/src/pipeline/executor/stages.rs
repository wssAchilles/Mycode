use std::collections::{HashMap, HashSet};

use telegram_pipeline_primitives::{
    PIPELINE_OWNER_RUST, PIPELINE_STAGE_DETAIL_ERROR_FIELD, PIPELINE_STAGE_DETAIL_OWNER_FIELD,
    PIPELINE_STAGE_KIND_SERVING, annotate_stage_contract_detail, circuit_breaker_skip_detail,
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

use crate::contracts::RecommendationStagePayload;
use crate::serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE};

use super::SELF_POST_RESCUE_LOOKBACK_DAYS;

pub(super) fn active_component_names(
    configured_components: &[String],
    circuit_open_components: &[String],
    stage_kind: &str,
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
                stage_kind,
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
            SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
            serde_json::Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            serde_json::Value::Bool(false),
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
    annotate_stage_contract_detail(
        &mut detail,
        SELF_POST_RESCUE_STAGE_NAME,
        PIPELINE_STAGE_KIND_SERVING,
    );
    debug_assert!(
        serving_stage_detail_contract_violations(Some(&detail)).is_empty(),
        "self-post rescue serving stage must not mutate score"
    );

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
    let mut detail = HashMap::from([
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
        (
            SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
            serde_json::Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            serde_json::Value::Bool(false),
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
            SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
            serde_json::Value::String(SERVING_SCORE_INPUT_SELECTOR_ORDER.to_string()),
        ),
        (
            SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(),
            serde_json::Value::Bool(false),
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
    stage_kind: &str,
    input_count: usize,
) -> RecommendationStagePayload {
    let mut detail = circuit_breaker_skip_detail();
    annotate_stage_contract_detail(&mut detail, component, stage_kind);

    RecommendationStagePayload {
        name: component.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: None,
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use super::{ServingStageInput, active_component_names, build_serving_stage};
    use telegram_pipeline_primitives::{
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
        PIPELINE_STAGE_KIND_HYDRATOR, PIPELINE_STAGE_KIND_SERVING,
        stage_detail_contract_violations,
    };
    use telegram_serving_primitives::{
        RUST_SERVING_LANE_STAGE_NAME, SERVING_SCORE_INPUT_SELECTOR_ORDER,
        SERVING_STAGE_MUTATES_SCORE_FIELD, SERVING_STAGE_SCORE_INPUT_FIELD, ServingPageBuildInput,
        ServingPageBuildSummary, serving_page_build_detail_contract_violations,
        serving_stage_detail_contract_violations,
    };

    #[test]
    fn active_component_names_returns_explicit_components_without_circuit_breaks() {
        let configured = vec![
            "AuthorInfoHydrator".to_string(),
            "StatsHydrator".to_string(),
        ];

        let (active, skipped) =
            active_component_names(&configured, &[], PIPELINE_STAGE_KIND_HYDRATOR, 12);

        assert_eq!(active, Some(configured));
        assert!(skipped.is_empty());
    }

    #[test]
    fn active_component_names_excludes_circuit_open_components() {
        let configured = vec![
            "AuthorInfoHydrator".to_string(),
            "StatsHydrator".to_string(),
        ];

        let (active, skipped) = active_component_names(
            &configured,
            &["StatsHydrator".to_string()],
            PIPELINE_STAGE_KIND_HYDRATOR,
            12,
        );

        assert_eq!(active, Some(vec!["AuthorInfoHydrator".to_string()]));
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].name, "StatsHydrator");
        assert!(!skipped[0].enabled);
        let detail = skipped[0].detail.as_ref().expect("skip detail");
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("StatsHydrator")
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_STAGE_KIND_HYDRATOR)
        );
        assert!(
            stage_detail_contract_violations(
                "StatsHydrator",
                PIPELINE_STAGE_KIND_HYDRATOR,
                Some(detail),
            )
            .is_empty()
        );
    }

    #[test]
    fn serving_stage_declares_selector_order_input_without_score_mutation() {
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

        let stage = build_serving_stage(ServingStageInput {
            duration_ms: 7,
            input_count: 3,
            summary: &summary,
            stable_order_key: "stable-key",
        });
        let detail = stage.detail.as_ref().expect("serving detail");

        assert_eq!(stage.name, RUST_SERVING_LANE_STAGE_NAME);
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
            stage_detail_contract_violations(
                RUST_SERVING_LANE_STAGE_NAME,
                PIPELINE_STAGE_KIND_SERVING,
                Some(detail),
            )
            .is_empty()
        );
        assert!(serving_stage_detail_contract_violations(Some(detail)).is_empty());
        assert!(serving_page_build_detail_contract_violations(Some(detail)).is_empty());
    }
}
