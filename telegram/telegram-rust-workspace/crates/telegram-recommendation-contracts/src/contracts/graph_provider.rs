use serde::{Deserialize, Serialize};

use super::candidate::RecommendationCandidatePayload;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelBatchShadowComparison {
    pub mode: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_snapshot_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_snapshot_loaded_at_ms: Option<u64>,
    #[serde(default)]
    pub legacy_snapshot_versions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_drift: Option<bool>,
    #[serde(default)]
    pub count_drift: std::collections::HashMap<String, i64>,
    #[serde(default)]
    pub diagnostic_drift: std::collections::HashMap<String, Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelTelemetry {
    #[serde(default)]
    pub per_kernel_candidate_counts: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_requested_limits: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_available_counts: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_returned_counts: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_truncated_counts: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_scanned_counts: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_visited_counts: std::collections::HashMap<String, usize>,
    #[serde(default)]
    pub per_kernel_snapshot_versions: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub per_kernel_snapshot_loaded_at_ms: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub per_kernel_latency_ms: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub per_kernel_empty_reasons: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub per_kernel_errors: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub budget_exhausted_kernels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch_shadow_compare: Option<GraphKernelBatchShadowComparison>,
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelBatchRequest {
    pub user_id: String,
    pub direct_limit: usize,
    pub bridge_limit: usize,
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
pub struct GraphKernelBatchBridgeCandidate {
    pub user_id: String,
    pub score: f64,
    pub depth: usize,
    pub path_count: usize,
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
    pub scanned_count: usize,
    #[serde(default)]
    pub visited_count: usize,
    pub snapshot_version: Option<String>,
    pub snapshot_loaded_at_ms: Option<u64>,
    #[serde(default)]
    pub pruned_count: usize,
    #[serde(default)]
    pub frontier_max_size: usize,
    #[serde(default)]
    pub budget_exhausted: bool,
    pub empty: bool,
    pub empty_reason: Option<String>,
    #[serde(default)]
    pub relation_kinds: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelBatchQueryDiagnostics {
    pub kernel: String,
    pub query_duration_ms: u64,
    pub candidate_count: usize,
    pub requested_limit: usize,
    pub available_count: usize,
    pub truncated_count: usize,
    pub scanned_count: usize,
    pub visited_count: usize,
    pub snapshot_version: String,
    pub snapshot_loaded_at_ms: u64,
    pub pruned_count: usize,
    pub frontier_max_size: usize,
    pub budget_exhausted: bool,
    pub empty: bool,
    pub empty_reason: serde_json::Value,
    pub relation_kinds: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", bound(deserialize = "T: Deserialize<'de>"))]
pub struct GraphKernelQueryResult<T> {
    #[serde(default)]
    pub candidates: Vec<T>,
    pub diagnostics: Option<GraphKernelQueryDiagnostics>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", bound(deserialize = "T: Deserialize<'de>"))]
pub struct GraphKernelBatchQueryResult<T> {
    pub candidates: Vec<T>,
    pub diagnostics: GraphKernelBatchQueryDiagnostics,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelCandidatesResponse<T> {
    pub candidates: Option<Vec<T>>,
    pub diagnostics: Option<GraphKernelQueryDiagnostics>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphKernelBatchResponse {
    pub user_id: String,
    pub snapshot_version: String,
    pub snapshot_loaded_at_ms: u64,
    pub social_neighbors: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>,
    pub recent_engagers: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>,
    pub bridge_users: GraphKernelBatchQueryResult<GraphKernelBatchBridgeCandidate>,
    pub co_engagers: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>,
    pub content_affinity_neighbors: GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>,
}

const MAX_JAVASCRIPT_SAFE_INTEGER: u128 = 9_007_199_254_740_991;

fn validate_batch_safe_integer(path: &str, value: u128) -> Result<(), String> {
    if value > MAX_JAVASCRIPT_SAFE_INTEGER {
        return Err(format!("unsafe_integer:{path}"));
    }
    Ok(())
}

impl GraphKernelBatchResponse {
    pub fn validate(&self) -> Result<(), String> {
        validate_batch_safe_integer("snapshotLoadedAtMs", self.snapshot_loaded_at_ms as u128)?;
        if self.user_id.trim().is_empty() {
            return Err("missing_user_identity".to_string());
        }
        if self.snapshot_version.trim().is_empty() || self.snapshot_loaded_at_ms == 0 {
            return Err("missing_snapshot_identity".to_string());
        }
        validate_batch_neighbor_result("social_neighbors", &self.social_neighbors, self)?;
        validate_batch_neighbor_result("recent_engagers", &self.recent_engagers, self)?;
        validate_batch_bridge_result("bridge_users", &self.bridge_users, self)?;
        validate_batch_neighbor_result("co_engagers", &self.co_engagers, self)?;
        validate_batch_neighbor_result(
            "content_affinity_neighbors",
            &self.content_affinity_neighbors,
            self,
        )?;
        Ok(())
    }
}

fn validate_batch_diagnostics<T>(
    kernel: &str,
    result: &GraphKernelBatchQueryResult<T>,
    response: &GraphKernelBatchResponse,
) -> Result<(), String> {
    let diagnostics = &result.diagnostics;
    for (field, value) in [
        ("queryDurationMs", diagnostics.query_duration_ms as u128),
        ("candidateCount", diagnostics.candidate_count as u128),
        ("requestedLimit", diagnostics.requested_limit as u128),
        ("availableCount", diagnostics.available_count as u128),
        ("truncatedCount", diagnostics.truncated_count as u128),
        ("scannedCount", diagnostics.scanned_count as u128),
        ("visitedCount", diagnostics.visited_count as u128),
        (
            "snapshotLoadedAtMs",
            diagnostics.snapshot_loaded_at_ms as u128,
        ),
        ("prunedCount", diagnostics.pruned_count as u128),
        ("frontierMaxSize", diagnostics.frontier_max_size as u128),
    ] {
        validate_batch_safe_integer(&format!("{kernel}.{field}"), value)?;
    }
    if diagnostics.kernel != kernel {
        return Err(format!("kernel_mismatch:{kernel}"));
    }
    if diagnostics.snapshot_version != response.snapshot_version
        || diagnostics.snapshot_loaded_at_ms != response.snapshot_loaded_at_ms
    {
        return Err(format!("snapshot_identity_mismatch:{kernel}"));
    }
    if diagnostics.candidate_count != result.candidates.len() {
        return Err(format!("candidate_count_mismatch:{kernel}"));
    }
    if diagnostics.candidate_count > diagnostics.requested_limit {
        return Err(format!("candidate_count_exceeds_requested_limit:{kernel}"));
    }
    if diagnostics.available_count < diagnostics.candidate_count {
        return Err(format!("available_count_below_candidate_count:{kernel}"));
    }
    if diagnostics.truncated_count != diagnostics.available_count - diagnostics.candidate_count {
        return Err(format!("truncated_count_mismatch:{kernel}"));
    }
    if diagnostics.empty != result.candidates.is_empty() {
        return Err(format!("empty_mismatch:{kernel}"));
    }
    if !diagnostics.empty_reason.is_null() && !diagnostics.empty_reason.is_string() {
        return Err(format!("invalid_empty_reason:{kernel}"));
    }
    Ok(())
}

fn validate_batch_neighbor_result(
    kernel: &str,
    result: &GraphKernelBatchQueryResult<GraphKernelNeighborCandidate>,
    response: &GraphKernelBatchResponse,
) -> Result<(), String> {
    validate_batch_diagnostics(kernel, result, response)?;
    if result.candidates.iter().any(|candidate| {
        candidate.user_id.trim().is_empty()
            || !candidate.score.is_finite()
            || candidate
                .interaction_probability
                .is_some_and(|value| !value.is_finite())
            || candidate
                .engagement_score
                .is_some_and(|value| !value.is_finite())
            || candidate
                .recentness_score
                .is_some_and(|value| !value.is_finite())
    }) {
        return Err(format!("invalid_candidate:{kernel}"));
    }
    Ok(())
}

fn validate_batch_bridge_result(
    kernel: &str,
    result: &GraphKernelBatchQueryResult<GraphKernelBatchBridgeCandidate>,
    response: &GraphKernelBatchResponse,
) -> Result<(), String> {
    validate_batch_diagnostics(kernel, result, response)?;
    for candidate in &result.candidates {
        validate_batch_safe_integer(&format!("{kernel}.depth"), candidate.depth as u128)?;
        validate_batch_safe_integer(&format!("{kernel}.pathCount"), candidate.path_count as u128)?;
        if let Some(via_user_count) = candidate.via_user_count {
            validate_batch_safe_integer(&format!("{kernel}.viaUserCount"), via_user_count as u128)?;
        }
    }
    if result.candidates.iter().any(|candidate| {
        candidate.user_id.trim().is_empty()
            || !candidate.score.is_finite()
            || candidate
                .bridge_strength
                .is_some_and(|value| !value.is_finite())
            || candidate
                .via_user_ids
                .iter()
                .any(|user_id| user_id.trim().is_empty())
    }) {
        return Err(format!("invalid_candidate:{kernel}"));
    }
    Ok(())
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
        GraphKernelBatchRequest, GraphKernelBatchResponse, GraphKernelCandidatesResponse,
        GraphKernelNeighborCandidate, GraphKernelNeighborRequest, GraphKernelTelemetry,
    };

    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    const UNSAFE_INTEGER: u64 = MAX_SAFE_INTEGER + 1;

    fn batch_diagnostics(kernel: &str, candidate_count: usize) -> serde_json::Value {
        json!({
            "kernel": kernel,
            "queryDurationMs": 1,
            "candidateCount": candidate_count,
            "requestedLimit": 10,
            "availableCount": candidate_count,
            "truncatedCount": 0,
            "scannedCount": candidate_count,
            "visitedCount": 0,
            "snapshotVersion": "snapshot-v7",
            "snapshotLoadedAtMs": 1_783_278_000_000_u64,
            "prunedCount": 0,
            "frontierMaxSize": 0,
            "budgetExhausted": false,
            "empty": candidate_count == 0,
            "emptyReason": if candidate_count == 0 { Some("no_candidates") } else { None },
            "relationKinds": []
        })
    }

    fn valid_batch_response() -> serde_json::Value {
        json!({
            "userId": "viewer-1",
            "snapshotVersion": "snapshot-v7",
            "snapshotLoadedAtMs": 1_783_278_000_000_u64,
            "socialNeighbors": {
                "candidates": [{ "userId": "a1", "score": 0.9 }],
                "diagnostics": batch_diagnostics("social_neighbors", 1)
            },
            "recentEngagers": {
                "candidates": [],
                "diagnostics": batch_diagnostics("recent_engagers", 0)
            },
            "bridgeUsers": {
                "candidates": [],
                "diagnostics": batch_diagnostics("bridge_users", 0)
            },
            "coEngagers": {
                "candidates": [],
                "diagnostics": batch_diagnostics("co_engagers", 0)
            },
            "contentAffinityNeighbors": {
                "candidates": [],
                "diagnostics": batch_diagnostics("content_affinity_neighbors", 0)
            }
        })
    }

    fn batch_validation_error(payload: serde_json::Value) -> String {
        serde_json::from_value::<GraphKernelBatchResponse>(payload)
            .expect("parse invalid graph batch response")
            .validate()
            .expect_err("reject invalid graph batch response")
    }

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
                    "availableCount": 4,
                    "truncatedCount": 3,
                    "scannedCount": 12,
                    "visitedCount": 7,
                    "snapshotVersion": "snapshot_2026_07_06",
                    "snapshotLoadedAtMs": 1783278000000_u64,
                    "prunedCount": 2,
                    "frontierMaxSize": 8,
                    "budgetExhausted": true,
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
        let diagnostics = result.diagnostics.as_ref().expect("diagnostics");
        assert_eq!(
            diagnostics.snapshot_version.as_deref(),
            Some("snapshot_2026_07_06")
        );
        assert_eq!(diagnostics.snapshot_loaded_at_ms, Some(1_783_278_000_000));
        assert_eq!(diagnostics.available_count, 4);
        assert_eq!(diagnostics.truncated_count, 3);
        assert_eq!(diagnostics.scanned_count, 12);
        assert_eq!(diagnostics.visited_count, 7);
        assert_eq!(diagnostics.pruned_count, 2);
        assert_eq!(diagnostics.frontier_max_size, 8);
        assert!(diagnostics.budget_exhausted);
    }

    #[test]
    fn graph_kernel_batch_contract_round_trips_all_five_kernels() {
        let request = GraphKernelBatchRequest {
            user_id: "viewer-1".to_string(),
            direct_limit: 48,
            bridge_limit: 100,
            max_depth: 3,
            exclude_user_ids: vec!["blocked-1".to_string()],
        };
        assert_eq!(
            serde_json::to_value(request).expect("serialize graph batch request"),
            json!({
                "userId": "viewer-1",
                "directLimit": 48,
                "bridgeLimit": 100,
                "maxDepth": 3,
                "excludeUserIds": ["blocked-1"]
            })
        );

        let response: GraphKernelBatchResponse =
            serde_json::from_value(valid_batch_response()).expect("parse graph batch response");
        response.validate().expect("validate graph batch response");

        assert_eq!(response.snapshot_version, "snapshot-v7");
        assert_eq!(response.user_id, "viewer-1");
        assert_eq!(response.snapshot_loaded_at_ms, 1_783_278_000_000);
        assert_eq!(response.social_neighbors.candidates.len(), 1);
        assert!(response.recent_engagers.candidates.is_empty());
        assert!(response.bridge_users.candidates.is_empty());
        assert!(response.co_engagers.candidates.is_empty());
        assert!(response.content_affinity_neighbors.candidates.is_empty());
    }

    #[test]
    fn graph_kernel_batch_requires_candidates_and_diagnostics() {
        let mut missing_candidates = valid_batch_response();
        missing_candidates["socialNeighbors"]
            .as_object_mut()
            .expect("social result")
            .remove("candidates");
        assert!(serde_json::from_value::<GraphKernelBatchResponse>(missing_candidates).is_err());

        let mut missing_diagnostics = valid_batch_response();
        missing_diagnostics["socialNeighbors"]
            .as_object_mut()
            .expect("social result")
            .remove("diagnostics");
        assert!(serde_json::from_value::<GraphKernelBatchResponse>(missing_diagnostics).is_err());
    }

    #[test]
    fn graph_kernel_batch_requires_bridge_via_user_ids() {
        let mut payload = valid_batch_response();
        payload["bridgeUsers"]["candidates"] = json!([{
            "userId": "bridge-1",
            "score": 0.8,
            "depth": 2,
            "pathCount": 1,
            "bridgeStrength": 0.8,
            "viaUserCount": 1
        }]);
        payload["bridgeUsers"]["diagnostics"] = batch_diagnostics("bridge_users", 1);

        assert!(serde_json::from_value::<GraphKernelBatchResponse>(payload.clone()).is_err());

        payload["bridgeUsers"]["candidates"][0]["viaUserIds"] = json!(["via-1"]);
        let response: GraphKernelBatchResponse =
            serde_json::from_value(payload).expect("parse strict batch bridge candidate");
        response
            .validate()
            .expect("validate strict batch bridge candidate");
        assert_eq!(response.bridge_users.candidates[0].via_user_ids, ["via-1"]);
    }

    #[test]
    fn graph_kernel_batch_strict_bridge_preserves_legacy_missing_via_user_ids() {
        let response: GraphKernelCandidatesResponse<super::GraphKernelBridgeCandidate> =
            serde_json::from_value(json!({
                "candidates": [{
                    "userId": "bridge-1",
                    "score": 0.8,
                    "depth": 2,
                    "pathCount": 1
                }]
            }))
            .expect("parse permissive legacy bridge response");

        assert!(
            response.into_query_result().candidates[0]
                .via_user_ids
                .is_empty()
        );
    }

    #[test]
    fn graph_kernel_batch_rejects_count_invariant_mismatches_with_stable_errors() {
        for (field, value, expected_error) in [
            (
                "requestedLimit",
                0_u64,
                "candidate_count_exceeds_requested_limit:social_neighbors",
            ),
            (
                "availableCount",
                0_u64,
                "available_count_below_candidate_count:social_neighbors",
            ),
            (
                "truncatedCount",
                1_u64,
                "truncated_count_mismatch:social_neighbors",
            ),
        ] {
            let mut payload = valid_batch_response();
            payload["socialNeighbors"]["diagnostics"][field] = json!(value);

            assert_eq!(batch_validation_error(payload), expected_error);
        }
    }

    #[test]
    fn graph_kernel_batch_rejects_unsafe_top_level_snapshot_timestamp() {
        let mut payload = valid_batch_response();
        payload["snapshotLoadedAtMs"] = json!(UNSAFE_INTEGER);

        assert_eq!(
            batch_validation_error(payload),
            "unsafe_integer:snapshotLoadedAtMs"
        );
    }

    #[test]
    fn graph_kernel_batch_rejects_every_unsafe_diagnostics_integer() {
        for field in [
            "queryDurationMs",
            "candidateCount",
            "requestedLimit",
            "availableCount",
            "truncatedCount",
            "scannedCount",
            "visitedCount",
            "snapshotLoadedAtMs",
            "prunedCount",
            "frontierMaxSize",
        ] {
            let mut payload = valid_batch_response();
            payload["socialNeighbors"]["diagnostics"][field] = json!(UNSAFE_INTEGER);

            assert_eq!(
                batch_validation_error(payload),
                format!("unsafe_integer:social_neighbors.{field}")
            );
        }
    }

    #[test]
    fn graph_kernel_batch_rejects_every_unsafe_bridge_integer() {
        for field in ["depth", "pathCount", "viaUserCount"] {
            let mut payload = valid_batch_response();
            payload["bridgeUsers"]["candidates"] = json!([{
                "userId": "bridge-1",
                "score": 0.8,
                "depth": 2,
                "pathCount": 1,
                "viaUserIds": ["via-1"],
                "bridgeStrength": 0.8,
                "viaUserCount": 1
            }]);
            payload["bridgeUsers"]["candidates"][0][field] = json!(UNSAFE_INTEGER);
            payload["bridgeUsers"]["diagnostics"] = batch_diagnostics("bridge_users", 1);

            assert_eq!(
                batch_validation_error(payload),
                format!("unsafe_integer:bridge_users.{field}")
            );
        }
    }

    #[test]
    fn graph_kernel_batch_accepts_max_safe_integer_boundary() {
        let mut payload = valid_batch_response();
        payload["snapshotLoadedAtMs"] = json!(MAX_SAFE_INTEGER);
        for branch in [
            "socialNeighbors",
            "recentEngagers",
            "bridgeUsers",
            "coEngagers",
            "contentAffinityNeighbors",
        ] {
            payload[branch]["diagnostics"]["snapshotLoadedAtMs"] = json!(MAX_SAFE_INTEGER);
        }
        let diagnostics = &mut payload["socialNeighbors"]["diagnostics"];
        diagnostics["queryDurationMs"] = json!(MAX_SAFE_INTEGER);
        diagnostics["requestedLimit"] = json!(MAX_SAFE_INTEGER);
        diagnostics["availableCount"] = json!(MAX_SAFE_INTEGER);
        diagnostics["truncatedCount"] = json!(MAX_SAFE_INTEGER - 1);
        diagnostics["scannedCount"] = json!(MAX_SAFE_INTEGER);
        diagnostics["visitedCount"] = json!(MAX_SAFE_INTEGER);
        diagnostics["prunedCount"] = json!(MAX_SAFE_INTEGER);
        diagnostics["frontierMaxSize"] = json!(MAX_SAFE_INTEGER);
        payload["bridgeUsers"]["candidates"] = json!([{
            "userId": "bridge-1",
            "score": 0.8,
            "depth": MAX_SAFE_INTEGER,
            "pathCount": MAX_SAFE_INTEGER,
            "viaUserIds": ["via-1"],
            "bridgeStrength": 0.8,
            "viaUserCount": MAX_SAFE_INTEGER
        }]);
        payload["bridgeUsers"]["diagnostics"] = batch_diagnostics("bridge_users", 1);
        payload["bridgeUsers"]["diagnostics"]["snapshotLoadedAtMs"] = json!(MAX_SAFE_INTEGER);

        let response: GraphKernelBatchResponse =
            serde_json::from_value(payload).expect("parse max-safe graph batch response");
        response
            .validate()
            .expect("accept max-safe graph batch response");
    }

    #[test]
    fn graph_kernel_batch_rejects_identity_mismatch() {
        let mut payload = valid_batch_response();
        payload["socialNeighbors"]["diagnostics"]["snapshotVersion"] = json!("snapshot-v8");
        let response: GraphKernelBatchResponse =
            serde_json::from_value(payload).expect("parse mismatched graph batch response");

        assert!(
            response
                .validate()
                .expect_err("identity mismatch")
                .contains("snapshot_identity_mismatch")
        );
    }

    #[test]
    fn graph_kernel_batch_rejects_invalid_candidates() {
        let mut payload = valid_batch_response();
        payload["socialNeighbors"]["candidates"][0]["userId"] = json!("");
        let response: GraphKernelBatchResponse =
            serde_json::from_value(payload).expect("parse invalid graph batch candidate");

        assert!(
            response
                .validate()
                .expect_err("invalid candidate")
                .contains("invalid_candidate")
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

    #[test]
    fn graph_kernel_telemetry_defaults_to_empty_maps() {
        let telemetry = GraphKernelTelemetry::default();

        assert!(telemetry.per_kernel_candidate_counts.is_empty());
        assert!(telemetry.per_kernel_errors.is_empty());
        assert!(telemetry.budget_exhausted_kernels.is_empty());
    }
}
