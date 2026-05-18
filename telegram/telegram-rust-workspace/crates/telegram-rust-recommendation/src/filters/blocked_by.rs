use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Filter that checks bidirectional blocking.
///
/// Removes candidates where:
/// - The viewer has blocked the author (existing check)
/// - The author has blocked the viewer (new check via `author_blocks_viewer` flag)
pub struct BlockedByFilter;

impl BlockedByFilter {
    pub fn name() -> &'static str {
        "BlockedByFilter"
    }

    pub fn should_keep(
        candidate: &RecommendationCandidatePayload,
        blocked_user_ids: &[String],
    ) -> bool {
        // Check if viewer blocked the author.
        if blocked_user_ids.contains(&candidate.author_id) {
            return false;
        }

        // Check if author blocked the viewer.
        if candidate.author_blocks_viewer.unwrap_or(false) {
            return false;
        }

        true
    }
}

/// Apply bidirectional blocking filter to a batch of candidates.
pub fn apply_blocked_by_filter(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let blocked_user_ids = query
        .user_features
        .as_ref()
        .map(|f| f.blocked_user_ids.clone())
        .unwrap_or_default();

    candidates
        .into_iter()
        .filter(|c| BlockedByFilter::should_keep(c, &blocked_user_ids))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(
        id: &str,
        author_id: &str,
        author_blocks_viewer: Option<bool>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: id.to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
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
            author_blocks_viewer,
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
            is_subscription_only: None,
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
    fn keeps_unblocked_candidate() {
        let candidate = make_candidate("p1", "author-1", None);
        let blocked = vec!["author-2".to_string()];
        assert!(BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_when_viewer_blocked_author() {
        let candidate = make_candidate("p1", "author-1", None);
        let blocked = vec!["author-1".to_string()];
        assert!(!BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_when_author_blocked_viewer() {
        let candidate = make_candidate("p1", "author-1", Some(true));
        let blocked: Vec<String> = vec![];
        assert!(!BlockedByFilter::should_keep(&candidate, &blocked));
    }

    #[test]
    fn filters_when_both_blocked() {
        let candidate = make_candidate("p1", "author-1", Some(true));
        let blocked = vec!["author-1".to_string()];
        assert!(!BlockedByFilter::should_keep(&candidate, &blocked));
    }
}
