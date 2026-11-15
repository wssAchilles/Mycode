//! 推荐管线各阶段摘要与运行期统计契约（检索、重排、选择器与服务层）。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 单个管线执行阶段的耗时、吞吐与详情载荷。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationStagePayload {
    pub name: String,
    pub enabled: bool,
    pub duration_ms: u64,
    pub input_count: usize,
    pub output_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<HashMap<String, Value>>,
}

/// 图召回子系统的运行期配额、缓存与核函数细分指标。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationGraphRetrievalPayload {
    pub total_candidates: usize,
    pub kernel_candidates: usize,
    pub legacy_candidates: usize,
    pub fallback_used: bool,
    pub empty_result: bool,
    pub kernel_source_counts: HashMap<String, usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_query_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_provider_latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_cache_hit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_requested_author_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_unique_author_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_returned_post_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_cache_key_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_cache_ttl_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_cache_entry_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materializer_cache_eviction_count: Option<u64>,
    #[serde(default)]
    pub per_kernel_candidate_counts: HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_requested_limits: HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_available_counts: HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_returned_counts: HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_truncated_counts: HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_latency_ms: HashMap<String, u64>,
    #[serde(default)]
    pub per_kernel_empty_reasons: HashMap<String, String>,
    #[serde(default)]
    pub per_kernel_errors: HashMap<String, String>,
    #[serde(default)]
    pub budget_exhausted_kernels: Vec<String>,
    pub dominant_kernel_source: Option<String>,
    pub dominance_share: Option<f64>,
    pub empty_reason: Option<String>,
}

/// 召回总览阶段统计信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationRetrievalSummaryPayload {
    pub stage: String,
    pub total_candidates: usize,
    pub in_network_candidates: usize,
    pub out_of_network_candidates: usize,
    pub ml_retrieved_candidates: usize,
    pub recent_hot_candidates: usize,
    pub source_counts: HashMap<String, usize>,
    #[serde(default)]
    pub source_outcome_counts: HashMap<String, usize>,
    #[serde(default)]
    pub source_failure_counts: HashMap<String, usize>,
    #[serde(default)]
    pub source_disabled_counts: HashMap<String, usize>,
    #[serde(default)]
    pub lane_counts: HashMap<String, usize>,
    pub ml_source_counts: HashMap<String, usize>,
    pub stage_timings: HashMap<String, u64>,
    pub degraded_reasons: Vec<String>,
    pub graph: RecommendationGraphRetrievalPayload,
}

/// 精排阶段候选数量演变与过滤器淘汰统计。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationRankingSummaryPayload {
    pub stage: String,
    pub input_candidates: usize,
    pub hydrated_candidates: usize,
    pub filtered_candidates: usize,
    pub scored_candidates: usize,
    pub ml_eligible_candidates: usize,
    pub ml_ranked_candidates: usize,
    pub weighted_candidates: usize,
    pub stage_timings: HashMap<String, u64>,
    pub filter_drop_counts: HashMap<String, usize>,
    pub degraded_reasons: Vec<String>,
}

/// 选择器截断与超采样配置及执行报告。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationSelectorPayload {
    pub oversample_factor: usize,
    pub max_size: usize,
    pub final_limit: usize,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector_report: Option<HashMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector_report_unavailable_reason: Option<String>,
}

/// 翻页游标、缓存策略与去重补位状态摘要。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationServingSummaryPayload {
    pub serving_version: String,
    pub cursor_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<chrono::DateTime<chrono::Utc>>,
    pub has_more: bool,
    pub served_state_version: String,
    pub stable_order_key: String,
    pub duplicate_suppressed_count: usize,
    pub cross_page_duplicate_count: usize,
    #[serde(default)]
    pub suppression_reasons: HashMap<String, usize>,
    pub serve_cache_hit: bool,
    pub stable_order_drifted: bool,
    pub cache_key_mode: String,
    pub cache_policy: String,
    pub cache_policy_reason: String,
    pub page_remaining_count: usize,
    pub page_underfilled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_underfill_reason: Option<String>,
}
