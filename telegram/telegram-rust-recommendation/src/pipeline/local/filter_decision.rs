use std::collections::HashMap;

use serde_json::Value;

pub(super) const FILTER_DECISION_SCHEMA_VERSION: &str = "filter_decision_v1";

pub(super) fn annotate_filter_stage_detail(
    detail: &mut HashMap<String, Value>,
    removed_count: usize,
) {
    detail.insert(
        "decisionSchemaVersion".to_string(),
        Value::String(FILTER_DECISION_SCHEMA_VERSION.to_string()),
    );
    detail.insert(
        "decisionMutation".to_string(),
        Value::String("drop_only".to_string()),
    );
    detail.insert(
        "decisionDropCount".to_string(),
        Value::from(removed_count as u64),
    );
}

pub(super) fn drop_reason_counts(reasons: &[(&str, usize)]) -> Value {
    Value::Object(
        reasons
            .iter()
            .filter(|(_, count)| *count > 0)
            .map(|(reason, count)| (reason.to_string(), Value::from(*count as u64)))
            .collect::<serde_json::Map<String, Value>>(),
    )
}
