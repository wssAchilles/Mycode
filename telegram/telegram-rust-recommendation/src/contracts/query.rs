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
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_history_external_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_context: Option<ExperimentContextPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryPatchPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_features: Option<UserFeaturesPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_history_external_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_user_action_sequence: Option<Vec<HashMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_context: Option<ExperimentContextPayload>,
}
