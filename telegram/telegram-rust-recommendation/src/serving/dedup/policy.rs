use super::soft_caps::{
    CROSS_PAGE_AUTHOR_SOFT_CAP_REASON, CROSS_PAGE_SOURCE_SOFT_CAP_REASON,
    CROSS_PAGE_TOPIC_SOFT_CAP_REASON,
};
use super::{
    AUTHOR_SOFT_CAP_REASON, CONTENT_DUPLICATE_REASON, CONVERSATION_DUPLICATE_REASON,
    NEAR_DUPLICATE_CONTENT_REASON, SERVED_STATE_REASON,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DedupStep {
    pub(super) reason: &'static str,
    pub(super) priority: u8,
    pub(super) relaxable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DedupPolicy {
    pub(super) hard_duplicate: DedupStep,
    pub(super) served_state: DedupStep,
    pub(super) conversation: DedupStep,
    pub(super) semantic_near_duplicate: DedupStep,
    pub(super) cross_page_cap: DedupStep,
    pub(super) author_cap: DedupStep,
}

pub(super) const SERVING_DEDUP_POLICY: DedupPolicy = DedupPolicy {
    hard_duplicate: DedupStep {
        reason: CONTENT_DUPLICATE_REASON,
        priority: 10,
        relaxable: false,
    },
    served_state: DedupStep {
        reason: SERVED_STATE_REASON,
        priority: 20,
        relaxable: false,
    },
    conversation: DedupStep {
        reason: CONVERSATION_DUPLICATE_REASON,
        priority: 30,
        relaxable: false,
    },
    semantic_near_duplicate: DedupStep {
        reason: NEAR_DUPLICATE_CONTENT_REASON,
        priority: 40,
        relaxable: true,
    },
    cross_page_cap: DedupStep {
        reason: "cross_page_soft_cap",
        priority: 50,
        relaxable: true,
    },
    author_cap: DedupStep {
        reason: AUTHOR_SOFT_CAP_REASON,
        priority: 60,
        relaxable: true,
    },
};

pub(super) fn dedup_reason_priority(reason: &str) -> u8 {
    match reason {
        CONTENT_DUPLICATE_REASON => SERVING_DEDUP_POLICY.hard_duplicate.priority,
        SERVED_STATE_REASON => SERVING_DEDUP_POLICY.served_state.priority,
        CONVERSATION_DUPLICATE_REASON => SERVING_DEDUP_POLICY.conversation.priority,
        NEAR_DUPLICATE_CONTENT_REASON => SERVING_DEDUP_POLICY.semantic_near_duplicate.priority,
        CROSS_PAGE_AUTHOR_SOFT_CAP_REASON
        | CROSS_PAGE_SOURCE_SOFT_CAP_REASON
        | CROSS_PAGE_TOPIC_SOFT_CAP_REASON => SERVING_DEDUP_POLICY.cross_page_cap.priority,
        AUTHOR_SOFT_CAP_REASON => SERVING_DEDUP_POLICY.author_cap.priority,
        _ => u8::MAX,
    }
}
