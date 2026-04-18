use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsRuntime {
    pub stage: String,
    pub backend_url: String,
    pub retrieval_mode: String,
    pub ranking_mode: String,
    pub pipeline_version: String,
    pub owner: String,
    pub fallback_mode: String,
    pub graph_provider_mode: String,
    pub graph_kernel_url: String,
    pub query_hydrators: Vec<String>,
    pub source_order: Vec<String>,
    pub candidate_hydrators: Vec<String>,
    pub filters: Vec<String>,
    pub scorers: Vec<String>,
    pub selectors: Vec<String>,
    pub side_effects: Vec<String>,
    pub graph_source_enabled: bool,
    pub graph_materializer_limit_per_author: usize,
    pub graph_materializer_lookback_days: usize,
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
    pub last_graph_retrieved_count: Option<usize>,
    pub last_graph_kernel_candidates: Option<usize>,
    pub last_graph_legacy_candidates: Option<usize>,
    pub last_graph_fallback_used: Option<bool>,
    pub last_graph_kernel_source_counts: HashMap<String, usize>,
    pub last_graph_dominant_source: Option<String>,
    pub last_provider_calls: HashMap<String, usize>,
    pub degraded_reasons: Vec<String>,
    pub recent_store: RecentStoreSnapshot,
}
