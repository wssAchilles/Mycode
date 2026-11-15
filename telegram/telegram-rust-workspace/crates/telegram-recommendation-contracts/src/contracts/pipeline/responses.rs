//! Rust ↔ Node.js 推荐管线分阶段 RPC 请求与响应契约。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::stage::{
    RecommendationRankingSummaryPayload, RecommendationRetrievalSummaryPayload,
    RecommendationStagePayload,
};
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPatchPayload, RecommendationQueryPayload,
};

/// 查询水合整阶段响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydrateResponse {
    pub query: RecommendationQueryPayload,
    pub stages: Vec<RecommendationStagePayload>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

/// 单个查询水合器返回的增量补丁响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydratorPatchResponse {
    pub hydrator_name: String,
    pub query_patch: RecommendationQueryPatchPayload,
    pub stage: RecommendationStagePayload,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<String>,
}

/// 批处理调用多个查询水合器的请求结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydratorBatchRequest {
    pub hydrator_names: Vec<String>,
    pub query: RecommendationQueryPayload,
}

/// 批处理调用多个查询水合器的响应结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydratorBatchResponse {
    pub items: Vec<QueryHydratorPatchResponse>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

/// 召回阶段汇总响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
    pub summary: RecommendationRetrievalSummaryPayload,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
    #[serde(default)]
    pub provider_latency_ms: HashMap<String, u64>,
}

/// 单个召回源返回的候选集响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCandidatesResponse {
    pub source_name: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stage: RecommendationStagePayload,
    #[serde(default)]
    pub timed_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<String>,
}

/// 批量并发执行多个召回源的请求结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBatchRequest {
    pub source_names: Vec<String>,
    pub query: RecommendationQueryPayload,
}

/// 批量执行多个召回源的聚合响应结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBatchResponse {
    pub items: Vec<SourceCandidatesResponse>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

/// 候选级阶段（水合/过滤/打分/选择）的通用请求载荷。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStageRequest {
    pub query: RecommendationQueryPayload,
    pub candidates: Vec<RecommendationCandidatePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_names: Option<Vec<String>>,
}

/// 候选级阶段（水合/打分/选择）的通用响应载荷。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStageResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

/// 候选过滤阶段响应（含被剔除的候选与原因计数）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateFilterStageResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub removed: Vec<RecommendationCandidatePayload>,
    pub drop_counts: HashMap<String, usize>,
    pub stages: Vec<RecommendationStagePayload>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

/// 精排汇总阶段响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
    pub drop_counts: HashMap<String, usize>,
    pub summary: RecommendationRankingSummaryPayload,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

#[cfg(test)]
mod tests {
    use super::RecommendationStagePayload;

    #[test]
    fn stage_payload_omits_empty_optional_fields() {
        let payload = RecommendationStagePayload {
            name: "GraphSource".to_string(),
            enabled: true,
            duration_ms: 12,
            input_count: 1,
            output_count: 0,
            removed_count: None,
            detail: None,
        };

        let json = serde_json::to_value(payload).expect("serialize stage payload");

        assert!(json.get("removedCount").is_none());
        assert!(json.get("detail").is_none());
    }
}
