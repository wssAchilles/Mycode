use std::collections::HashMap;

use serde_json::Value;

use crate::{
    SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD, SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD,
    SERVING_STAGE_HAS_MORE_FIELD, SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD,
    SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD, SERVING_STAGE_PAGE_UNDERFILLED_FIELD,
    SERVING_STAGE_REQUESTED_LIMIT_FIELD, SERVING_STAGE_SUPPRESSION_REASONS_FIELD,
};

pub const SERVING_PAGE_BUILD_VERSION: &str = "serving_page_build_v1";
pub const SERVING_PAGE_BUILD_VERSION_FIELD: &str = "servingPageBuildVersion";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServingPageBuildSummary {
    pub requested_limit: usize,
    pub output_count: usize,
    pub page_remaining_count: usize,
    pub duplicate_suppressed_count: usize,
    pub cross_page_duplicate_count: usize,
    pub has_more: bool,
    pub page_underfilled: bool,
    pub page_underfill_reason: Option<String>,
    pub suppression_reasons: HashMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServingPageBuildInput {
    pub requested_limit: usize,
    pub output_count: usize,
    pub page_remaining_count: usize,
    pub duplicate_suppressed_count: usize,
    pub cross_page_duplicate_count: usize,
    pub has_more: bool,
    pub page_underfilled: bool,
    pub page_underfill_reason: Option<String>,
    pub suppression_reasons: HashMap<String, usize>,
}

impl ServingPageBuildSummary {
    pub fn from_input(input: ServingPageBuildInput) -> Self {
        Self {
            requested_limit: input.requested_limit,
            output_count: input.output_count,
            page_remaining_count: input.page_remaining_count,
            duplicate_suppressed_count: input.duplicate_suppressed_count,
            cross_page_duplicate_count: input.cross_page_duplicate_count,
            has_more: input.has_more,
            page_underfilled: input.page_underfilled,
            page_underfill_reason: input.page_underfill_reason,
            suppression_reasons: input.suppression_reasons,
        }
    }

    pub fn removed_count(&self) -> usize {
        self.duplicate_suppressed_count
    }

    pub fn total_suppressed_count(&self) -> usize {
        self.duplicate_suppressed_count + self.cross_page_duplicate_count
    }
}

pub fn serving_page_build_detail_contract_violations(
    detail: Option<&HashMap<String, Value>>,
) -> Vec<String> {
    let Some(detail) = detail else {
        return vec!["serving_page_build_detail_missing".to_string()];
    };

    let mut violations = Vec::new();
    if detail.get(SERVING_PAGE_BUILD_VERSION_FIELD)
        != Some(&Value::String(SERVING_PAGE_BUILD_VERSION.to_string()))
    {
        violations.push(format!(
            "serving_page_build_detail_mismatch: field={} expected={} got={:?}",
            SERVING_PAGE_BUILD_VERSION_FIELD,
            SERVING_PAGE_BUILD_VERSION,
            detail.get(SERVING_PAGE_BUILD_VERSION_FIELD)
        ));
    }

    for field in [
        SERVING_STAGE_REQUESTED_LIMIT_FIELD,
        SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD,
        SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD,
        SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD,
    ] {
        if !detail.get(field).is_some_and(Value::is_u64) {
            violations.push(format!(
                "serving_page_build_detail_field_missing_or_invalid: field={field}"
            ));
        }
    }

    for field in [
        SERVING_STAGE_HAS_MORE_FIELD,
        SERVING_STAGE_PAGE_UNDERFILLED_FIELD,
    ] {
        if !detail.get(field).is_some_and(Value::is_boolean) {
            violations.push(format!(
                "serving_page_build_detail_field_missing_or_invalid: field={field}"
            ));
        }
    }

    if detail
        .get(SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD)
        .is_some_and(|value| !value.is_string())
    {
        violations.push(format!(
            "serving_page_build_detail_field_missing_or_invalid: field={}",
            SERVING_STAGE_PAGE_UNDERFILL_REASON_FIELD
        ));
    }
    if !detail
        .get(SERVING_STAGE_SUPPRESSION_REASONS_FIELD)
        .is_some_and(Value::is_object)
    {
        violations.push(format!(
            "serving_page_build_detail_field_missing_or_invalid: field={}",
            SERVING_STAGE_SUPPRESSION_REASONS_FIELD
        ));
    }

    violations
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        SERVING_PAGE_BUILD_VERSION, SERVING_PAGE_BUILD_VERSION_FIELD, ServingPageBuildInput,
        ServingPageBuildSummary, serving_page_build_detail_contract_violations,
    };
    use crate::{
        SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD,
        SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD, SERVING_STAGE_HAS_MORE_FIELD,
        SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD, SERVING_STAGE_PAGE_UNDERFILLED_FIELD,
        SERVING_STAGE_REQUESTED_LIMIT_FIELD, SERVING_STAGE_SUPPRESSION_REASONS_FIELD,
    };

    #[test]
    fn exports_stable_page_build_contract() {
        assert_eq!(SERVING_PAGE_BUILD_VERSION, "serving_page_build_v1");
        assert_eq!(SERVING_PAGE_BUILD_VERSION_FIELD, "servingPageBuildVersion");
    }

    #[test]
    fn summarizes_page_build_counts_without_candidate_payloads() {
        let summary = ServingPageBuildSummary::from_input(ServingPageBuildInput {
            requested_limit: 10,
            output_count: 8,
            page_remaining_count: 2,
            duplicate_suppressed_count: 3,
            cross_page_duplicate_count: 1,
            has_more: true,
            page_underfilled: true,
            page_underfill_reason: Some("suppression_mixed".to_string()),
            suppression_reasons: [("content_duplicate".to_string(), 2)].into_iter().collect(),
        });

        assert_eq!(summary.removed_count(), 3);
        assert_eq!(summary.total_suppressed_count(), 4);
        assert_eq!(
            summary.suppression_reasons.get("content_duplicate"),
            Some(&2)
        );
    }

    #[test]
    fn validates_serving_page_build_detail_contract() {
        let detail = HashMap::from([
            (
                SERVING_PAGE_BUILD_VERSION_FIELD.to_string(),
                json!(SERVING_PAGE_BUILD_VERSION),
            ),
            (SERVING_STAGE_REQUESTED_LIMIT_FIELD.to_string(), json!(10)),
            (
                SERVING_STAGE_DUPLICATE_SUPPRESSED_COUNT_FIELD.to_string(),
                json!(2),
            ),
            (
                SERVING_STAGE_CROSS_PAGE_DUPLICATE_COUNT_FIELD.to_string(),
                json!(1),
            ),
            (
                SERVING_STAGE_PAGE_REMAINING_COUNT_FIELD.to_string(),
                json!(3),
            ),
            (SERVING_STAGE_HAS_MORE_FIELD.to_string(), json!(true)),
            (
                SERVING_STAGE_PAGE_UNDERFILLED_FIELD.to_string(),
                json!(false),
            ),
            (
                SERVING_STAGE_SUPPRESSION_REASONS_FIELD.to_string(),
                json!({ "author_soft_cap": 1 }),
            ),
        ]);

        assert!(serving_page_build_detail_contract_violations(Some(&detail)).is_empty());
    }
}
