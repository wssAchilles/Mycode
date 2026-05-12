use std::collections::HashMap;

use serde_json::Value;

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
pub const SELECTOR_DETAIL_SELECTED_TREND_COUNT_FIELD: &str = "selectedTrendCount";
pub const SELECTOR_DETAIL_SELECTED_NEWS_COUNT_FIELD: &str = "selectedNewsCount";
pub const SELECTOR_DETAIL_SELECTED_EXPLORATION_COUNT_FIELD: &str = "selectedExplorationCount";
pub const SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD: &str = "selectedLaneCounts";
pub const SELECTOR_DETAIL_SELECTED_SOURCE_COUNTS_FIELD: &str = "selectedSourceCounts";
pub const SELECTOR_DETAIL_SELECTED_POOL_COUNTS_FIELD: &str = "selectedPoolCounts";
pub const SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD: &str = "selectedAuthorCounts";
pub const SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD: &str = "selectorFirstBlockingReason";
pub const SELECTOR_DETAIL_DEFERRED_REASON_COUNTS_FIELD: &str = "selectorDeferredReasonCounts";
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        SELECTOR_DETAIL_AUDIT_VERSION_FIELD, SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD,
        SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD, SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD,
        SELECTOR_DETAIL_REQUIRED_PHASES_FIELD, SELECTOR_DETAIL_SCORE_INPUT_FIELD,
        SELECTOR_DETAIL_SELECTED_AUTHOR_COUNTS_FIELD, SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD,
        SELECTOR_SCORE_INPUT_FINAL_SCORE, selector_count_map_json, selector_string_array_json,
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
}
