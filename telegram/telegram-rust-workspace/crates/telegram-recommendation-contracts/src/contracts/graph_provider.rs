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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelNeighborRequest {
    pub user_id: String,
    pub limit: usize,
    pub exclude_user_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelBridgeRequest {
    pub user_id: String,
    pub limit: usize,
    pub max_depth: usize,
    pub exclude_user_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelNeighborCandidate {
    pub user_id: String,
    pub score: f64,
    pub interaction_probability: Option<f64>,
    pub engagement_score: Option<f64>,
    pub recentness_score: Option<f64>,
    #[serde(default)]
    pub relation_kinds: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelBridgeCandidate {
    pub user_id: String,
    pub score: f64,
    pub depth: usize,
    pub path_count: usize,
    #[serde(default)]
    pub via_user_ids: Vec<String>,
    pub bridge_strength: Option<f64>,
    pub via_user_count: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelQueryDiagnostics {
    pub kernel: String,
    pub query_duration_ms: u64,
    pub candidate_count: usize,
    #[serde(default)]
    pub requested_limit: usize,
    #[serde(default)]
    pub available_count: usize,
    #[serde(default)]
    pub truncated_count: usize,
    #[serde(default)]
    pub budget_exhausted: bool,
    pub empty: bool,
    pub empty_reason: Option<String>,
    #[serde(default)]
    pub relation_kinds: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelQueryResult<T> {
    #[serde(default)]
    pub candidates: Vec<T>,
    pub diagnostics: Option<GraphKernelQueryDiagnostics>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelCandidatesResponse<T> {
    pub candidates: Option<Vec<T>>,
    pub diagnostics: Option<GraphKernelQueryDiagnostics>,
}

impl<T> GraphKernelCandidatesResponse<T> {
    pub fn into_query_result(self) -> GraphKernelQueryResult<T> {
        GraphKernelQueryResult {
            candidates: self.candidates.unwrap_or_default(),
            diagnostics: self.diagnostics,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        GraphKernelCandidatesResponse, GraphKernelNeighborCandidate, GraphKernelNeighborRequest,
    };

    #[test]
    fn serializes_graph_kernel_neighbor_request_contract() {
        let request = GraphKernelNeighborRequest {
            user_id: "user-1".to_string(),
            limit: 10,
            exclude_user_ids: vec!["blocked-1".to_string()],
        };

        let value = serde_json::to_value(request).expect("serialize graph kernel request");

        assert_eq!(
            value,
            json!({
                "userId": "user-1",
                "limit": 10,
                "excludeUserIds": ["blocked-1"]
            })
        );
    }

    #[test]
    fn parses_graph_kernel_candidates_response_contract() {
        let response: GraphKernelCandidatesResponse<GraphKernelNeighborCandidate> =
            serde_json::from_value(json!({
                "candidates": [{
                    "userId": "author-1",
                    "score": 0.91,
                    "interactionProbability": 0.4,
                    "engagementScore": 0.5,
                    "recentnessScore": 0.6,
                    "relationKinds": ["follow"]
                }],
                "diagnostics": {
                    "kernel": "social_neighbors",
                    "queryDurationMs": 12,
                    "candidateCount": 1,
                    "requestedLimit": 10,
                    "empty": false,
                    "emptyReason": null
                }
            }))
            .expect("parse graph kernel response");

        let result = response.into_query_result();

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].user_id, "author-1");
        assert_eq!(
            result
                .diagnostics
                .as_ref()
                .map(|diagnostics| diagnostics.kernel.as_str()),
            Some("social_neighbors")
        );
    }

    #[test]
    fn graph_kernel_response_defaults_missing_candidates() {
        let response: GraphKernelCandidatesResponse<GraphKernelNeighborCandidate> =
            serde_json::from_value(json!({
                "diagnostics": {
                    "kernel": "social_neighbors",
                    "queryDurationMs": 1,
                    "candidateCount": 0,
                    "empty": true,
                    "emptyReason": "no_edges"
                }
            }))
            .expect("parse empty graph kernel response");

        assert!(response.into_query_result().candidates.is_empty());
    }
}
