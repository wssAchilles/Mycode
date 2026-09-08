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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude_post_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfPostRescueResponse {
    pub candidates: Vec<RecommendationCandidatePayload>,
}

#[cfg(test)]
mod tests {
    use super::SelfPostRescueRequest;

    #[test]
    fn rescue_request_serializes_exclusion_ids_in_camel_case() {
        let value = serde_json::to_value(SelfPostRescueRequest {
            user_id: "user-1".to_string(),
            limit: Some(5),
            lookback_days: Some(180),
            exclude_post_ids: vec!["post-1".to_string()],
        })
        .expect("serialize self post rescue request");

        assert_eq!(value["excludePostIds"][0], "post-1");
        assert!(value.get("exclude_post_ids").is_none());
    }
}
