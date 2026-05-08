use std::collections::HashMap;

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

#[cfg(test)]
mod tests {
    use super::{
        SERVING_PAGE_BUILD_VERSION, SERVING_PAGE_BUILD_VERSION_FIELD, ServingPageBuildInput,
        ServingPageBuildSummary,
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
}
