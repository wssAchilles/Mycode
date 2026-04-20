use anyhow::{Context, Result, anyhow};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::config::RecommendationConfig;
use crate::contracts::{
    CandidateFilterStageResponse, CandidateStageRequest, CandidateStageResponse,
    GraphAuthorMaterializationRequest, GraphAuthorMaterializationResponse, QueryHydrateResponse,
    QueryHydratorPatchResponse, RankingResponse, RecommendationCandidatePayload,
    RecommendationQueryPayload, RetrievalResponse, SelfPostRescueRequest, SelfPostRescueResponse,
    SourceCandidatesResponse, SuccessEnvelope,
};

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
    ) -> Result<QueryHydrateResponse> {
        self.post_json("/query", query).await
    }

    pub async fn hydrate_query_patch(
        &self,
        hydrator_name: &str,
        query: &RecommendationQueryPayload,
    ) -> Result<QueryHydratorPatchResponse> {
        self.post_json(&format!("/query-hydrators/{hydrator_name}"), query)
            .await
    }

    pub async fn retrieve_candidates(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<RetrievalResponse> {
        self.post_json("/retrieval", query).await
    }

    pub async fn source_candidates(
        &self,
        source_name: &str,
        query: &RecommendationQueryPayload,
    ) -> Result<SourceCandidatesResponse> {
        self.post_json(&format!("/sources/{source_name}"), query)
            .await
    }

    pub async fn graph_author_candidates(
        &self,
        author_ids: &[String],
        limit_per_author: usize,
        lookback_days: usize,
    ) -> Result<Vec<RecommendationCandidatePayload>> {
        let response: GraphAuthorMaterializationResponse = self
            .post_json(
                "/providers/graph/authors",
                &GraphAuthorMaterializationRequest {
                    author_ids: author_ids.to_vec(),
                    limit_per_author: Some(limit_per_author),
                    lookback_days: Some(lookback_days),
                },
            )
            .await?;

        Ok(response.candidates)
    }

    pub async fn self_post_rescue_candidates(
        &self,
        user_id: &str,
        limit: usize,
        lookback_days: usize,
    ) -> Result<Vec<RecommendationCandidatePayload>> {
        let response: SelfPostRescueResponse = self
            .post_json(
                "/providers/self-posts",
                &SelfPostRescueRequest {
                    user_id: user_id.to_string(),
                    limit: Some(limit),
                    lookback_days: Some(lookback_days),
                },
            )
            .await?;

        Ok(response.candidates)
    }

    pub async fn hydrate_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<CandidateStageResponse> {
        self.post_json(
            "/hydrate",
            &CandidateStageRequest {
                query: query.clone(),
                candidates: candidates.to_vec(),
            },
        )
        .await
    }

    pub async fn filter_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<CandidateFilterStageResponse> {
        self.post_json(
            "/filter",
            &CandidateStageRequest {
                query: query.clone(),
                candidates: candidates.to_vec(),
            },
        )
        .await
    }

    pub async fn score_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<CandidateStageResponse> {
        self.post_json(
            "/score",
            &CandidateStageRequest {
                query: query.clone(),
                candidates: candidates.to_vec(),
            },
        )
        .await
    }

    pub async fn rank_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<RankingResponse> {
        self.post_json(
            "/ranking",
            &CandidateStageRequest {
                query: query.clone(),
                candidates: candidates.to_vec(),
            },
        )
        .await
    }

    pub async fn hydrate_post_selection_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<CandidateStageResponse> {
        self.post_json(
            "/post-selection/hydrate",
            &CandidateStageRequest {
                query: query.clone(),
                candidates: candidates.to_vec(),
            },
        )
        .await
    }

    pub async fn filter_post_selection_candidates(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<CandidateFilterStageResponse> {
        self.post_json(
            "/post-selection/filter",
            &CandidateStageRequest {
                query: query.clone(),
                candidates: candidates.to_vec(),
            },
        )
        .await
    }

    async fn post_json<TRequest, TResponse>(
        &self,
        path: &str,
        payload: &TRequest,
    ) -> Result<TResponse>
    where
        TRequest: Serialize + ?Sized,
        TResponse: DeserializeOwned,
    {
        let url = format!("{}{}", self.base_url, path);
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

        let envelope: SuccessEnvelope<TResponse> = serde_json::from_str(&body)
            .with_context(|| format!("parse backend recommendation envelope {path}"))?;

        if !envelope.success {
            return Err(anyhow!("backend_recommendation_unsuccessful path={path}"));
        }

        Ok(envelope.data)
    }
}
