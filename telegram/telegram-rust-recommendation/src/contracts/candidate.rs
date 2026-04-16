use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateMediaPayload {
    #[serde(rename = "type")]
    pub type_: String,
    pub url: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PhoenixScoresPayload {
    pub like_score: Option<f64>,
    pub reply_score: Option<f64>,
    pub repost_score: Option<f64>,
    pub quote_score: Option<f64>,
    pub click_score: Option<f64>,
    pub quoted_click_score: Option<f64>,
    pub profile_click_score: Option<f64>,
    pub dwell_score: Option<f64>,
    pub dwell_time: Option<f64>,
    pub share_score: Option<f64>,
    pub share_via_dm_score: Option<f64>,
    pub share_via_copy_link_score: Option<f64>,
    pub photo_expand_score: Option<f64>,
    pub follow_author_score: Option<f64>,
    pub video_quality_view_score: Option<f64>,
    pub not_interested_score: Option<f64>,
    pub dismiss_score: Option<f64>,
    pub block_author_score: Option<f64>,
    pub block_score: Option<f64>,
    pub mute_author_score: Option<f64>,
    pub report_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CandidateVisibilityPayload {
    pub safe: bool,
    pub reason: Option<String>,
    pub level: Option<String>,
    pub score: Option<f64>,
    pub violations: Option<Vec<String>>,
    pub requires_review: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CandidateNewsMetadataPayload {
    pub title: Option<String>,
    pub source: Option<String>,
    pub url: Option<String>,
    pub source_url: Option<String>,
    pub external_id: Option<String>,
    pub cluster_id: Option<i64>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationCandidatePayload {
    pub post_id: String,
    pub model_post_id: Option<String>,
    pub author_id: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub conversation_id: Option<String>,
    pub is_reply: bool,
    pub reply_to_post_id: Option<String>,
    pub is_repost: bool,
    pub original_post_id: Option<String>,
    pub in_network: Option<bool>,
    pub recall_source: Option<String>,
    pub has_video: Option<bool>,
    pub has_image: Option<bool>,
    pub video_duration_sec: Option<f64>,
    pub media: Option<Vec<CandidateMediaPayload>>,
    pub like_count: Option<f64>,
    pub comment_count: Option<f64>,
    pub repost_count: Option<f64>,
    pub view_count: Option<f64>,
    pub author_username: Option<String>,
    pub author_avatar_url: Option<String>,
    pub author_affinity_score: Option<f64>,
    pub phoenix_scores: Option<PhoenixScoresPayload>,
    pub weighted_score: Option<f64>,
    pub score: Option<f64>,
    pub is_liked_by_user: Option<bool>,
    pub is_reposted_by_user: Option<bool>,
    pub is_nsfw: Option<bool>,
    pub vf_result: Option<CandidateVisibilityPayload>,
    pub is_news: Option<bool>,
    pub news_metadata: Option<CandidateNewsMetadataPayload>,
    pub is_pinned: Option<bool>,
    #[serde(rename = "_scoreBreakdown")]
    pub score_breakdown: Option<HashMap<String, f64>>,
    #[serde(rename = "_pipelineScore")]
    pub pipeline_score: Option<f64>,
    pub graph_score: Option<f64>,
    pub graph_path: Option<String>,
    pub graph_recall_type: Option<String>,
}
