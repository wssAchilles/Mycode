use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAssignmentPayload {
    pub experiment_id: String,
    pub experiment_name: String,
    pub bucket: String,
    pub config: HashMap<String, Value>,
    pub in_experiment: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentContextPayload {
    pub user_id: String,
    pub assignments: Vec<ExperimentAssignmentPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserFeaturesPayload {
    pub followed_user_ids: Vec<String>,
    pub blocked_user_ids: Vec<String>,
    pub muted_keywords: Vec<String>,
    pub seen_post_ids: Vec<String>,
    pub follower_count: Option<i64>,
    pub account_created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryPayload {
    pub request_id: String,
    pub user_id: String,
    pub limit: usize,
    pub cursor: Option<DateTime<Utc>>,
    pub in_network_only: bool,
    pub seen_ids: Vec<String>,
    pub served_ids: Vec<String>,
    pub is_bottom_request: bool,
    pub client_app_id: Option<i64>,
    pub country_code: Option<String>,
    pub language_code: Option<String>,
    pub user_features: Option<UserFeaturesPayload>,
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    pub news_history_external_ids: Option<Vec<String>>,
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    pub experiment_context: Option<ExperimentContextPayload>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationStagePayload {
    pub name: String,
    pub enabled: bool,
    pub duration_ms: u64,
    pub input_count: usize,
    pub output_count: usize,
    pub removed_count: Option<usize>,
    pub detail: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationSelectorPayload {
    pub oversample_factor: usize,
    pub max_size: usize,
    pub final_limit: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationSummaryPayload {
    pub request_id: String,
    pub stage: String,
    pub retrieved_count: usize,
    pub selected_count: usize,
    pub source_counts: HashMap<String, usize>,
    pub filter_drop_counts: HashMap<String, usize>,
    pub stage_timings: HashMap<String, u64>,
    pub degraded_reasons: Vec<String>,
    pub recent_hot_applied: bool,
    pub selector: RecommendationSelectorPayload,
    pub stages: Vec<RecommendationStagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationResultPayload {
    pub request_id: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub summary: RecommendationSummaryPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessEnvelope<T> {
    pub success: bool,
    pub data: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydrateResponse {
    pub query: RecommendationQueryPayload,
    pub stages: Vec<RecommendationStagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResponse {
    pub source_name: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stage: RecommendationStagePayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStageRequest {
    pub query: RecommendationQueryPayload,
    pub candidates: Vec<RecommendationCandidatePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStageResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateFilterStageResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub removed: Vec<RecommendationCandidatePayload>,
    pub drop_counts: HashMap<String, usize>,
    pub stages: Vec<RecommendationStagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsRuntime {
    pub stage: String,
    pub backend_url: String,
    pub recent_global_capacity: usize,
    pub recent_per_user_capacity: usize,
    pub selector_oversample_factor: usize,
    pub selector_max_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentStoreSnapshot {
    pub global_size: usize,
    pub tracked_users: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsSummary {
    pub status: String,
    pub current_stage: String,
    pub total_requests: u64,
    pub total_failures: u64,
    pub last_request_id: Option<String>,
    pub last_selected_count: Option<usize>,
    pub last_retrieved_count: Option<usize>,
    pub degraded_reasons: Vec<String>,
    pub recent_store: RecentStoreSnapshot,
}
