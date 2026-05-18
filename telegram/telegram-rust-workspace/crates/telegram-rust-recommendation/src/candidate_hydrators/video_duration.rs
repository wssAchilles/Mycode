use crate::contracts::RecommendationCandidatePayload;

/// Hydrator that extracts video duration from candidate metadata.
///
/// Reads the `video_duration_sec` field and makes it available for
/// video preference sorting and duration-based decay.
pub struct VideoDurationHydrator;

impl VideoDurationHydrator {
    pub fn name() -> &'static str {
        "VideoDurationCandidateHydrator"
    }

    pub fn hydrate(candidate: &mut RecommendationCandidatePayload) {
        if let Some(duration) = candidate.video_duration_sec {
            // Ensure non-negative duration.
            candidate.video_duration_sec = Some(duration.max(0.0));
        }
    }
}

/// Get video duration in seconds, or None if not a video.
pub fn get_video_duration_sec(candidate: &RecommendationCandidatePayload) -> Option<f64> {
    if candidate.has_video.unwrap_or(false) {
        candidate.video_duration_sec
    } else {
        None
    }
}

/// Get video duration in milliseconds.
pub fn get_video_duration_ms(candidate: &RecommendationCandidatePayload) -> Option<i64> {
    get_video_duration_sec(candidate).map(|sec| (sec * 1000.0) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(
        id: &str,
        has_video: Option<bool>,
        video_duration_sec: Option<f64>,
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
            has_image: None,
            video_duration_sec,
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

    #[test]
    fn returns_duration_for_video() {
        let candidate = make_candidate("p1", Some(true), Some(120.0));
        assert_eq!(get_video_duration_sec(&candidate), Some(120.0));
        assert_eq!(get_video_duration_ms(&candidate), Some(120000));
    }

    #[test]
    fn returns_none_for_non_video() {
        let candidate = make_candidate("p1", Some(false), Some(120.0));
        assert_eq!(get_video_duration_sec(&candidate), None);
        assert_eq!(get_video_duration_ms(&candidate), None);
    }

    #[test]
    fn returns_none_when_duration_missing() {
        let candidate = make_candidate("p1", Some(true), None);
        assert_eq!(get_video_duration_sec(&candidate), None);
    }

    #[test]
    fn normalizes_negative_duration() {
        let mut candidate = make_candidate("p1", Some(true), Some(-10.0));
        VideoDurationHydrator::hydrate(&mut candidate);
        assert_eq!(candidate.video_duration_sec, Some(0.0));
    }
}
