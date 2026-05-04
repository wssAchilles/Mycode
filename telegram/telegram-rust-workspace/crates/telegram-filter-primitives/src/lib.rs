use std::collections::HashMap;

use serde_json::Value;

pub const FILTER_DECISION_SCHEMA_VERSION: &str = "filter_decision_v1";
pub const FILTER_DECISION_MUTATION_DROP_ONLY: &str = "drop_only";
pub const FILTER_DECISION_SCHEMA_VERSION_FIELD: &str = "decisionSchemaVersion";
pub const FILTER_DECISION_MUTATION_FIELD: &str = "decisionMutation";
pub const FILTER_DECISION_DROP_COUNT_FIELD: &str = "decisionDropCount";
pub const FILTER_DROP_REASON_COUNTS_FIELD: &str = "dropReasonCounts";

pub const QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD: &str = "emptyContentCount";
pub const QUALITY_GUARD_UNSAFE_COUNT_FIELD: &str = "unsafeCount";
pub const QUALITY_GUARD_ULTRA_SHORT_TEXT_COUNT_FIELD: &str = "ultraShortTextCount";

pub const QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT: &str = "empty_content";
pub const QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT: &str = "unsafe_content";
pub const QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT: &str = "ultra_short_text";

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
        FILTER_DECISION_SCHEMA_VERSION_FIELD, QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT,
        QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT, QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD,
        QUALITY_GUARD_UNSAFE_COUNT_FIELD, annotate_filter_stage_detail, drop_reason_counts,
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
            drop_reason_counts(&[
                (QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT, 2),
                ("served", 0),
                (QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT, 1)
            ]),
            json!({
                "empty_content": 2,
                "unsafe_content": 1
            })
        );
    }

    #[test]
    fn exports_stable_quality_guard_filter_contract() {
        assert_eq!(QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD, "emptyContentCount");
        assert_eq!(QUALITY_GUARD_UNSAFE_COUNT_FIELD, "unsafeCount");
        assert_eq!(QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT, "empty_content");
        assert_eq!(QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT, "unsafe_content");
    }
}
