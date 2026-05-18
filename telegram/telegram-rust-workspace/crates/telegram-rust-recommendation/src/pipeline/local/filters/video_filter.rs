use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::VIDEO_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_VIDEO_FILTERED;

use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

pub(super) fn video_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let preference = query
        .user_features
        .as_ref()
        .map(|f| f.video_preference.as_str())
        .unwrap_or("allow");

    if preference == "allow" {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(VIDEO_FILTER, input_count),
            false,
        );
    }

    let (kept, removed) = partition(candidates, |candidate| {
        let has_video = candidate.has_video.unwrap_or(false)
            || candidate
                .media
                .as_ref()
                .is_some_and(|items| items.iter().any(|m| m.type_ == "video"));
        match preference {
            "block" => !has_video,
            "only" => has_video,
            _ => true,
        }
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            VIDEO_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_VIDEO_FILTERED),
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use chrono::Utc;

    fn candidate_with_video(has_video: Option<bool>) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
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
            has_video,
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

    fn query_with_preference(video_preference: &str) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-video-filter".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: Some(crate::contracts::UserFeaturesPayload {
                video_preference: video_preference.to_string(),
                ..Default::default()
            }),
            embedding_context: None,
            user_state_context: None,
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
    fn video_filter_disables_when_preference_is_allow() {
        let query = query_with_preference("allow");
        let candidates = vec![candidate_with_video(Some(true))];
        let (kept, _removed, stage, enabled) = video_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(stage.removed_count, Some(0));
    }

    #[test]
    fn video_filter_blocks_video_candidates() {
        let query = query_with_preference("block");
        let candidates = vec![
            candidate_with_video(Some(true)),
            candidate_with_video(Some(false)),
            candidate_with_video(None),
        ];
        let (kept, removed, _stage, enabled) = video_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 2);
        assert_eq!(removed.len(), 1);
    }

    #[test]
    fn video_filter_only_keeps_video_candidates() {
        let query = query_with_preference("only");
        let candidates = vec![
            candidate_with_video(Some(true)),
            candidate_with_video(Some(false)),
            candidate_with_video(None),
        ];
        let (kept, removed, _stage, enabled) = video_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 2);
    }
}
