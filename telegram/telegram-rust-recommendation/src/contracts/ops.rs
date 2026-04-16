use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsRuntime {
    pub stage: String,
    pub backend_url: String,
    pub retrieval_mode: String,
    pub ranking_mode: String,
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
    pub last_ml_retrieved_count: Option<usize>,
    pub last_ml_ranked_count: Option<usize>,
    pub degraded_reasons: Vec<String>,
    pub recent_store: RecentStoreSnapshot,
}
