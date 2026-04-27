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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follower_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparseEmbeddingEntryPayload {
    pub cluster_id: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingContextPayload {
    pub interested_in_clusters: Vec<SparseEmbeddingEntryPayload>,
    pub producer_embedding: Vec<SparseEmbeddingEntryPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_for_cluster: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_for_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub computed_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    pub usable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStateContextPayload {
    pub state: String,
    pub reason: String,
    pub followed_count: i64,
    pub recent_action_count: i64,
    pub recent_positive_action_count: i64,
    pub usable_embedding: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_age_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RankingPolicyPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_breakdown_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exploration_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bandit_exploration_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bandit_uncertainty_weight: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exploration_risk_ceiling: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness_half_life_hours: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_feedback_half_life_days: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interest_decay_half_life_hours: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_feedback_penalty_weight: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_batch_timeout_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_oon_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_ceiling_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exploration_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_topic_suppression_weight: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_dedup_overlap_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub near_duplicate_overlap_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub near_duplicate_min_token_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_feedback_propagation_weight: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trend_source_boost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trend_budget_boost_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_trend_link_boost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trend_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trend_ceiling_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_ceiling_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_network_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub social_graph_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interest_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_floor_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_network_ceiling_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub social_graph_ceiling_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interest_ceiling_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_soft_cap: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cross_request_author_soft_cap: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cross_request_topic_soft_cap: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cross_request_source_soft_cap: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_soft_cap_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_soft_cap_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cold_start_keywords: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trend_keywords: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryPayload {
    pub request_id: String,
    pub user_id: String,
    pub limit: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<DateTime<Utc>>,
    pub in_network_only: bool,
    pub seen_ids: Vec<String>,
    pub served_ids: Vec<String>,
    pub is_bottom_request: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_app_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_features: Option<UserFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_context: Option<EmbeddingContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_state_context: Option<UserStateContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_history_external_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_context: Option<ExperimentContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ranking_policy: Option<RankingPolicyPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryPatchPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_features: Option<UserFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_context: Option<EmbeddingContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_state_context: Option<UserStateContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_history_external_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_context: Option<ExperimentContextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ranking_policy: Option<RankingPolicyPayload>,
}
