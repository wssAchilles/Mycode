use serde::{Deserialize, Serialize};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Video preference mode for filtering candidates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoPreference {
    /// Allow all candidates regardless of video content.
    Allow,
    /// Block candidates that contain video.
    Block,
    /// Only allow candidates that contain video.
    Only,
}

impl Default for VideoPreference {
    fn default() -> Self {
        Self::Allow
    }
}

impl VideoPreference {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "block" => Self::Block,
            "only" => Self::Only,
            _ => Self::Allow,
        }
    }
}

/// Filter that applies video preference rules.
///
/// - `Allow`: no filtering (default)
/// - `Block`: remove candidates with video content
/// - `Only`: keep only candidates with video content
pub struct VideoFilter;

impl VideoFilter {
    pub fn name() -> &'static str {
        "VideoFilter"
    }

    pub fn should_keep(
        candidate: &RecommendationCandidatePayload,
        preference: VideoPreference,
    ) -> bool {
        let has_video = candidate.has_video.unwrap_or(false);

        match preference {
            VideoPreference::Allow => true,
            VideoPreference::Block => !has_video,
            VideoPreference::Only => has_video,
        }
    }
}

/// Apply video filter to a batch of candidates.
pub fn apply_video_filter(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let preference = query
        .user_features
        .as_ref()
        .map(|f| VideoPreference::from_str(&f.video_preference))
        .unwrap_or_default();

    if preference == VideoPreference::Allow {
        return candidates;
    }

    candidates
        .into_iter()
        .filter(|c| VideoFilter::should_keep(c, preference))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_candidate(id: &str, has_video: Option<bool>) -> RecommendationCandidatePayload {
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
            has_video,
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
    fn allow_keeps_all_candidates() {
        let candidate = make_candidate("p1", Some(true));
        assert!(VideoFilter::should_keep(&candidate, VideoPreference::Allow));
    }

    #[test]
    fn block_removes_video_candidates() {
        let video = make_candidate("p1", Some(true));
        let text = make_candidate("p2", Some(false));
        let unknown = make_candidate("p3", None);

        assert!(!VideoFilter::should_keep(&video, VideoPreference::Block));
        assert!(VideoFilter::should_keep(&text, VideoPreference::Block));
        assert!(VideoFilter::should_keep(&unknown, VideoPreference::Block));
    }

    #[test]
    fn only_keeps_video_candidates() {
        let video = make_candidate("p1", Some(true));
        let text = make_candidate("p2", Some(false));
        let unknown = make_candidate("p3", None);

        assert!(VideoFilter::should_keep(&video, VideoPreference::Only));
        assert!(!VideoFilter::should_keep(&text, VideoPreference::Only));
        assert!(!VideoFilter::should_keep(&unknown, VideoPreference::Only));
    }

    #[test]
    fn video_preference_from_str() {
        assert_eq!(VideoPreference::from_str("allow"), VideoPreference::Allow);
        assert_eq!(VideoPreference::from_str("block"), VideoPreference::Block);
        assert_eq!(VideoPreference::from_str("only"), VideoPreference::Only);
        assert_eq!(VideoPreference::from_str("unknown"), VideoPreference::Allow);
    }
}
