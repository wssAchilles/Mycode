use std::collections::HashMap;

use serde_json::Value;

use crate::{
    SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_POLICY_VERSION,
    SELECTOR_SCORE_SOURCE_VERSION, SelectorPolicySnapshot,
};

pub const SELECTOR_DETAIL_POLICY_VERSION_FIELD: &str = "selectorPolicyVersion";
pub const SELECTOR_DETAIL_AUDIT_VERSION_FIELD: &str = "auditVersion";
pub const SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD: &str = "selectorConstraintVersion";
pub const SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD: &str = "selectorScoreSourceVersion";
pub const SELECTOR_DETAIL_OVERSAMPLE_FACTOR_FIELD: &str = "oversampleFactor";
pub const SELECTOR_DETAIL_MAX_SIZE_FIELD: &str = "maxSize";
pub const SELECTOR_DETAIL_TARGET_SIZE_FIELD: &str = "targetSize";
pub const SELECTOR_DETAIL_WINDOW_SIZE_FIELD: &str = "windowSize";
pub const SELECTOR_DETAIL_AUTHOR_SOFT_CAP_FIELD: &str = "authorSoftCap";
pub const SELECTOR_DETAIL_SELECTED_COUNT_FIELD: &str = "selectedCount";
pub const SELECTOR_DETAIL_REQUIRED_SELECTED_COUNT_FIELD: &str = "selectorRequiredSelectedCount";
pub const SELECTOR_DETAIL_RELAXED_SELECTED_COUNT_FIELD: &str = "selectorRelaxedSelectedCount";
pub const SELECTOR_DETAIL_SELECTED_TREND_COUNT_FIELD: &str = "selectedTrendCount";
pub const SELECTOR_DETAIL_SELECTED_NEWS_COUNT_FIELD: &str = "selectedNewsCount";
pub const SELECTOR_DETAIL_SELECTED_EXPLORATION_COUNT_FIELD: &str = "selectedExplorationCount";
pub const SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD: &str = "selectedLaneCounts";
pub const SELECTOR_DETAIL_SELECTED_SOURCE_COUNTS_FIELD: &str = "selectedSourceCounts";
pub const SELECTOR_DETAIL_SELECTED_POOL_COUNTS_FIELD: &str = "selectedPoolCounts";
pub const SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD: &str = "selectedAuthorCounts";
pub const SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD: &str = "selectorFirstBlockingReason";
pub const SELECTOR_DETAIL_DEFERRED_REASON_COUNTS_FIELD: &str = "selectorDeferredReasonCounts";
pub const SELECTOR_DETAIL_REQUIRED_DEFERRED_REASON_COUNTS_FIELD: &str =
    "selectorRequiredDeferredReasonCounts";
pub const SELECTOR_DETAIL_RELAXED_DEFERRED_REASON_COUNTS_FIELD: &str =
    "selectorRelaxedDeferredReasonCounts";
pub const SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD: &str = "selectorPhasePlanVersion";
pub const SELECTOR_DETAIL_REQUIRED_PHASES_FIELD: &str = "selectorRequiredPhases";
pub const SELECTOR_DETAIL_RELAXED_PHASES_FIELD: &str = "selectorRelaxedPhases";
pub const SELECTOR_DETAIL_WINDOW_FACTOR_FIELD: &str = "selectorWindowFactor";
pub const SELECTOR_DETAIL_LANE_FLOORS_FIELD: &str = "selectorLaneFloors";
pub const SELECTOR_DETAIL_LANE_CEILINGS_FIELD: &str = "selectorLaneCeilings";
pub const SELECTOR_DETAIL_LANE_ORDER_FIELD: &str = "selectorLaneOrder";
pub const SELECTOR_DETAIL_MAX_OON_COUNT_FIELD: &str = "selectorMaxOonCount";
pub const SELECTOR_DETAIL_TREND_CEILING_FIELD: &str = "selectorTrendCeiling";
pub const SELECTOR_DETAIL_NEWS_CEILING_FIELD: &str = "selectorNewsCeiling";
pub const SELECTOR_DETAIL_EXPLORATION_FLOOR_FIELD: &str = "selectorExplorationFloor";
pub const SELECTOR_DETAIL_TOPIC_SOFT_CAP_FIELD: &str = "selectorTopicSoftCap";
pub const SELECTOR_DETAIL_SOURCE_SOFT_CAP_FIELD: &str = "selectorSourceSoftCap";
pub const SELECTOR_DETAIL_DOMAIN_SOFT_CAP_FIELD: &str = "selectorDomainSoftCap";
pub const SELECTOR_DETAIL_MEDIA_SOFT_CAP_FIELD: &str = "selectorMediaSoftCap";
pub const SELECTOR_DETAIL_SCORE_INPUT_FIELD: &str = "selectorScoreInput";
pub const SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD: &str = "selectorFinalScoreOnly";
pub const SELECTOR_DETAIL_SELECTION_MODE_FIELD: &str = "selectorSelectionMode";

