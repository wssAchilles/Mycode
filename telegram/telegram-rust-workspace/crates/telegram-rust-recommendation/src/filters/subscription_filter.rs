use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Filter that removes subscription-only content for non-subscribers.
///
/// If the user is not a subscriber, candidates marked as `is_subscription_only`
/// will be filtered out.
pub struct SubscriptionFilter;

impl SubscriptionFilter {
    pub fn name() -> &'static str {
        "SubscriptionFilter"
    }

    pub fn should_keep(
        candidate: &RecommendationCandidatePayload,
        is_subscriber: bool,
    ) -> bool {
        if is_subscriber {
            return true;
        }

        !candidate.is_subscription_only.unwrap_or(false)
    }
}

/// Apply subscription filter to a batch of candidates.
pub fn apply_subscription_filter(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let is_subscriber = query
        .user_features
        .as_ref()
        .map(|f| f.is_subscriber)
        .unwrap_or(false);

    if is_subscriber {
        return candidates;
    }

    candidates
        .into_iter()
        .filter(|c| SubscriptionFilter::should_keep(c, is_subscriber))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(id: &str, is_subscription_only: Option<bool>) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
            media: None,
            topic_ids: Vec::new(),
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            author_blocks_viewer: None,
            language_code: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            is_subscription_only,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
            pipeline_score: None,
            score_breakdown: None,
        }
    }

    #[test]
    fn subscriber_sees_all_content() {
        let sub_only = make_candidate("p1", Some(true));
        let free = make_candidate("p2", Some(false));
        let unknown = make_candidate("p3", None);

        assert!(SubscriptionFilter::should_keep(&sub_only, true));
        assert!(SubscriptionFilter::should_keep(&free, true));
        assert!(SubscriptionFilter::should_keep(&unknown, true));
    }

    #[test]
    fn non_subscriber_blocked_from_subscription_content() {
        let sub_only = make_candidate("p1", Some(true));
        let free = make_candidate("p2", Some(false));
        let unknown = make_candidate("p3", None);

        assert!(!SubscriptionFilter::should_keep(&sub_only, false));
        assert!(SubscriptionFilter::should_keep(&free, false));
        assert!(SubscriptionFilter::should_keep(&unknown, false));
    }
}
