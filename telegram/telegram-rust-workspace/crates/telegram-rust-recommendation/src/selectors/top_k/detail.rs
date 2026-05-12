use std::collections::HashMap;

use serde_json::Value;
use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SELECTOR, annotate_stage_contract_detail};
use telegram_selector_primitives::{
    SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_DETAIL_AUDIT_VERSION_FIELD,
    SELECTOR_DETAIL_AUTHOR_SOFT_CAP_FIELD, SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD,
    SELECTOR_DETAIL_DEFERRED_REASON_COUNTS_FIELD, SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD,
    SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD, SELECTOR_DETAIL_MAX_SIZE_FIELD,
    SELECTOR_DETAIL_OVERSAMPLE_FACTOR_FIELD, SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD,
    SELECTOR_DETAIL_POLICY_VERSION_FIELD, SELECTOR_DETAIL_RELAXED_PHASES_FIELD,
    SELECTOR_DETAIL_REQUIRED_PHASES_FIELD, SELECTOR_DETAIL_SCORE_INPUT_FIELD,
    SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD, SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD,
    SELECTOR_DETAIL_SELECTED_COUNT_FIELD, SELECTOR_DETAIL_SELECTED_EXPLORATION_COUNT_FIELD,
    SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD, SELECTOR_DETAIL_SELECTED_NEWS_COUNT_FIELD,
    SELECTOR_DETAIL_SELECTED_POOL_COUNTS_FIELD, SELECTOR_DETAIL_SELECTED_SOURCE_COUNTS_FIELD,
    SELECTOR_DETAIL_SELECTED_TREND_COUNT_FIELD, SELECTOR_DETAIL_TARGET_SIZE_FIELD,
    SELECTOR_DETAIL_WINDOW_SIZE_FIELD, SELECTOR_PHASE_PLAN_VERSION, SELECTOR_POLICY_VERSION,
    SELECTOR_SCORE_INPUT_FINAL_SCORE, SELECTOR_SCORE_SOURCE_VERSION,
    insert_selector_policy_snapshot_detail, selector_count_map_json,
    selector_detail_contract_violations, selector_string_array_json,
};

use crate::contracts::RecommendationCandidatePayload;

use super::{SelectorSelectionReport, build_selector_audit};

pub fn build_selector_stage_detail(
    report: &SelectorSelectionReport,
    selected: &[RecommendationCandidatePayload],
    oversample_factor: usize,
    max_selector_size: usize,
    author_soft_cap: usize,
) -> HashMap<String, Value> {
    let selector_audit = build_selector_audit(selected);
    let mut detail = HashMap::from([
        (
            SELECTOR_DETAIL_POLICY_VERSION_FIELD.to_string(),
            Value::String(SELECTOR_POLICY_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_AUDIT_VERSION_FIELD.to_string(),
            Value::String(SELECTOR_AUDIT_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD.to_string(),
            Value::String(SELECTOR_CONSTRAINT_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD.to_string(),
            Value::String(SELECTOR_SCORE_SOURCE_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_SCORE_INPUT_FIELD.to_string(),
            Value::String(SELECTOR_SCORE_INPUT_FINAL_SCORE.to_string()),
        ),
        (
            SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD.to_string(),
            Value::Bool(true),
        ),
        (
            SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD.to_string(),
            Value::String(SELECTOR_PHASE_PLAN_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_REQUIRED_PHASES_FIELD.to_string(),
            selector_string_array_json(&report.required_phase_names),
        ),
        (
            SELECTOR_DETAIL_RELAXED_PHASES_FIELD.to_string(),
            selector_string_array_json(&report.relaxed_phase_names),
        ),
        (
            SELECTOR_DETAIL_OVERSAMPLE_FACTOR_FIELD.to_string(),
            Value::from(oversample_factor as u64),
        ),
        (
            SELECTOR_DETAIL_MAX_SIZE_FIELD.to_string(),
            Value::from(max_selector_size as u64),
        ),
        (
            SELECTOR_DETAIL_AUTHOR_SOFT_CAP_FIELD.to_string(),
            Value::from(author_soft_cap as u64),
        ),
        (
            SELECTOR_DETAIL_TARGET_SIZE_FIELD.to_string(),
            Value::from(report.target_size as u64),
        ),
        (
            SELECTOR_DETAIL_WINDOW_SIZE_FIELD.to_string(),
            Value::from(report.window_size as u64),
        ),
        (
            SELECTOR_DETAIL_SELECTED_COUNT_FIELD.to_string(),
            Value::from(selector_audit.selected_count as u64),
        ),
        (
            SELECTOR_DETAIL_SELECTED_TREND_COUNT_FIELD.to_string(),
            Value::from(selector_audit.trend_count as u64),
        ),
        (
            SELECTOR_DETAIL_SELECTED_NEWS_COUNT_FIELD.to_string(),
            Value::from(selector_audit.news_count as u64),
        ),
        (
            SELECTOR_DETAIL_SELECTED_EXPLORATION_COUNT_FIELD.to_string(),
            Value::from(selector_audit.exploration_count as u64),
        ),
    ]);

    detail.insert(
        SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD.to_string(),
        selector_count_map_json(selector_audit.lane_counts),
    );
    detail.insert(
        SELECTOR_DETAIL_SELECTED_SOURCE_COUNTS_FIELD.to_string(),
        selector_count_map_json(selector_audit.source_counts),
    );
    detail.insert(
        SELECTOR_DETAIL_SELECTED_POOL_COUNTS_FIELD.to_string(),
        selector_count_map_json(selector_audit.pool_counts),
    );
    detail.insert(
        SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD.to_string(),
        selector_count_map_json(selector_audit.author_counts),
    );

    if let Some(policy) = report.policy_snapshot.as_ref() {
        insert_selector_policy_snapshot_detail(&mut detail, policy);
    }
    if let Some(reason) = report.first_blocking_reason.as_ref() {
        detail.insert(
            SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD.to_string(),
            Value::String(reason.clone()),
        );
    }
    detail.insert(
        SELECTOR_DETAIL_DEFERRED_REASON_COUNTS_FIELD.to_string(),
        selector_count_map_json(report.deferred_reason_counts.clone()),
    );

    annotate_stage_contract_detail(
        &mut detail,
        RUST_TOP_K_SELECTOR,
        PIPELINE_STAGE_KIND_SELECTOR,
    );
    debug_assert!(
        selector_detail_contract_violations(Some(&detail)).is_empty(),
        "selector detail must consume final_score only"
    );

    detail
}
