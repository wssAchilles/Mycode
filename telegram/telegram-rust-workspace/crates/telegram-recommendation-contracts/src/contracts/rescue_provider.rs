use serde::{Deserialize, Serialize};

use super::candidate::RecommendationCandidatePayload;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfPostRescueRequest {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookback_days: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfPostRescueResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
}