pub const SELECTOR_SCORE_INPUT_FINAL_SCORE: &str = "final_score";

pub fn selector_count_map_json(counts: HashMap<String, usize>) -> Value {
    Value::Object(
        counts
            .into_iter()
            .map(|(key, count)| (key, Value::from(count as u64)))
            .collect(),
    )
}

pub fn selector_string_array_json(values: &[&str]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|value| Value::String((*value).to_string()))
            .collect(),
    )
}

pub fn insert_selector_policy_snapshot_detail(
    detail: &mut HashMap<String, Value>,
    policy: &SelectorPolicySnapshot,
) {
    detail.insert(
        SELECTOR_DETAIL_WINDOW_FACTOR_FIELD.to_string(),
        Value::from(policy.window_factor as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_LANE_FLOORS_FIELD.to_string(),
        serde_json::to_value(&policy.lane_floors).unwrap_or(Value::Null),
    );
    detail.insert(
        SELECTOR_DETAIL_LANE_CEILINGS_FIELD.to_string(),
        serde_json::to_value(&policy.lane_ceilings).unwrap_or(Value::Null),
    );
    detail.insert(
        SELECTOR_DETAIL_LANE_ORDER_FIELD.to_string(),
        serde_json::to_value(&policy.lane_order).unwrap_or(Value::Null),
    );
    detail.insert(
        SELECTOR_DETAIL_MAX_OON_COUNT_FIELD.to_string(),
        Value::from(policy.max_oon_count as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_TREND_CEILING_FIELD.to_string(),
        Value::from(policy.trend_ceiling as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_NEWS_CEILING_FIELD.to_string(),
        Value::from(policy.news_ceiling as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_EXPLORATION_FLOOR_FIELD.to_string(),
        Value::from(policy.exploration_floor as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_TOPIC_SOFT_CAP_FIELD.to_string(),
        Value::from(policy.topic_soft_cap as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_SOURCE_SOFT_CAP_FIELD.to_string(),
        Value::from(policy.source_soft_cap as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_DOMAIN_SOFT_CAP_FIELD.to_string(),
        Value::from(policy.domain_soft_cap as u64),
    );
    detail.insert(
        SELECTOR_DETAIL_MEDIA_SOFT_CAP_FIELD.to_string(),
        Value::from(policy.media_soft_cap as u64),
    );
}

pub fn selector_detail_contract_violations(detail: Option<&HashMap<String, Value>>) -> Vec<String> {
    let Some(detail) = detail else {
        return vec!["selector_detail_missing".to_string()];
    };

    let mut violations = [
        (
            SELECTOR_DETAIL_POLICY_VERSION_FIELD,
            Value::String(SELECTOR_POLICY_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_AUDIT_VERSION_FIELD,
            Value::String(SELECTOR_AUDIT_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD,
            Value::String(SELECTOR_CONSTRAINT_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD,
            Value::String(SELECTOR_SCORE_SOURCE_VERSION.to_string()),
        ),
        (
            SELECTOR_DETAIL_SCORE_INPUT_FIELD,
            Value::String(SELECTOR_SCORE_INPUT_FINAL_SCORE.to_string()),
        ),
        (SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD, Value::Bool(true)),
    ]
    .into_iter()
    .filter_map(|(field, expected)| {
        let actual = detail.get(field);
        (actual != Some(&expected)).then(|| {
            format!(
                "selector_detail_mismatch: field={} expected={} got={:?}",
                field, expected, actual
            )
        })
    })
    .collect::<Vec<_>>();

    violations.extend(selector_detail_report_contract_violations(detail));
    violations
}

fn selector_detail_report_contract_violations(detail: &HashMap<String, Value>) -> Vec<String> {
    let mut violations = Vec::new();
    let selected_count = detail
        .get(SELECTOR_DETAIL_SELECTED_COUNT_FIELD)
        .and_then(Value::as_u64);
    let required_selected_count = detail
        .get(SELECTOR_DETAIL_REQUIRED_SELECTED_COUNT_FIELD)
        .and_then(Value::as_u64);
    let relaxed_selected_count = detail
        .get(SELECTOR_DETAIL_RELAXED_SELECTED_COUNT_FIELD)
        .and_then(Value::as_u64);
    let target_size = detail
        .get(SELECTOR_DETAIL_TARGET_SIZE_FIELD)
        .and_then(Value::as_u64);
    let window_size = detail
        .get(SELECTOR_DETAIL_WINDOW_SIZE_FIELD)
        .and_then(Value::as_u64);

    for (field, value) in [
        (SELECTOR_DETAIL_SELECTED_COUNT_FIELD, selected_count),
        (
            SELECTOR_DETAIL_REQUIRED_SELECTED_COUNT_FIELD,
            required_selected_count,
        ),
        (
            SELECTOR_DETAIL_RELAXED_SELECTED_COUNT_FIELD,
            relaxed_selected_count,
        ),
        (SELECTOR_DETAIL_TARGET_SIZE_FIELD, target_size),
        (SELECTOR_DETAIL_WINDOW_SIZE_FIELD, window_size),
    ] {
        if value.is_none() {
            violations.push(format!(
                "selector_detail_field_missing_or_invalid: field={field}"
            ));
        }
    }

    if let (Some(selected), Some(required), Some(relaxed)) = (
        selected_count,
        required_selected_count,
        relaxed_selected_count,
    ) && required.saturating_add(relaxed) != selected
    {
        violations.push(format!(
            "selector_detail_phase_count_mismatch: selected={selected} required={required} relaxed={relaxed}"
        ));
    }
    if let (Some(selected), Some(target)) = (selected_count, target_size)
        && selected > target
    {
        violations.push(format!(
            "selector_detail_selected_exceeds_target: selected={selected} target={target}"
        ));
    }
    if let (Some(selected), Some(window)) = (selected_count, window_size)
        && selected > window
    {
        violations.push(format!(
            "selector_detail_selected_exceeds_window: selected={selected} window={window}"
        ));
    }

    let selection_mode = detail
        .get(SELECTOR_DETAIL_SELECTION_MODE_FIELD)
        .and_then(Value::as_str);
    match selection_mode {
        Some(crate::SELECTOR_SELECTION_MODE_POLICY_STATE_MACHINE) => {
            if !detail
                .get(SELECTOR_DETAIL_REQUIRED_PHASES_FIELD)
                .is_some_and(Value::is_array)
            {
                violations.push("selector_detail_required_phases_missing".to_string());
            }
            if !detail
                .get(SELECTOR_DETAIL_RELAXED_PHASES_FIELD)
                .is_some_and(Value::is_array)
            {
                violations.push("selector_detail_relaxed_phases_missing".to_string());
            }
            if !detail
                .get(SELECTOR_DETAIL_LANE_ORDER_FIELD)
                .is_some_and(Value::is_array)
            {
                violations.push("selector_detail_policy_snapshot_missing".to_string());
            }
        }
        Some(crate::SELECTOR_SELECTION_MODE_IN_NETWORK_RECENCY) => {
            if relaxed_selected_count.unwrap_or_default() > 0 {
                violations.push("selector_detail_legacy_mode_has_relaxed_selection".to_string());
            }
        }
        Some(mode) => {
            violations.push(format!(
                "selector_detail_unknown_selection_mode: mode={mode}"
            ));
        }
        None => {
            violations.push(format!(
                "selector_detail_field_missing_or_invalid: field={}",
                SELECTOR_DETAIL_SELECTION_MODE_FIELD
            ));
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        SELECTOR_DETAIL_AUDIT_VERSION_FIELD, SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD,
        SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD, SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD,
        SELECTOR_DETAIL_LANE_ORDER_FIELD, SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD,
        SELECTOR_DETAIL_POLICY_VERSION_FIELD, SELECTOR_DETAIL_RELAXED_PHASES_FIELD,
        SELECTOR_DETAIL_RELAXED_SELECTED_COUNT_FIELD, SELECTOR_DETAIL_REQUIRED_PHASES_FIELD,
        SELECTOR_DETAIL_REQUIRED_SELECTED_COUNT_FIELD, SELECTOR_DETAIL_SCORE_INPUT_FIELD,
        SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD, SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD,
        SELECTOR_DETAIL_SELECTED_COUNT_FIELD, SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD,
        SELECTOR_DETAIL_SELECTION_MODE_FIELD, SELECTOR_DETAIL_TARGET_SIZE_FIELD,
        SELECTOR_DETAIL_WINDOW_FACTOR_FIELD, SELECTOR_DETAIL_WINDOW_SIZE_FIELD,
        SELECTOR_SCORE_INPUT_FINAL_SCORE, insert_selector_policy_snapshot_detail,
        selector_count_map_json, selector_detail_contract_violations, selector_string_array_json,
    };
    use crate::{
        SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_POLICY_VERSION,
        SELECTOR_SCORE_SOURCE_VERSION, SelectorPolicySnapshot,
    };

    #[test]
    fn exports_selector_detail_field_contract() {
        assert_eq!(SELECTOR_DETAIL_AUDIT_VERSION_FIELD, "auditVersion");
        assert_eq!(
            SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD,
            "selectedLaneCounts"
        );
        assert_eq!(
            SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD,
            "selectorFirstBlockingReason"
        );
        assert_eq!(
            SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD,
            "selectedAuthorCounts"
        );
        assert_eq!(SELECTOR_DETAIL_SCORE_INPUT_FIELD, "selectorScoreInput");
        assert_eq!(
            SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD,
            "selectorFinalScoreOnly"
        );
        assert_eq!(SELECTOR_SCORE_INPUT_FINAL_SCORE, "final_score");
        assert_eq!(
            SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD,
            "selectorPhasePlanVersion"
        );
        assert_eq!(
            SELECTOR_DETAIL_SELECTION_MODE_FIELD,
            "selectorSelectionMode"
        );
        assert_eq!(
            SELECTOR_DETAIL_REQUIRED_SELECTED_COUNT_FIELD,
            "selectorRequiredSelectedCount"
        );
        assert_eq!(
            SELECTOR_DETAIL_RELAXED_SELECTED_COUNT_FIELD,
            "selectorRelaxedSelectedCount"
        );
        assert_eq!(
            SELECTOR_DETAIL_REQUIRED_PHASES_FIELD,
            "selectorRequiredPhases"
        );
    }

    #[test]
    fn converts_selector_count_maps_to_json_objects() {
        let value = selector_count_map_json(HashMap::from([("in_network".to_string(), 4)]));

        assert_eq!(
            value
                .as_object()
                .and_then(|object| object.get("in_network"))
                .and_then(serde_json::Value::as_u64),
            Some(4)
        );
    }

    #[test]
    fn converts_selector_phase_names_to_json_arrays() {
        let value = selector_string_array_json(&["required_lane_floors"]);

        assert_eq!(
            value
                .as_array()
                .and_then(|values| values.first())
                .and_then(serde_json::Value::as_str),
            Some("required_lane_floors")
        );
    }

    #[test]
    fn inserts_selector_policy_snapshot_detail() {
        let mut detail = HashMap::new();
        let policy = SelectorPolicySnapshot {
            target_size: 6,
            window_factor: 3,
            lane_order: vec!["in_network".to_string(), "interest".to_string()],
            ..SelectorPolicySnapshot::default()
        };

        insert_selector_policy_snapshot_detail(&mut detail, &policy);

        assert_eq!(
            detail
                .get(SELECTOR_DETAIL_WINDOW_FACTOR_FIELD)
                .and_then(serde_json::Value::as_u64),
            Some(3)
        );
        assert_eq!(
            detail.get(SELECTOR_DETAIL_LANE_ORDER_FIELD),
            Some(&serde_json::json!(["in_network", "interest"]))
        );
    }

    #[test]
    fn validates_selector_detail_score_boundary_contract() {
        let mut detail = HashMap::from([
            (
                SELECTOR_DETAIL_POLICY_VERSION_FIELD.to_string(),
                serde_json::json!(SELECTOR_POLICY_VERSION),
            ),
            (
                SELECTOR_DETAIL_AUDIT_VERSION_FIELD.to_string(),
                serde_json::json!(SELECTOR_AUDIT_VERSION),
            ),
            (
                SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD.to_string(),
                serde_json::json!(SELECTOR_CONSTRAINT_VERSION),
            ),
            (
                SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD.to_string(),
                serde_json::json!(SELECTOR_SCORE_SOURCE_VERSION),
            ),
            (
                SELECTOR_DETAIL_SCORE_INPUT_FIELD.to_string(),
                serde_json::json!(SELECTOR_SCORE_INPUT_FINAL_SCORE),
            ),
            (
                SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD.to_string(),
                serde_json::json!(true),
            ),
            (
                SELECTOR_DETAIL_SELECTION_MODE_FIELD.to_string(),
                serde_json::json!(crate::SELECTOR_SELECTION_MODE_POLICY_STATE_MACHINE),
            ),
            (
                SELECTOR_DETAIL_SELECTED_COUNT_FIELD.to_string(),
                serde_json::json!(2),
            ),
            (
                SELECTOR_DETAIL_REQUIRED_SELECTED_COUNT_FIELD.to_string(),
                serde_json::json!(1),
            ),
            (
                SELECTOR_DETAIL_RELAXED_SELECTED_COUNT_FIELD.to_string(),
                serde_json::json!(1),
            ),
            (
                SELECTOR_DETAIL_TARGET_SIZE_FIELD.to_string(),
                serde_json::json!(5),
            ),
            (
                SELECTOR_DETAIL_WINDOW_SIZE_FIELD.to_string(),
                serde_json::json!(10),
            ),
            (
                SELECTOR_DETAIL_REQUIRED_PHASES_FIELD.to_string(),
                selector_string_array_json(&["required_lane_floor_fill"]),
            ),
            (
                SELECTOR_DETAIL_RELAXED_PHASES_FIELD.to_string(),
                selector_string_array_json(&["relaxed_next_available_fill"]),
            ),
            (
                SELECTOR_DETAIL_LANE_ORDER_FIELD.to_string(),
                selector_string_array_json(&["in_network"]),
            ),
        ]);

        assert!(selector_detail_contract_violations(Some(&detail)).is_empty());

        detail.insert(
            SELECTOR_DETAIL_SCORE_INPUT_FIELD.to_string(),
            serde_json::json!("weighted_score"),
        );
        assert_eq!(
            selector_detail_contract_violations(Some(&detail)),
            vec![
                "selector_detail_mismatch: field=selectorScoreInput expected=\"final_score\" got=Some(String(\"weighted_score\"))"
            ]
        );
    }
}
