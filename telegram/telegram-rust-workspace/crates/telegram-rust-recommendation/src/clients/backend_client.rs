use anyhow::{Context, Result, anyhow};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::time::Instant;
pub use telegram_rust_http_types::ProviderResponse;
use telegram_rust_http_types::{SuccessEnvelopeDecodeError, decode_success_envelope};
use telegram_serving_primitives::SELF_POST_RESCUE_PROVIDER_PATH;

use crate::config::RecommendationConfig;
use crate::contracts::{
    CandidateFilterStageResponse, CandidateStageResponse, GraphAuthorMaterializationRequest,
    GraphAuthorMaterializationResponse, QueryHydrateResponse, QueryHydratorBatchResponse,
    QueryHydratorPatchResponse, RankingResponse, RecommendationCandidatePayload,
    RecommendationQueryPayload, RetrievalResponse, SelfPostRescueRequest, SelfPostRescueResponse,
    SourceBatchResponse, SourceCandidatesResponse,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryHydratorBatchRequestRef<'a> {
    hydrator_names: &'a [String],
    query: &'a RecommendationQueryPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceBatchRequestRef<'a> {
    source_names: &'a [String],
    query: &'a RecommendationQueryPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateStageRequestRef<'a> {
    query: &'a RecommendationQueryPayload,
    candidates: &'a [RecommendationCandidatePayload],
    #[serde(skip_serializing_if = "Option::is_none")]
    component_names: Option<&'a [String]>,
}

#[derive(Debug, Clone)]
pub struct BackendRecommendationClient {
    client: reqwest::Client,
    base_url: String,
    token: Option<String>,
}

impl BackendRecommendationClient {
    pub fn new(config: &RecommendationConfig) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(config.timeout_ms))
            .build()
            .context("build backend recommendation reqwest client")?;

        Ok(Self {
            client,
            base_url: config.backend_url.trim_end_matches('/').to_string(),
            token: config.internal_token.clone(),
        })
    }

    pub async fn hydrate_query(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<ProviderResponse<QueryHydrateResponse>> {
        self.post_json("/query", query).await
    }

    pub async fn hydrate_query_patch(
        &self,
        hydrator_name: &str,
        query: &RecommendationQueryPayload,
    ) -> Result<ProviderResponse<QueryHydratorPatchResponse>> {
        self.post_json(&format!("/query-hydrators/{hydrator_name}"), query)
            .await
    }

    pub async fn hydrate_query_patches_batch(
        &self,
        hydrator_names: &[String],
        query: &RecommendationQueryPayload,
    ) -> Result<ProviderResponse<QueryHydratorBatchResponse>> {
        self.post_json(
            "/query-hydrators/batch",
            &QueryHydratorBatchRequestRef {
                hydrator_names,
                query,
            },
        )
        .await
    }

    pub async fn retrieve_candidates(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<ProviderResponse<RetrievalResponse>> {
        self.post_json("/retrieval", query).await
    }

    pub async fn source_candidates(
        &self,
        source_name: &str,
        query: &RecommendationQueryPayload,
    ) -> Result<ProviderResponse<SourceCandidatesResponse>> {
        self.post_json(&format!("/sources/{source_name}"), query)
            .await
    }

    pub async fn source_candidates_batch(
        &self,
        source_names: &[String],
        query: &RecommendationQueryPayload,
    ) -> Result<ProviderResponse<SourceBatchResponse>> {
        self.post_json(
            "/sources/batch",
            &SourceBatchRequestRef {
                source_names,
                query,
            },
        )
        .await
    }

    pub async fn graph_author_candidates(
        &self,
        author_ids: &[String],
        limit_per_author: usize,
        lookback_days: usize,
    ) -> Result<ProviderResponse<GraphAuthorMaterializationResponse>> {
        self.post_json(
            "/providers/graph/authors",
            &GraphAuthorMaterializationRequest {
                author_ids: author_ids.to_vec(),
                limit_per_author: Some(limit_per_author),
                lookback_days: Some(lookback_days),
            },
        )
        .await
    }

    pub async fn self_post_rescue_candidates(
        &self,
        user_id: &str,
        limit: usize,
        lookback_days: usize,
    ) -> Result<ProviderResponse<SelfPostRescueResponse>> {
        self.post_json(
            SELF_POST_RESCUE_PROVIDER_PATH,
            &SelfPostRescueRequest {
                user_id: user_id.to_string(),
                limit: Some(limit),
                lookback_days: Some(lookback_days),
            },
        )
        .await
    }

    pub async fn hydrate_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<ProviderResponse<CandidateStageResponse>> {
        self.hydrate_candidates_with_components(query, candidates, None)
            .await
    }

    pub async fn hydrate_candidates_with_components(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
        component_names: Option<Vec<String>>,
    ) -> Result<ProviderResponse<CandidateStageResponse>> {
        self.post_json(
            "/hydrate",
            &CandidateStageRequestRef {
                query,
                candidates,
                component_names: component_names.as_deref(),
            },
        )
        .await
    }

    pub async fn filter_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<ProviderResponse<CandidateFilterStageResponse>> {
        self.post_json(
            "/filter",
            &CandidateStageRequestRef {
                query,
                candidates,
                component_names: None,
            },
        )
        .await
    }

    pub async fn score_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<ProviderResponse<CandidateStageResponse>> {
        self.score_candidates_with_components(query, candidates, None)
            .await
    }

    pub async fn score_candidates_with_components(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
        component_names: Option<Vec<String>>,
    ) -> Result<ProviderResponse<CandidateStageResponse>> {
        self.post_json(
            "/score",
            &CandidateStageRequestRef {
                query,
                candidates,
                component_names: component_names.as_deref(),
            },
        )
        .await
    }

    pub async fn rank_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<ProviderResponse<RankingResponse>> {
        self.post_json(
            "/ranking",
            &CandidateStageRequestRef {
                query,
                candidates,
                component_names: None,
            },
        )
        .await
    }

    pub async fn hydrate_post_selection_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<ProviderResponse<CandidateStageResponse>> {
        self.hydrate_post_selection_candidates_with_components(query, candidates, None)
            .await
    }

    pub async fn hydrate_post_selection_candidates_with_components(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
        component_names: Option<Vec<String>>,
    ) -> Result<ProviderResponse<CandidateStageResponse>> {
        self.post_json(
            "/post-selection/hydrate",
            &CandidateStageRequestRef {
                query,
                candidates,
                component_names: component_names.as_deref(),
            },
        )
        .await
    }

    pub async fn filter_post_selection_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<ProviderResponse<CandidateFilterStageResponse>> {
        self.post_json(
            "/post-selection/filter",
            &CandidateStageRequestRef {
                query,
                candidates,
                component_names: None,
            },
        )
        .await
    }

    async fn post_json<TRequest, TResponse>(
        &self,
        path: &str,
        payload: &TRequest,
    ) -> Result<ProviderResponse<TResponse>>
    where
        TRequest: Serialize + ?Sized,
        TResponse: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);
        let request_started_at = Instant::now();
        let mut request = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(payload);

        if let Some(token) = self.token.as_ref().filter(|value| !value.trim().is_empty()) {
            request = request
                .header("x-recommendation-internal-token", token)
                .header(AUTHORIZATION, format!("Bearer {token}"));
        }

        let response = request
            .send()
            .await
            .with_context(|| format!("request backend recommendation adapter {url}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .with_context(|| format!("read backend recommendation adapter body {url}"))?;

        if !status.is_success() {
            return Err(anyhow!(
                "backend_recommendation_request_failed status={} path={} body={}",
                status,
                path,
                body
            ));
        }

        let payload = match decode_success_envelope(&body) {
            Ok(payload) => payload,
            Err(SuccessEnvelopeDecodeError::Decode(error)) => {
                return Err(error)
                    .with_context(|| format!("parse backend recommendation envelope {path}"));
            }
            Err(SuccessEnvelopeDecodeError::Unsuccessful(_)) => {
                return Err(anyhow!("backend_recommendation_unsuccessful path={path}"));
            }
        };

        Ok(ProviderResponse {
            payload,
            latency_ms: request_started_at.elapsed().as_millis() as u64,
        })
    }
}
