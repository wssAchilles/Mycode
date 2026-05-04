use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    candidate::{
        CandidateNewsMetadataPayload, PhoenixScoresPayload, RecommendationCandidatePayload,
    },
    query::RecommendationQueryPayload,
};

pub const ALGORITHM_CONTRACT_VERSION: &str = "recommendation_algorithm_contract_v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlgorithmContractFixturePayload {
    pub contract_version: String,
    pub request_context: AlgorithmRequestContextPayload,
    pub candidates: Vec<AlgorithmCandidatePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlgorithmRequestContextPayload {
    pub request_id: String,
    pub user_id: String,
    pub limit: usize,
    pub in_network_only: bool,
    pub seen_ids: Vec<String>,
    pub served_ids: Vec<String>,
    #[serde(default)]
    pub user_action_sequence: Vec<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlgorithmCandidatePayload {
    pub identity: CandidateIdentityPayload,
    pub provenance: CandidateProvenancePayload,
    #[serde(default)]
    pub features: CandidateFeaturesPayload,
    #[serde(default)]
    pub phoenix_scores: PhoenixScoresPayload,
    #[serde(default)]
    pub score_metadata: ScoreMetadataPayload,
    pub weighted_score: f64,
    pub final_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateIdentityPayload {
    pub post_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    pub author_id: String,
    pub source: String,
    pub in_network: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateProvenancePayload {
    pub primary_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retrieval_lane: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interest_pool_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub secondary_sources: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_pool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CandidateFeaturesPayload {
    pub is_news: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_video: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_duration_sec: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScoreMetadataPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_contract_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_breakdown_version: Option<String>,
}

impl From<&RecommendationQueryPayload> for AlgorithmRequestContextPayload {
    fn from(query: &RecommendationQueryPayload) -> Self {
        Self {
            request_id: query.request_id.clone(),
            user_id: query.user_id.clone(),
            limit: query.limit,
            in_network_only: query.in_network_only,
            seen_ids: query.seen_ids.clone(),
            served_ids: query.served_ids.clone(),
            user_action_sequence: query.user_action_sequence.clone().unwrap_or_default(),
        }
    }
}

impl TryFrom<&RecommendationCandidatePayload> for AlgorithmCandidatePayload {
    type Error = String;

    fn try_from(candidate: &RecommendationCandidatePayload) -> Result<Self, Self::Error> {
        let source = candidate
            .recall_source
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "algorithm_contract_violation: candidate.recall_source is required".to_string()
            })?;
        let in_network = candidate.in_network.ok_or_else(|| {
            "algorithm_contract_violation: candidate.in_network is required".to_string()
        })?;
        let weighted_score = candidate.weighted_score.ok_or_else(|| {
            "algorithm_contract_violation: candidate.weighted_score is required".to_string()
        })?;
        let final_score = candidate.score.ok_or_else(|| {
            "algorithm_contract_violation: candidate.score is required".to_string()
        })?;

        Ok(Self {
            identity: CandidateIdentityPayload {
                post_id: candidate.post_id.clone(),
                external_id: resolve_external_id(candidate),
                author_id: candidate.author_id.clone(),
                source: source.to_string(),
                in_network,
            },
            provenance: CandidateProvenancePayload {
                primary_source: source.to_string(),
                retrieval_lane: trimmed_optional_string(&candidate.retrieval_lane),
                interest_pool_kind: trimmed_optional_string(&candidate.interest_pool_kind),
                secondary_sources: trimmed_string_vec(&candidate.secondary_recall_sources),
                selection_pool: trimmed_optional_string(&candidate.selection_pool),
                selection_reason: trimmed_optional_string(&candidate.selection_reason),
            },
            features: CandidateFeaturesPayload {
                is_news: candidate.is_news.unwrap_or(false),
                has_video: candidate.has_video,
                video_duration_sec: candidate.video_duration_sec,
            },
            phoenix_scores: candidate.phoenix_scores.clone().unwrap_or_default(),
            score_metadata: ScoreMetadataPayload {
                score_contract_version: trimmed_optional_string(&candidate.score_contract_version),
                score_breakdown_version: trimmed_optional_string(
                    &candidate.score_breakdown_version,
                ),
            },
            weighted_score,
            final_score,
        })
    }
}

fn resolve_external_id(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .news_metadata
        .as_ref()
        .and_then(news_external_id)
        .or_else(|| model_post_external_id(candidate))
}

fn news_external_id(news: &CandidateNewsMetadataPayload) -> Option<String> {
    news.external_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn model_post_external_id(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .model_post_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != candidate.post_id)
        .map(ToOwned::to_owned)
}

fn trimmed_optional_string(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn trimmed_string_vec(values: &Option<Vec<String>>) -> Vec<String> {
    values
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    const SAMPLE: &str = include_str!("../../tests/fixtures/algorithm_contract_sample.json");

    #[test]
    fn parses_shared_algorithm_contract_fixture() {
        let payload: AlgorithmContractFixturePayload =
            serde_json::from_str(SAMPLE).expect("parse algorithm contract fixture");

        assert_eq!(payload.contract_version, ALGORITHM_CONTRACT_VERSION);
        assert_eq!(
            payload.request_context.request_id,
            "req-algorithm-contract-1"
        );
        assert_eq!(payload.request_context.seen_ids, vec!["post-seen-1"]);
        assert_eq!(payload.request_context.served_ids, vec!["post-served-1"]);
        assert_eq!(payload.request_context.user_action_sequence.len(), 1);
        assert_eq!(payload.candidates.len(), 2);

        let oon = &payload.candidates[0];
        assert_eq!(oon.identity.post_id, "507f191e810c19729de8c001");
        assert_eq!(oon.identity.external_id.as_deref(), Some("N12345"));
        assert_eq!(oon.identity.source, "TwoTowerSource");
        assert!(!oon.identity.in_network);
        assert_eq!(oon.provenance.primary_source, "TwoTowerSource");
        assert_eq!(oon.provenance.retrieval_lane.as_deref(), Some("oon_ml"));
        assert_eq!(
            oon.provenance.secondary_sources,
            vec!["NewsAnnSource".to_string()]
        );
        assert!(oon.features.is_news);
        assert_eq!(oon.phoenix_scores.like_score, Some(0.42));
        assert_eq!(
            oon.score_metadata.score_contract_version.as_deref(),
            Some("score_contract_v1")
        );
        assert_eq!(oon.weighted_score, 1.734);
        assert_eq!(oon.final_score, 1.561);

        let in_network = &payload.candidates[1];
        assert_eq!(in_network.identity.source, "FollowingSource");
        assert!(in_network.identity.in_network);
        assert_eq!(in_network.identity.external_id, None);
        assert_eq!(
            in_network.phoenix_scores.video_quality_view_score,
            Some(0.52)
        );
    }

    #[test]
    fn projects_existing_boundary_payloads_into_algorithm_contract() {
        let mut action = HashMap::new();
        action.insert("actionType".to_string(), serde_json::json!("like"));
        action.insert(
            "targetPostId".to_string(),
            serde_json::json!("post-history-1"),
        );
        let query = RecommendationQueryPayload {
            request_id: "req-boundary-1".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 2,
            cursor: None,
            in_network_only: false,
            seen_ids: vec!["post-seen-1".to_string()],
            served_ids: vec!["post-served-1".to_string()],
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: Some(vec![action]),
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };
        let candidate = recommendation_candidate_fixture();

        let context = AlgorithmRequestContextPayload::from(&query);
        let projected = AlgorithmCandidatePayload::try_from(&candidate)
            .expect("project recommendation candidate");

        assert_eq!(context.user_action_sequence.len(), 1);
        assert_eq!(projected.identity.post_id, "507f191e810c19729de8c001");
        assert_eq!(projected.identity.external_id.as_deref(), Some("N12345"));
        assert_eq!(projected.identity.source, "TwoTowerSource");
        assert!(!projected.identity.in_network);
        assert_eq!(projected.provenance.primary_source, "TwoTowerSource");
        assert_eq!(
            projected.provenance.retrieval_lane.as_deref(),
            Some("oon_ml")
        );
        assert_eq!(
            projected.provenance.secondary_sources,
            vec!["NewsAnnSource".to_string()]
        );
        assert_eq!(
            projected.provenance.selection_pool.as_deref(),
            Some("ranked_pool")
        );
        assert!(projected.features.is_news);
        assert_eq!(projected.phoenix_scores.like_score, Some(0.42));
        assert_eq!(
            projected.score_metadata.score_contract_version.as_deref(),
            Some("score_contract_v1")
        );
        assert_eq!(projected.weighted_score, 1.734);
        assert_eq!(projected.final_score, 1.561);
    }

    #[test]
    fn rejects_boundary_candidates_without_source_lane_or_scores() {
        let mut candidate = recommendation_candidate_fixture();
        candidate.recall_source = None;
        assert!(
            AlgorithmCandidatePayload::try_from(&candidate)
                .expect_err("missing source should be rejected")
                .contains("recall_source")
        );

        let mut candidate = recommendation_candidate_fixture();
        candidate.in_network = None;
        assert!(
            AlgorithmCandidatePayload::try_from(&candidate)
                .expect_err("missing lane should be rejected")
                .contains("in_network")
        );

        let mut candidate = recommendation_candidate_fixture();
        candidate.weighted_score = None;
        assert!(
            AlgorithmCandidatePayload::try_from(&candidate)
                .expect_err("missing weighted score should be rejected")
                .contains("weighted_score")
        );
    }

    fn recommendation_candidate_fixture() -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "507f191e810c19729de8c001".to_string(),
            model_post_id: Some("N12345".to_string()),
            author_id: "author-1".to_string(),
            content: "candidate".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 5, 3, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("TwoTowerSource".to_string()),
            retrieval_lane: Some("oon_ml".to_string()),
            interest_pool_kind: Some("ann_pool".to_string()),
            secondary_recall_sources: Some(vec!["NewsAnnSource".to_string(), "  ".to_string()]),
            has_video: Some(false),
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: Some(PhoenixScoresPayload {
                like_score: Some(0.42),
                click_score: Some(0.63),
                ..Default::default()
            }),
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: Some("ranked_pool".to_string()),
            selection_reason: Some("weighted_score".to_string()),
            score_contract_version: Some("score_contract_v1".to_string()),
            score_breakdown_version: Some("score_breakdown_v1".to_string()),
            weighted_score: Some(1.734),
            score: Some(1.561),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: Some(true),
            news_metadata: Some(CandidateNewsMetadataPayload {
                external_id: Some("N12345".to_string()),
                ..Default::default()
            }),
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }
}
