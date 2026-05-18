use std::collections::HashSet;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::PREVIOUSLY_SEEN_POSTS_BACKUP_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_SEEN_POST;

use super::SEEN_POST_FILTER;
use super::TRUSTED_EMPTY_SELECTION_RECALL_SOURCES;
use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

/// Backup filter that runs after the primary `SeenPostFilter` to catch any
/// posts that slipped through due to bloom-filter false negatives.
///
/// This filter uses a simple HashSet lookup against the full `seen_ids` set
/// (which may have been populated from a second, more conservative bloom filter
/// or a direct storage lookup).  The redundancy ensures the user never sees a
/// post they have already scrolled past.
pub(super) fn previously_seen_posts_backup_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();

    // Only run when the primary seen filter is active and we have seen IDs.
    let seen_ids = query.effective_seen_ids();
    if query.in_network_only || seen_ids.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(PREVIOUSLY_SEEN_POSTS_BACKUP_FILTER, input_count),
            false,
        );
    }

    // The backup set may come from a separate source (e.g. a secondary bloom
    // filter with lower false-positive rate, or a direct key-value store).
    // For now we use the same seen_ids but with a strict exact-match check
    // (no related_post_ids expansion) as the safety net.
    let seen_set: HashSet<String> = seen_ids.into_iter().collect();

    let (kept, removed) = partition(candidates, |candidate| {
        // Trusted recall sources bypass the backup filter (same as primary SeenPostFilter)
        if let Some(ref source) = candidate.recall_source {
            if TRUSTED_EMPTY_SELECTION_RECALL_SOURCES.contains(&source.as_str()) {
                return true;
            }
        }
        // Primary check: exact post_id match
        if seen_set.contains(&candidate.post_id) {
            return false;
        }
        // Also check model_post_id if present
        if let Some(ref model_id) = candidate.model_post_id {
            if seen_set.contains(model_id) {
                return false;
            }
        }
        true
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            PREVIOUSLY_SEEN_POSTS_BACKUP_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_SEEN_POST),
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::collections::HashMap;

    use crate::contracts::{
        RecommendationCandidatePayload, RecommendationQueryPayload, UserFeaturesPayload,
        UserStateContextPayload,
    };

    fn candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: Some(format!("model-{post_id}")),
            author_id: "author-1".to_string(),
            content: "test content".to_string(),
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
            topic_ids: Vec::new(),
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
            media: None,
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
            is_subscription_only: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
        }
    }

    fn query_with_seen(seen_ids: Vec<String>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-seen-backup".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids,
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: Some(UserFeaturesPayload {
                ..Default::default()
            }),
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: "warm".to_string(),
                reason: "test".to_string(),
                followed_count: 1,
                recent_action_count: 2,
                recent_positive_action_count: 1,
                usable_embedding: true,
                account_age_days: Some(30),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: None,
            mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
        }
    }

    #[test]
    fn disables_when_no_seen_ids() {
        let query = query_with_seen(Vec::new());
        let candidates = vec![candidate("post-1")];
        let (kept, _removed, stage, enabled) =
            previously_seen_posts_backup_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(stage.removed_count, Some(0));
    }

    #[test]
    fn disables_for_in_network_only_requests() {
        let mut query = query_with_seen(vec!["seen-post".to_string()]);
        query.in_network_only = true;
        let candidates = vec![candidate("seen-post")];
        let (kept, _removed, stage, enabled) =
            previously_seen_posts_backup_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn drops_exact_post_id_matches() {
        let query = query_with_seen(vec!["post-a".to_string(), "post-b".to_string()]);
        let candidates = vec![
            candidate("post-a"),
            candidate("post-b"),
            candidate("post-c"),
        ];
        let (kept, removed, _stage, enabled) =
            previously_seen_posts_backup_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].post_id, "post-c");
        assert_eq!(removed.len(), 2);
    }

    #[test]
    fn drops_when_model_post_id_matches_seen() {
        let query = query_with_seen(vec!["model-post-x".to_string()]);
        let mut c = candidate("post-x");
        c.model_post_id = Some("model-post-x".to_string());
        let (kept, removed, _stage, enabled) = previously_seen_posts_backup_filter(&query, vec![c]);
        assert!(enabled);
        assert_eq!(kept.len(), 0);
        assert_eq!(removed.len(), 1);
    }

    #[test]
    fn keeps_unseen_candidates() {
        let query = query_with_seen(vec!["seen-1".to_string()]);
        let candidates = vec![candidate("unseen-1"), candidate("unseen-2")];
        let (kept, removed, stage, enabled) =
            previously_seen_posts_backup_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 2);
        assert_eq!(removed.len(), 0);
        assert_eq!(stage.removed_count, Some(0));
    }
}
