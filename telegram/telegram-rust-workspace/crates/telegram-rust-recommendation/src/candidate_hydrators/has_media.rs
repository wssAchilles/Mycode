use crate::contracts::{MediaType, RecommendationCandidatePayload};

/// Hydrator that marks candidates with media information.
///
/// Sets `has_media` and `media_type` fields based on existing media flags.
pub struct HasMediaHydrator;

impl HasMediaHydrator {
    pub fn name() -> &'static str {
        "HasMediaCandidateHydrator"
    }

    pub fn hydrate(candidate: &mut RecommendationCandidatePayload) {
        candidate.has_media = has_media(candidate);
        candidate.media_type = get_media_type(candidate);
    }
}

/// Check if a candidate has any media content.
pub fn has_media(candidate: &RecommendationCandidatePayload) -> bool {
    candidate.has_video.unwrap_or(false) || candidate.has_image.unwrap_or(false)
}

/// Get the media type of a candidate.
pub fn get_media_type(candidate: &RecommendationCandidatePayload) -> MediaType {
    let has_video = candidate.has_video.unwrap_or(false);
    let has_image = candidate.has_image.unwrap_or(false);

    match (has_video, has_image) {
        (true, true) => MediaType::Mixed,
        (true, false) => MediaType::Video,
        (false, true) => MediaType::Photo,
        (false, false) => MediaType::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(
        id: &str,
        has_video: Option<bool>,
        has_image: Option<bool>,
    ) -> RecommendationCandidatePayload {
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
            topic_ids: Vec::new(),
            secondary_recall_sources: None,
            has_video,
            has_image,
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
    fn media_type_none_for_text_only() {
        let candidate = make_candidate("p1", Some(false), Some(false));
        assert_eq!(get_media_type(&candidate), MediaType::None);
        assert!(!has_media(&candidate));
    }

    #[test]
    fn media_type_photo_for_image() {
        let candidate = make_candidate("p1", Some(false), Some(true));
        assert_eq!(get_media_type(&candidate), MediaType::Photo);
        assert!(has_media(&candidate));
    }

    #[test]
    fn media_type_video_for_video() {
        let candidate = make_candidate("p1", Some(true), Some(false));
        assert_eq!(get_media_type(&candidate), MediaType::Video);
        assert!(has_media(&candidate));
    }

    #[test]
    fn media_type_mixed_for_both() {
        let candidate = make_candidate("p1", Some(true), Some(true));
        assert_eq!(get_media_type(&candidate), MediaType::Mixed);
        assert!(has_media(&candidate));
    }

    #[test]
    fn media_type_none_when_unknown() {
        let candidate = make_candidate("p1", None, None);
        assert_eq!(get_media_type(&candidate), MediaType::None);
        assert!(!has_media(&candidate));
    }
}
