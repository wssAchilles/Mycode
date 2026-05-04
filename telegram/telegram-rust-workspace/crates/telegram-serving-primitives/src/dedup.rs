pub const SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP: &str = "author_soft_cap";
pub const SERVING_DEDUP_REASON_CONTENT_DUPLICATE: &str = "content_duplicate";
pub const SERVING_DEDUP_REASON_CONVERSATION_DUPLICATE: &str = "conversation_duplicate";
pub const SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT: &str = "near_duplicate_content";
pub const SERVING_DEDUP_REASON_SERVED_STATE_DUPLICATE: &str = "served_state_duplicate";
pub const SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP: &str = "cross_page_author_soft_cap";
pub const SERVING_DEDUP_REASON_CROSS_PAGE_SOURCE_SOFT_CAP: &str = "cross_page_source_soft_cap";
pub const SERVING_DEDUP_REASON_CROSS_PAGE_TOPIC_SOFT_CAP: &str = "cross_page_topic_soft_cap";

pub const PAGE_UNDERFILL_REASON_CROSS_PAGE_SUPPRESSED: &str = "cross_page_suppressed";
pub const PAGE_UNDERFILL_REASON_CROSS_PAGE_SOFT_CAP: &str = "cross_page_soft_cap";
pub const PAGE_UNDERFILL_REASON_SUPPRESSION_MIXED: &str = "suppression_mixed";
pub const PAGE_UNDERFILL_REASON_SUPPLY_EXHAUSTED: &str = "supply_exhausted";

#[cfg(test)]
mod tests {
    use super::{
        PAGE_UNDERFILL_REASON_CROSS_PAGE_SOFT_CAP, SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP,
        SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP,
        SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT, SERVING_DEDUP_REASON_SERVED_STATE_DUPLICATE,
    };

    #[test]
    fn exports_stable_serving_dedup_reason_contract() {
        assert_eq!(SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP, "author_soft_cap");
        assert_eq!(
            SERVING_DEDUP_REASON_SERVED_STATE_DUPLICATE,
            "served_state_duplicate"
        );
        assert_eq!(
            SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT,
            "near_duplicate_content"
        );
        assert_eq!(
            SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP,
            "cross_page_author_soft_cap"
        );
        assert_eq!(
            PAGE_UNDERFILL_REASON_CROSS_PAGE_SOFT_CAP,
            "cross_page_soft_cap"
        );
    }
}
