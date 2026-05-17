use std::collections::HashMap;

use serde_json::Value;

pub mod filter_trait;
pub mod quality_guard;
pub use quality_guard::*;

pub const FILTER_DECISION_SCHEMA_VERSION: &str = "filter_decision_v1";
pub const FILTER_DECISION_MUTATION_DROP_ONLY: &str = "drop_only";
pub const FILTER_DECISION_SCHEMA_VERSION_FIELD: &str = "decisionSchemaVersion";
pub const FILTER_DECISION_MUTATION_FIELD: &str = "decisionMutation";
pub const FILTER_DECISION_DROP_COUNT_FIELD: &str = "decisionDropCount";
pub const FILTER_DROP_REASON_COUNTS_FIELD: &str = "dropReasonCounts";
pub const FILTER_MUTATES_SCORE_FIELD: &str = "filterMutatesScore";

pub const QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD: &str = "emptyContentCount";
pub const QUALITY_GUARD_UNSAFE_COUNT_FIELD: &str = "unsafeCount";
pub const QUALITY_GUARD_ULTRA_SHORT_TEXT_COUNT_FIELD: &str = "ultraShortTextCount";

pub const QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT: &str = "empty_content";
pub const QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT: &str = "unsafe_content";
pub const QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT: &str = "ultra_short_text";
pub const FILTER_DROP_REASON_DUPLICATE_POST: &str = "duplicate_post";
pub const FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID: &str = "duplicate_news_external_id";
pub const FILTER_DROP_REASON_SELF_POST: &str = "self_post";
pub const FILTER_DROP_REASON_RETWEET_DUPLICATE: &str = "retweet_duplicate";
pub const FILTER_DROP_REASON_AGE_LIMIT: &str = "age_limit";
pub const FILTER_DROP_REASON_BLOCKED_AUTHOR: &str = "blocked_author";
pub const FILTER_DROP_REASON_MUTED_AUTHOR: &str = "muted_author";
pub const FILTER_DROP_REASON_AUTHOR_BLOCKS_VIEWER: &str = "author_blocks_viewer";
pub const FILTER_DROP_REASON_MUTED_KEYWORD: &str = "muted_keyword";
pub const FILTER_DROP_REASON_SEEN_POST: &str = "seen_post";
pub const FILTER_DROP_REASON_PREVIOUSLY_SERVED: &str = "previously_served";
pub const FILTER_DROP_REASON_VISIBILITY_UNSAFE: &str = "visibility_unsafe";
pub const FILTER_DROP_REASON_CONVERSATION_DUPLICATE: &str = "conversation_duplicate";

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
    detail.insert(FILTER_MUTATES_SCORE_FIELD.to_string(), Value::Bool(false));
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

pub fn filter_stage_detail_contract_violations(
    removed_count: usize,
    detail: Option<&HashMap<String, Value>>,
) -> Vec<String> {
    let Some(detail) = detail else {
        return vec!["filter_stage_detail_missing".to_string()];
    };

    [
        (
            FILTER_DECISION_SCHEMA_VERSION_FIELD,
            Value::String(FILTER_DECISION_SCHEMA_VERSION.to_string()),
        ),
        (
            FILTER_DECISION_MUTATION_FIELD,
            Value::String(FILTER_DECISION_MUTATION_DROP_ONLY.to_string()),
        ),
        (
            FILTER_DECISION_DROP_COUNT_FIELD,
            Value::from(removed_count as u64),
        ),
        (FILTER_MUTATES_SCORE_FIELD, Value::Bool(false)),
    ]
    .into_iter()
    .filter_map(|(field, expected)| {
        let actual = detail.get(field);
        (actual != Some(&expected)).then(|| {
            format!(
                "filter_stage_detail_mismatch: field={} expected={} got={:?}",
                field, expected, actual
            )
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        FILTER_DECISION_DROP_COUNT_FIELD, FILTER_DECISION_MUTATION_DROP_ONLY,
        FILTER_DECISION_MUTATION_FIELD, FILTER_DECISION_SCHEMA_VERSION,
        FILTER_DECISION_SCHEMA_VERSION_FIELD, FILTER_DROP_REASON_BLOCKED_AUTHOR,
        FILTER_DROP_REASON_CONVERSATION_DUPLICATE, FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID,
        FILTER_DROP_REASON_DUPLICATE_POST, FILTER_DROP_REASON_MUTED_KEYWORD,
        FILTER_DROP_REASON_PREVIOUSLY_SERVED, FILTER_DROP_REASON_SEEN_POST,
        FILTER_DROP_REASON_VISIBILITY_UNSAFE, FILTER_MUTATES_SCORE_FIELD,
        QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT, QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT,
        QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD, QUALITY_GUARD_UNSAFE_COUNT_FIELD,
        annotate_filter_stage_detail, drop_reason_counts, filter_stage_detail_contract_violations,
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
        assert_eq!(detail.get(FILTER_MUTATES_SCORE_FIELD), Some(&json!(false)));
        assert!(filter_stage_detail_contract_violations(3, Some(&detail)).is_empty());

        detail.insert(FILTER_MUTATES_SCORE_FIELD.to_string(), json!(true));
        assert_eq!(
            filter_stage_detail_contract_violations(3, Some(&detail)),
            vec![
                "filter_stage_detail_mismatch: field=filterMutatesScore expected=false got=Some(Bool(true))"
            ]
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
        assert_eq!(FILTER_DROP_REASON_DUPLICATE_POST, "duplicate_post");
        assert_eq!(
            FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID,
            "duplicate_news_external_id"
        );
        assert_eq!(FILTER_DROP_REASON_BLOCKED_AUTHOR, "blocked_author");
        assert_eq!(FILTER_DROP_REASON_MUTED_KEYWORD, "muted_keyword");
        assert_eq!(FILTER_DROP_REASON_SEEN_POST, "seen_post");
        assert_eq!(FILTER_DROP_REASON_PREVIOUSLY_SERVED, "previously_served");
        assert_eq!(FILTER_DROP_REASON_VISIBILITY_UNSAFE, "visibility_unsafe");
        assert_eq!(
            FILTER_DROP_REASON_CONVERSATION_DUPLICATE,
            "conversation_duplicate"
        );
    }
}
