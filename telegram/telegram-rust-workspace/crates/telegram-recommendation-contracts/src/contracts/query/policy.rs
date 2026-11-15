//! 查询阶段实验分流上下文与在线排序策略契约结构。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 单项实验命中分配明细。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAssignmentPayload {
    pub experiment_id: String,
    pub experiment_name: String,
    pub bucket: String,
    pub config: HashMap<String, Value>,
    pub in_experiment: bool,
}

/// 请求维度完整实验上下文。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentContextPayload {
    pub user_id: String,
    pub assignments: Vec<ExperimentAssignmentPayload>,
}

/// 在线排序策略超参载荷，由实验系统下发并在 Rust/Node 间对齐共享。
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
