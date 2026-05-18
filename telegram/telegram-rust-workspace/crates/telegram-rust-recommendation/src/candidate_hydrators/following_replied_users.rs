use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Hydrator that checks whether any of the user's followees have replied
/// to this candidate's conversation thread.
///
/// A `following_replied = true` signal boosts social relevance, indicating
/// that people the viewer follows found this post worth engaging with.
///
/// In production this requires a reply-graph lookup. The stub uses
/// `reply_to_post_id` presence as a proxy — if the candidate is a reply
/// and the viewer follows the parent author, we mark it true.
pub struct FollowingRepliedUsersHydrator;

impl FollowingRepliedUsersHydrator {
    pub fn name() -> &'static str {
        "FollowingRepliedUsersCandidateHydrator"
    }

    /// Check if any followed user participated in the conversation.
    ///
    /// Stub: marks `following_replied = true` when the candidate is a reply
    /// and the viewer has a non-empty follow list (proxy for social engagement).
    pub fn hydrate(
        query: &RecommendationQueryPayload,
        candidate: &mut RecommendationCandidatePayload,
    ) {
        if candidate.following_replied.is_some() {
            return;
        }

        if !candidate.is_reply {
            candidate.following_replied = Some(false);
            return;
        }

        // Proxy: if the viewer follows anyone and the post is a reply,
        // assume some followed user may have participated.
        let has_followees = query
            .user_features
            .as_ref()
            .map(|f| !f.followed_user_ids.is_empty())
            .unwrap_or(false);

        candidate.following_replied = Some(has_followees && candidate.reply_to_post_id.is_some());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    use crate::contracts::UserFeaturesPayload;

    fn make_query(followed: Vec<String>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-following-replied".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            user_features: Some(UserFeaturesPayload {
                followed_user_ids: followed,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn make_candidate(is_reply: bool, reply_to: Option<&str>) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "p1".to_string(),
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: Utc::now(),
            is_reply,
            reply_to_post_id: reply_to.map(ToOwned::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn marks_reply_with_followees() {
        let query = make_query(vec!["author-a".to_string()]);
        let mut c = make_candidate(true, Some("parent-post"));
        FollowingRepliedUsersHydrator::hydrate(&query, &mut c);
        assert_eq!(c.following_replied, Some(true));
    }

    #[test]
    fn marks_non_reply_as_false() {
        let query = make_query(vec!["author-a".to_string()]);
        let mut c = make_candidate(false, None);
        FollowingRepliedUsersHydrator::hydrate(&query, &mut c);
        assert_eq!(c.following_replied, Some(false));
    }

    #[test]
    fn marks_reply_without_followees_as_false() {
        let query = make_query(Vec::new());
        let mut c = make_candidate(true, Some("parent-post"));
        FollowingRepliedUsersHydrator::hydrate(&query, &mut c);
        assert_eq!(c.following_replied, Some(false));
    }

    #[test]
    fn preserves_existing_value() {
        let query = make_query(vec!["author-a".to_string()]);
        let mut c = make_candidate(true, Some("parent-post"));
        c.following_replied = Some(false);
        FollowingRepliedUsersHydrator::hydrate(&query, &mut c);
        assert_eq!(c.following_replied, Some(false));
    }
}
