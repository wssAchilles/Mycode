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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DedupStep {
    pub reason: &'static str,
    pub priority: u8,
    pub relaxable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DedupPolicy {
    pub hard_duplicate: DedupStep,
    pub served_state: DedupStep,
    pub conversation: DedupStep,
    pub semantic_near_duplicate: DedupStep,
    pub cross_page_cap: DedupStep,
    pub author_cap: DedupStep,
}

pub const SERVING_DEDUP_POLICY: DedupPolicy = DedupPolicy {
    hard_duplicate: DedupStep {
        reason: SERVING_DEDUP_REASON_CONTENT_DUPLICATE,
        priority: 10,
        relaxable: false,
    },
    served_state: DedupStep {
        reason: SERVING_DEDUP_REASON_SERVED_STATE_DUPLICATE,
        priority: 20,
        relaxable: false,
    },
    conversation: DedupStep {
        reason: SERVING_DEDUP_REASON_CONVERSATION_DUPLICATE,
        priority: 30,
        relaxable: false,
    },
    semantic_near_duplicate: DedupStep {
        reason: SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT,
        priority: 40,
        relaxable: true,
    },
    cross_page_cap: DedupStep {
        reason: PAGE_UNDERFILL_REASON_CROSS_PAGE_SOFT_CAP,
        priority: 50,
        relaxable: true,
    },
    author_cap: DedupStep {
        reason: SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP,
        priority: 60,
        relaxable: true,
    },
};

pub fn dedup_reason_priority(reason: &str) -> u8 {
    match reason {
        SERVING_DEDUP_REASON_CONTENT_DUPLICATE => SERVING_DEDUP_POLICY.hard_duplicate.priority,
        SERVING_DEDUP_REASON_SERVED_STATE_DUPLICATE => SERVING_DEDUP_POLICY.served_state.priority,
        SERVING_DEDUP_REASON_CONVERSATION_DUPLICATE => SERVING_DEDUP_POLICY.conversation.priority,
        SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT => {
            SERVING_DEDUP_POLICY.semantic_near_duplicate.priority
        }
        SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP
        | SERVING_DEDUP_REASON_CROSS_PAGE_SOURCE_SOFT_CAP
        | SERVING_DEDUP_REASON_CROSS_PAGE_TOPIC_SOFT_CAP => {
            SERVING_DEDUP_POLICY.cross_page_cap.priority
        }
        SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP => SERVING_DEDUP_POLICY.author_cap.priority,
        _ => u8::MAX,
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PageUnderfillInput {
    pub cross_page_duplicate_count: usize,
    pub duplicate_suppressed_count: usize,
    pub cross_request_suppressed: usize,
    pub near_duplicate_suppressed: usize,
    pub author_soft_cap_suppressed: usize,
}

pub fn page_underfill_reason(input: PageUnderfillInput) -> &'static str {
    if input.cross_page_duplicate_count > 0 && input.author_soft_cap_suppressed == 0 {
        PAGE_UNDERFILL_REASON_CROSS_PAGE_SUPPRESSED
    } else if input.cross_request_suppressed > 0 && input.author_soft_cap_suppressed == 0 {
        PAGE_UNDERFILL_REASON_CROSS_PAGE_SOFT_CAP
    } else if input.author_soft_cap_suppressed > 0
        && input.duplicate_suppressed_count == input.author_soft_cap_suppressed
    {
        SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP
    } else if input.near_duplicate_suppressed > 0
        && input.duplicate_suppressed_count == input.near_duplicate_suppressed
    {
        SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT
    } else if input.duplicate_suppressed_count > 0 {
        PAGE_UNDERFILL_REASON_SUPPRESSION_MIXED
    } else {
        PAGE_UNDERFILL_REASON_SUPPLY_EXHAUSTED
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PAGE_UNDERFILL_REASON_CROSS_PAGE_SOFT_CAP, PAGE_UNDERFILL_REASON_SUPPLY_EXHAUSTED,
        PageUnderfillInput, SERVING_DEDUP_POLICY, SERVING_DEDUP_REASON_AUTHOR_SOFT_CAP,
        SERVING_DEDUP_REASON_CROSS_PAGE_AUTHOR_SOFT_CAP,
        SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT, SERVING_DEDUP_REASON_SERVED_STATE_DUPLICATE,
        dedup_reason_priority, page_underfill_reason,
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

    #[test]
    fn exposes_dedup_policy_priorities_and_underfill_reasoning() {
        assert_eq!(SERVING_DEDUP_POLICY.hard_duplicate.priority, 10);
        assert_eq!(
            dedup_reason_priority(SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT),
            40
        );
        assert_eq!(
            page_underfill_reason(PageUnderfillInput {
                duplicate_suppressed_count: 1,
                near_duplicate_suppressed: 1,
                ..PageUnderfillInput::default()
            }),
            SERVING_DEDUP_REASON_NEAR_DUPLICATE_CONTENT
        );
        assert_eq!(
            page_underfill_reason(PageUnderfillInput::default()),
            PAGE_UNDERFILL_REASON_SUPPLY_EXHAUSTED
        );
    }
}
