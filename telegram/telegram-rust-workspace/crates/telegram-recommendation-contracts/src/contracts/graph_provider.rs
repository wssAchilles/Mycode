use serde::{Deserialize, Serialize};

use super::candidate::RecommendationCandidatePayload;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAuthorMaterializationRequest {
    pub author_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_per_author: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookback_days: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAuthorMaterializationResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<GraphAuthorMaterializationDiagnostics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAuthorMaterializationDiagnostics {
    pub requested_author_count: usize,
    pub unique_author_count: usize,
    pub returned_post_count: usize,
    pub query_duration_ms: u64,
    pub cache_hit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_key_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_ttl_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_entry_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_eviction_count: Option<u64>,
}
