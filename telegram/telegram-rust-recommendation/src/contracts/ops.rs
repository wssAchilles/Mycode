use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageLatencySnapshot {
    pub last_ms: u64,
    pub p50_ms: u64,
    pub p95_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsRuntime {
    pub stage: String,
    pub backend_url: String,
    pub redis_url: String,
    pub retrieval_mode: String,
    pub ranking_mode: String,
    pub serving_version: String,
    pub cursor_mode: String,
    pub stage_execution_mode: String,
    pub query_hydrator_execution_mode: String,
    pub source_execution_mode: String,
    pub query_hydrator_concurrency: usize,
    pub source_concurrency: usize,
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
    pub post_selection_hydrators: Vec<String>,
    pub post_selection_filters: Vec<String>,
    pub side_effects: Vec<String>,
    pub graph_source_enabled: bool,
    pub graph_materializer_limit_per_author: usize,
    pub graph_materializer_lookback_days: usize,
    pub recent_global_capacity: usize,
    pub recent_per_user_capacity: usize,
    pub selector_oversample_factor: usize,
    pub selector_max_size: usize,
    pub serve_cache_enabled: bool,
    pub serve_cache_ttl_secs: usize,
    pub serve_cache_prefix: String,
    pub serving_author_soft_cap: usize,
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
    pub last_has_more: Option<bool>,
    pub last_next_cursor: Option<String>,
    pub last_serving_version: Option<String>,
    pub last_cursor_mode: Option<String>,
    pub last_served_state_version: Option<String>,
    pub last_stable_order_key: Option<String>,
    pub last_duplicate_suppressed_count: Option<usize>,
    pub last_cross_page_duplicate_count: Option<usize>,
    pub last_serve_cache_hit: Option<bool>,
    pub serve_cache_hit_count: u64,
    pub serve_cache_miss_count: u64,
    pub stable_order_drift_count: u64,
    pub last_rescue_selected_count: Option<usize>,
    pub self_post_rescue_attempt_count: u64,
    pub self_post_rescue_hit_count: u64,
    pub self_post_rescue_hit_rate: Option<f64>,
    pub last_ml_retrieved_count: Option<usize>,
    pub last_ml_ranked_count: Option<usize>,
    pub last_graph_retrieved_count: Option<usize>,
    pub last_graph_kernel_candidates: Option<usize>,
    pub last_graph_legacy_candidates: Option<usize>,
    pub last_graph_fallback_used: Option<bool>,
    pub last_graph_kernel_source_counts: HashMap<String, usize>,
    pub last_graph_per_kernel_candidate_counts: HashMap<String, usize>,
    pub last_graph_per_kernel_requested_limits: HashMap<String, usize>,
    pub last_graph_per_kernel_available_counts: HashMap<String, usize>,
    pub last_graph_per_kernel_returned_counts: HashMap<String, usize>,
    pub last_graph_per_kernel_truncated_counts: HashMap<String, usize>,
    pub last_graph_per_kernel_latency_ms: HashMap<String, u64>,
    pub last_graph_per_kernel_empty_reasons: HashMap<String, String>,
    pub last_graph_per_kernel_errors: HashMap<String, String>,
    pub last_graph_budget_exhausted_kernels: Vec<String>,
    pub last_graph_dominant_source: Option<String>,
    pub last_graph_dominance_share: Option<f64>,
    pub last_graph_empty_reason: Option<String>,
    pub last_provider_calls: HashMap<String, usize>,
    pub stage_latency: HashMap<String, StageLatencySnapshot>,
    pub partial_degrade_count: u64,
    pub timeout_count: u64,
    pub degraded_reasons: Vec<String>,
    pub recent_store: RecentStoreSnapshot,
}
