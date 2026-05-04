use std::collections::HashMap;

use serde_json::Value;

pub const FILTER_DECISION_SCHEMA_VERSION: &str = "filter_decision_v1";
pub const FILTER_DECISION_MUTATION_DROP_ONLY: &str = "drop_only";
pub const FILTER_DECISION_SCHEMA_VERSION_FIELD: &str = "decisionSchemaVersion";
pub const FILTER_DECISION_MUTATION_FIELD: &str = "decisionMutation";
pub const FILTER_DECISION_DROP_COUNT_FIELD: &str = "decisionDropCount";

pub fn annotate_filter_stage_detail(detail: &mut HashMap<String, Value>, removed_count: usize) {
    detail.insert(
        FILTER_DECISION_SCHEMA_VERSION_FIELD.to_string(),
        Value::String(FILTER_DECISION_SCHEMA_VERSION.to_string()),
    );
    detail.insert(
        FILTER_DECISION_MUTATION_FIELD.to_string(),
        Value::String(FILTER_DECISION_MUTATION_DROP_ONLY.to_string()),
    );
    detail.insert(
        FILTER_DECISION_DROP_COUNT_FIELD.to_string(),
        Value::from(removed_count as u64),
    );
}

pub fn drop_reason_counts(reasons: &[(&str, usize)]) -> Value {
    Value::Object(
        reasons
            .iter()
            .filter(|(_, count)| *count > 0)
            .map(|(reason, count)| (reason.to_string(), Value::from(*count as u64)))
            .collect::<serde_json::Map<String, Value>>(),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        FILTER_DECISION_DROP_COUNT_FIELD, FILTER_DECISION_MUTATION_DROP_ONLY,
        FILTER_DECISION_MUTATION_FIELD, FILTER_DECISION_SCHEMA_VERSION,
        FILTER_DECISION_SCHEMA_VERSION_FIELD, annotate_filter_stage_detail, drop_reason_counts,
    };

    #[test]
    fn annotates_filter_stage_decision_contract() {
        let mut detail = HashMap::new();

        annotate_filter_stage_detail(&mut detail, 3);

        assert_eq!(
            detail.get(FILTER_DECISION_SCHEMA_VERSION_FIELD),
            Some(&json!(FILTER_DECISION_SCHEMA_VERSION))
        );
        assert_eq!(
            detail.get(FILTER_DECISION_MUTATION_FIELD),
            Some(&json!(FILTER_DECISION_MUTATION_DROP_ONLY))
        );
        assert_eq!(
            detail.get(FILTER_DECISION_DROP_COUNT_FIELD),
            Some(&json!(3))
        );
    }

    #[test]
    fn drop_reason_counts_omits_zero_counts() {
        assert_eq!(
            drop_reason_counts(&[("seen", 2), ("served", 0), ("muted", 1)]),
            json!({
                "seen": 2,
                "muted": 1
            })
        );
    }
}
