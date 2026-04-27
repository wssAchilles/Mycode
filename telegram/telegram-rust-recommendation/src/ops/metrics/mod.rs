use chrono::{DateTime, Utc};
use std::collections::{HashMap, VecDeque};

use crate::candidate_pipeline::definition::{
    PROVIDER_LATENCY_BUDGET_MS, SOURCE_BATCH_COMPONENT_TIMEOUT_MS,
};
use crate::contracts::ops::{RecommendationComponentHealthWindowEntry, StageLatencySnapshot};
use crate::contracts::{
    RecentStoreSnapshot, RecommendationOpsSummary, RecommendationSourceHealthEntry,
    RecommendationStagePayload, RecommendationSummaryPayload,
};

mod component_health;
mod helpers;
mod recording;
mod summary;

use component_health::{
    ComponentHealthEvent, component_health_event, is_health_tracked_stage,
    prune_component_health_events, summarize_component_health_events,
};
use helpers::{
    accumulate_count_map, build_guardrails, extract_source_health, percentile, ratio,
    rescue_hit_rate, slowest_provider, timed_out_source_names,
};

#[derive(Debug, Default)]
pub struct RecommendationMetrics {
    total_requests: u64,
    total_failures: u64,
    last_request_id: Option<String>,
    last_selected_count: Option<usize>,
    last_retrieved_count: Option<usize>,
    last_has_more: Option<bool>,
    last_next_cursor: Option<String>,
    last_serving_version: Option<String>,
    last_cursor_mode: Option<String>,
    last_served_state_version: Option<String>,
    last_stable_order_key: Option<String>,
    last_duplicate_suppressed_count: Option<usize>,
    last_cross_page_duplicate_count: Option<usize>,
    last_serve_cache_hit: Option<bool>,
    last_cache_policy_reason: Option<String>,
    last_page_remaining_count: Option<usize>,
    last_page_underfilled: Option<bool>,
    last_page_underfill_reason: Option<String>,
    last_suppression_reasons: HashMap<String, usize>,
    serve_cache_hit_count: u64,
    serve_cache_miss_count: u64,
    stable_order_drift_count: u64,
    page_underfill_count: u64,
    suppression_reason_counts: HashMap<String, u64>,
    underfill_reason_counts: HashMap<String, u64>,
    last_rescue_selected_count: Option<usize>,
    self_post_rescue_attempt_count: u64,
    self_post_rescue_hit_count: u64,
    last_ml_retrieved_count: Option<usize>,
    last_ml_ranked_count: Option<usize>,
    last_graph_retrieved_count: Option<usize>,
    last_graph_kernel_candidates: Option<usize>,
    last_graph_legacy_candidates: Option<usize>,
    last_graph_fallback_used: Option<bool>,
    last_graph_materializer_query_duration_ms: Option<u64>,
    last_graph_materializer_provider_latency_ms: Option<u64>,
    last_graph_materializer_cache_hit: Option<bool>,
    last_graph_materializer_cache_key_mode: Option<String>,
    last_graph_materializer_cache_ttl_ms: Option<u64>,
    last_graph_materializer_cache_entry_count: Option<usize>,
    last_graph_materializer_cache_eviction_count: Option<u64>,
    graph_materializer_cache_hit_count: u64,
    graph_materializer_cache_miss_count: u64,
    last_graph_kernel_source_counts: HashMap<String, usize>,
    last_graph_per_kernel_candidate_counts: HashMap<String, usize>,
    last_graph_per_kernel_requested_limits: HashMap<String, usize>,
    last_graph_per_kernel_available_counts: HashMap<String, usize>,
    last_graph_per_kernel_returned_counts: HashMap<String, usize>,
    last_graph_per_kernel_truncated_counts: HashMap<String, usize>,
    last_graph_per_kernel_latency_ms: HashMap<String, u64>,
    last_graph_per_kernel_empty_reasons: HashMap<String, String>,
    last_graph_per_kernel_errors: HashMap<String, String>,
    last_graph_budget_exhausted_kernels: Vec<String>,
    last_graph_dominant_source: Option<String>,
    last_graph_dominance_share: Option<f64>,
    last_graph_empty_reason: Option<String>,
    last_provider_calls: HashMap<String, usize>,
    last_provider_latency_ms: HashMap<String, u64>,
    last_slow_provider: Option<String>,
    last_slow_provider_ms: Option<u64>,
    provider_latency_budget_exceeded_count: u64,
    source_batch_timeout_count: u64,
    last_source_batch_timed_out_sources: Vec<String>,
    last_source_health: Vec<RecommendationSourceHealthEntry>,
    component_health_events: HashMap<String, VecDeque<ComponentHealthEvent>>,
    empty_retrieval_count: u64,
    empty_selection_count: u64,
    underfilled_selection_count: u64,
    phoenix_empty_ranking_count: u64,
    last_online_eval: crate::contracts::RecommendationOnlineEvaluationPayload,
    online_eval_total_selected: u64,
    online_eval_trend_selected: u64,
    online_eval_news_selected: u64,
    online_eval_exploration_selected: u64,
    online_eval_source_counts: HashMap<String, u64>,
    online_eval_lane_counts: HashMap<String, u64>,
    online_eval_pool_counts: HashMap<String, u64>,
    stage_latency_samples: HashMap<String, VecDeque<u64>>,
    last_stage_latency: HashMap<String, u64>,
    partial_degrade_count: u64,
    timeout_count: u64,
    side_effect_dispatch_count: u64,
    side_effect_complete_count: u64,
    side_effect_failure_count: u64,
    last_side_effect_error: Option<String>,
    last_side_effect_names: Vec<String>,
    last_side_effect_completed_at: Option<DateTime<Utc>>,
    last_degraded_reasons: Vec<String>,
    last_error: Option<String>,
    last_completed_at: Option<DateTime<Utc>>,
}

const COMPONENT_HEALTH_WINDOW_SECONDS: i64 = 300;
const CIRCUIT_MIN_EVENTS: usize = 2;
const CIRCUIT_FAILURE_RATE: f64 = 0.6;

#[cfg(test)]
mod tests;
