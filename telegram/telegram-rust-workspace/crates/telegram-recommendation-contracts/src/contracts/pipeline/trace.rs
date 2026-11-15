//! 推荐请求链路追踪、在线评估与端到端结果总契约。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::stage::{
    RecommendationRankingSummaryPayload, RecommendationRetrievalSummaryPayload,
    RecommendationSelectorPayload, RecommendationServingSummaryPayload, RecommendationStagePayload,
};
use crate::contracts::RecommendationCandidatePayload;

/// 追踪视图中的按召回源计数项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationTraceSourceCountPayload {
    pub source: String,
    pub count: usize,
}

/// 推荐结果时效性分布（最新/最旧及时间跨度）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationTraceFreshnessPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub newest_age_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_age_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range_seconds: Option<u64>,
}

/// 追踪日志记录的精简候选快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationTraceCandidatePayload {
    pub post_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_post_id: Option<String>,
    pub author_id: String,
    pub rank: usize,
    pub recall_source: String,
    pub in_network: bool,
    pub is_news: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weighted_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_breakdown: Option<HashMap<String, f64>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// 供离线反事实回放与决策日志审计的候选池快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationTraceReplayPoolPayload {
    pub pool_kind: String,
    pub total_count: usize,
    pub truncated: bool,
    pub fingerprint: String,
    pub candidates: Vec<RecommendationTraceCandidatePayload>,
}

/// 推荐请求全链路 Trace 载荷。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationTracePayload {
    pub trace_version: String,
    pub trace_mode: String,
    pub request_id: String,
    pub pipeline_version: String,
    pub strategy_version: String,
    pub selected_fingerprint: String,
    pub replay_pool_fingerprint: String,
    pub owner: String,
    pub fallback_mode: String,
    pub selected_count: usize,
    pub in_network_count: usize,
    pub out_of_network_count: usize,
    pub source_counts: Vec<RecommendationTraceSourceCountPayload>,
    pub author_diversity: f64,
    pub reply_ratio: f64,
    pub average_score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_score: Option<f64>,
    pub freshness: RecommendationTraceFreshnessPayload,
    pub candidates: Vec<RecommendationTraceCandidatePayload>,
    pub experiment_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_quality_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_pool: Option<RecommendationTraceReplayPoolPayload>,
    pub serve_cache_hit: bool,
}

/// 单次请求的在线多样性与质量指标评估快照。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOnlineEvaluationPayload {
    pub selected_count: usize,
    pub average_score: f64,
    pub score_stddev: f64,
    pub unique_author_ratio: f64,
    pub source_entropy: f64,
    pub lane_entropy: f64,
    pub pool_entropy: f64,
    pub trend_count: usize,
    pub news_count: usize,
    pub exploration_count: usize,
    pub negative_pressure_average: f64,
    pub source_counts: HashMap<String, usize>,
    pub lane_counts: HashMap<String, usize>,
    pub pool_counts: HashMap<String, usize>,
}

/// 推荐引擎一次完整请求的各子系统汇总报告。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationSummaryPayload {
    pub request_id: String,
    pub stage: String,
    pub pipeline_version: String,
    pub owner: String,
    pub fallback_mode: String,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
    #[serde(default)]
    pub provider_latency_ms: HashMap<String, u64>,
    pub retrieved_count: usize,
    pub selected_count: usize,
    pub source_counts: HashMap<String, usize>,
    pub filter_drop_counts: HashMap<String, usize>,
    pub stage_timings: HashMap<String, u64>,
    #[serde(default)]
    pub stage_latency_ms: HashMap<String, u64>,
    pub degraded_reasons: Vec<String>,
    pub recent_hot_applied: bool,
    pub online_eval: RecommendationOnlineEvaluationPayload,
    pub selector: RecommendationSelectorPayload,
    pub serving: RecommendationServingSummaryPayload,
    pub retrieval: RecommendationRetrievalSummaryPayload,
    pub ranking: RecommendationRankingSummaryPayload,
    pub stages: Vec<RecommendationStagePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace: Option<RecommendationTracePayload>,
}

/// 推荐主接口返回给上游网关/Node 层的最终结果结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationResultPayload {
    pub request_id: String,
    pub serving_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<chrono::DateTime<chrono::Utc>>,
    pub has_more: bool,
    pub served_state_version: String,
    pub stable_order_key: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub summary: RecommendationSummaryPayload,
}
