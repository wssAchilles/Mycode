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
}
