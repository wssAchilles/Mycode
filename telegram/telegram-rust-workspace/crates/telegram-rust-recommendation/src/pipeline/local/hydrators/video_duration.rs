use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;

use super::RecommendationStagePayload;

const HYDRATOR_NAME: &str = "VideoDurationCandidateHydrator";

/// Annotates each candidate with `video_duration_ms` derived from the
/// existing `video_duration_sec` field.
///
/// The millisecond representation enables finer-grained duration decay
/// scoring and video preference ranking without floating-point precision
/// loss in the downstream scorers.
pub fn video_duration_hydrator(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (Vec<RecommendationCandidatePayload>, RecommendationStagePayload) {
    let input_count = candidates.len();

    let hydrated: Vec<RecommendationCandidatePayload> = candidates
        .into_iter()
        .map(|mut candidate| {
            // Only set video_duration_ms if not already populated.
            if candidate.video_duration_ms.is_none() {
                candidate.video_duration_ms = candidate
                    .video_duration_sec
                    .map(|sec| (sec * 1000.0).round() as i64);
            }
            candidate
        })
        .collect();

    let output_count = hydrated.len();
    let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, output_count, None);
    (hydrated, stage)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use chrono::Utc;

    fn base_candidate() -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "test".to_string(),
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

    fn base_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-video-duration".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
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
    fn converts_seconds_to_milliseconds() {
        let mut candidate = base_candidate();
        candidate.video_duration_sec = Some(30.5);

        let (candidates, stage) = video_duration_hydrator(&base_query(), vec![candidate]);
        assert_eq!(stage.name, HYDRATOR_NAME);
        assert_eq!(candidates[0].video_duration_ms, Some(30500));
    }

    #[test]
    fn preserves_existing_milliseconds() {
        let mut candidate = base_candidate();
        candidate.video_duration_sec = Some(30.0);
        candidate.video_duration_ms = Some(42000);

        let (candidates, _) = video_duration_hydrator(&base_query(), vec![candidate]);
        assert_eq!(candidates[0].video_duration_ms, Some(42000));
    }

    #[test]
    fn leaves_none_when_no_duration() {
        let candidate = base_candidate();

        let (candidates, _) = video_duration_hydrator(&base_query(), vec![candidate]);
        assert!(candidates[0].video_duration_ms.is_none());
    }

    #[test]
    fn handles_zero_duration() {
        let mut candidate = base_candidate();
        candidate.video_duration_sec = Some(0.0);

        let (candidates, _) = video_duration_hydrator(&base_query(), vec![candidate]);
        assert_eq!(candidates[0].video_duration_ms, Some(0));
    }

    #[test]
    fn rounds_correctly() {
        let mut candidate = base_candidate();
        candidate.video_duration_sec = Some(12.345);

        let (candidates, _) = video_duration_hydrator(&base_query(), vec![candidate]);
        assert_eq!(candidates[0].video_duration_ms, Some(12345));
    }
}
