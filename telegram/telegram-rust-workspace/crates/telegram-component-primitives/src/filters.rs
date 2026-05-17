use crate::to_component_names;

pub const DUPLICATE_FILTER: &str = "DuplicateFilter";
pub const NEWS_EXTERNAL_ID_DEDUP_FILTER: &str = "NewsExternalIdDedupFilter";
pub const SELF_POST_FILTER: &str = "SelfPostFilter";
pub const RETWEET_DEDUP_FILTER: &str = "RetweetDedupFilter";
pub const AGE_FILTER: &str = "AgeFilter";
pub const QUALITY_GUARD_FILTER: &str = "QualityGuardFilter";
pub const BLOCKED_USER_FILTER: &str = "BlockedUserFilter";
pub const AUTHOR_SOCIALGRAPH_FILTER: &str = "AuthorSocialgraphFilter";
pub const MUTED_KEYWORD_FILTER: &str = "MutedKeywordFilter";
pub const SEEN_POST_FILTER: &str = "SeenPostFilter";
pub const PREVIOUSLY_SERVED_FILTER: &str = "PreviouslyServedFilter";
pub const VF_FILTER: &str = "VFFilter";
pub const CONVERSATION_DEDUP_FILTER: &str = "ConversationDedupFilter";
pub const TOPIC_FILTER: &str = "TopicFilter";
pub const VIDEO_FILTER: &str = "VideoFilter";
pub const SUBSCRIPTION_FILTER: &str = "SubscriptionFilter";

pub const FILTER_NAMES: &[&str] = &[
    DUPLICATE_FILTER,
    NEWS_EXTERNAL_ID_DEDUP_FILTER,
    SELF_POST_FILTER,
    RETWEET_DEDUP_FILTER,
    AGE_FILTER,
    QUALITY_GUARD_FILTER,
    BLOCKED_USER_FILTER,
    MUTED_KEYWORD_FILTER,
    SEEN_POST_FILTER,
    PREVIOUSLY_SERVED_FILTER,
    TOPIC_FILTER,
    VIDEO_FILTER,
    SUBSCRIPTION_FILTER,
];

pub const POST_SELECTION_FILTER_NAMES: &[&str] = &[VF_FILTER, CONVERSATION_DEDUP_FILTER];

pub fn configured_filters() -> Vec<String> {
    to_component_names(FILTER_NAMES)
}

pub fn configured_post_selection_filters() -> Vec<String> {
    to_component_names(POST_SELECTION_FILTER_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{
        DUPLICATE_FILTER, FILTER_NAMES, POST_SELECTION_FILTER_NAMES, VF_FILTER, configured_filters,
    };

    #[test]
    fn exports_stable_filter_order() {
        assert_eq!(FILTER_NAMES[0], DUPLICATE_FILTER);
        assert_eq!(configured_filters().len(), 13);
        assert_eq!(POST_SELECTION_FILTER_NAMES[0], VF_FILTER);
    }
}
