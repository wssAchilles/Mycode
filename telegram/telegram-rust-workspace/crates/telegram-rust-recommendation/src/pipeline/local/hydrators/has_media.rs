use crate::contracts::{
    CandidateMediaPayload, MediaType, RecommendationCandidatePayload, RecommendationQueryPayload,
};
use crate::pipeline::local::hydrators::build_hydrator_stage;

use super::RecommendationStagePayload;

const HYDRATOR_NAME: &str = "HasMediaCandidateHydrator";

/// Annotates each candidate with `has_media` and `media_type` fields
/// derived from its `media` array.
///
/// These fields are used downstream by `MediaRichFactor` and
/// `MediaClusterDiversityFactor` scorers to reward media-rich content
/// and diversify media types in the final feed.
pub fn has_media_hydrator(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (Vec<RecommendationCandidatePayload>, RecommendationStagePayload) {
    let input_count = candidates.len();

    let hydrated: Vec<RecommendationCandidatePayload> = candidates
        .into_iter()
        .map(|mut candidate| {
            let (has_media, media_type) = classify_media(&candidate);
            candidate.has_media = has_media;
            candidate.media_type = media_type;
            candidate
        })
        .collect();

    let output_count = hydrated.len();
    let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, output_count, None);
    (hydrated, stage)
}

/// Determines `has_media` and `media_type` from the candidate's media
/// array and existing boolean flags.
fn classify_media(candidate: &RecommendationCandidatePayload) -> (bool, MediaType) {
    // If the candidate has an explicit media array, classify from it.
    if let Some(media) = candidate.media.as_ref() {
        if media.is_empty() {
            return (false, MediaType::None);
        }

        let mut has_photo = false;
        let mut has_video = false;
        let mut has_gif = false;

        for item in media {
            match classify_media_item(item) {
                MediaType::Photo => has_photo = true,
                MediaType::Video => has_video = true,
                MediaType::Gif => has_gif = true,
                MediaType::Mixed | MediaType::None => {}
            }
        }

        let media_type = match (has_photo, has_video, has_gif) {
            (true, false, false) => MediaType::Photo,
            (false, true, false) => MediaType::Video,
            (false, false, true) => MediaType::Gif,
            (false, false, false) => MediaType::None,
            _ => MediaType::Mixed,
        };

        return (media_type != MediaType::None, media_type);
    }

    // Fallback: use existing boolean flags when no media array is present.
    let has_video = candidate.has_video.unwrap_or(false);
    let has_image = candidate.has_image.unwrap_or(false);

    match (has_image, has_video) {
        (true, true) => (true, MediaType::Mixed),
        (true, false) => (true, MediaType::Photo),
        (false, true) => (true, MediaType::Video),
        (false, false) => (false, MediaType::None),
    }
}

fn classify_media_item(item: &CandidateMediaPayload) -> MediaType {
    match item.type_.to_lowercase().as_str() {
        "video" | "mp4" | "mov" | "webm" => MediaType::Video,
        "gif" => MediaType::Gif,
        "photo" | "image" | "png" | "jpg" | "jpeg" | "webp" => MediaType::Photo,
        _ => MediaType::Photo, // Default to Photo for unknown types
    }
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
            media_type: MediaType::None,
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

    #[test]
    fn classifies_photo_from_media_array() {
        let mut candidate = base_candidate();
        candidate.media = Some(vec![CandidateMediaPayload {
            type_: "image".to_string(),
            url: "https://example.com/photo.jpg".to_string(),
            thumbnail_url: None,
        }]);

        let query = RecommendationQueryPayload {
            request_id: "req-test".to_string(),
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
        };

        let (candidates, stage) = has_media_hydrator(&query, vec![candidate]);
        assert_eq!(stage.name, HYDRATOR_NAME);
        assert!(candidates[0].has_media);
        assert_eq!(candidates[0].media_type, MediaType::Photo);
    }

    #[test]
    fn classifies_video_from_media_array() {
        let mut candidate = base_candidate();
        candidate.media = Some(vec![CandidateMediaPayload {
            type_: "video".to_string(),
            url: "https://example.com/video.mp4".to_string(),
            thumbnail_url: None,
        }]);

        let query = RecommendationQueryPayload {
            request_id: "req-test".to_string(),
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
        };

        let (candidates, _) = has_media_hydrator(&query, vec![candidate]);
        assert!(candidates[0].has_media);
        assert_eq!(candidates[0].media_type, MediaType::Video);
    }

    #[test]
    fn classifies_mixed_when_multiple_types() {
        let mut candidate = base_candidate();
        candidate.media = Some(vec![
            CandidateMediaPayload {
                type_: "image".to_string(),
                url: "https://example.com/photo.jpg".to_string(),
                thumbnail_url: None,
            },
            CandidateMediaPayload {
                type_: "video".to_string(),
                url: "https://example.com/video.mp4".to_string(),
                thumbnail_url: None,
            },
        ]);

        let query = RecommendationQueryPayload {
            request_id: "req-test".to_string(),
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
        };

        let (candidates, _) = has_media_hydrator(&query, vec![candidate]);
        assert!(candidates[0].has_media);
        assert_eq!(candidates[0].media_type, MediaType::Mixed);
    }

    #[test]
    fn falls_back_to_boolean_flags_when_no_media_array() {
        let mut candidate = base_candidate();
        candidate.has_video = Some(true);
        candidate.has_image = Some(false);

        let query = RecommendationQueryPayload {
            request_id: "req-test".to_string(),
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
        };

        let (candidates, _) = has_media_hydrator(&query, vec![candidate]);
        assert!(candidates[0].has_media);
        assert_eq!(candidates[0].media_type, MediaType::Video);
    }

    #[test]
    fn marks_no_media_when_empty() {
        let candidate = base_candidate();

        let query = RecommendationQueryPayload {
            request_id: "req-test".to_string(),
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
        };

        let (candidates, _) = has_media_hydrator(&query, vec![candidate]);
        assert!(!candidates[0].has_media);
        assert_eq!(candidates[0].media_type, MediaType::None);
    }
}
