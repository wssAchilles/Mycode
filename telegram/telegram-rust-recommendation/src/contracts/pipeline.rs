use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::candidate::RecommendationCandidatePayload;
use super::query::{RecommendationQueryPatchPayload, RecommendationQueryPayload};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationStagePayload {
    pub name: String,
    pub enabled: bool,
    pub duration_ms: u64,
    pub input_count: usize,
    pub output_count: usize,
    pub removed_count: Option<usize>,
    pub detail: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationGraphRetrievalPayload {
    pub total_candidates: usize,
    pub kernel_candidates: usize,
    pub legacy_candidates: usize,
    pub fallback_used: bool,
    pub empty_result: bool,
    pub kernel_source_counts: HashMap<String, usize>,
    pub dominant_kernel_source: Option<String>,
    pub empty_reason: Option<String>,
}

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
    pub ml_source_counts: HashMap<String, usize>,
    pub stage_timings: HashMap<String, u64>,
    pub degraded_reasons: Vec<String>,
    pub graph: RecommendationGraphRetrievalPayload,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationSelectorPayload {
    pub oversample_factor: usize,
    pub max_size: usize,
    pub final_limit: usize,
    pub truncated: bool,
}

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
    pub retrieved_count: usize,
    pub selected_count: usize,
    pub source_counts: HashMap<String, usize>,
    pub filter_drop_counts: HashMap<String, usize>,
    pub stage_timings: HashMap<String, u64>,
    #[serde(default)]
    pub stage_latency_ms: HashMap<String, u64>,
    pub degraded_reasons: Vec<String>,
    pub recent_hot_applied: bool,
    pub selector: RecommendationSelectorPayload,
    pub retrieval: RecommendationRetrievalSummaryPayload,
    pub ranking: RecommendationRankingSummaryPayload,
    pub stages: Vec<RecommendationStagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationResultPayload {
    pub request_id: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub summary: RecommendationSummaryPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydrateResponse {
    pub query: RecommendationQueryPayload,
    pub stages: Vec<RecommendationStagePayload>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHydratorPatchResponse {
    pub hydrator_name: String,
    pub query_patch: RecommendationQueryPatchPayload,
    pub stage: RecommendationStagePayload,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
    pub summary: RecommendationRetrievalSummaryPayload,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCandidatesResponse {
    pub source_name: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stage: RecommendationStagePayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStageRequest {
    pub query: RecommendationQueryPayload,
    pub candidates: Vec<RecommendationCandidatePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStageResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
    #[serde(default)]
    pub provider_calls: HashMap<String, usize>,
}

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
