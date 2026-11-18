use anyhow::{Context, Result, anyhow};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::time::Instant;
pub use telegram_rust_http_types::ProviderResponse;
use telegram_rust_http_types::{SuccessEnvelopeDecodeError, decode_success_envelope};
use telegram_serving_primitives::SELF_POST_RESCUE_PROVIDER_PATH;

use crate::clients::deadline::{
    RECOMMENDATION_DEADLINE_HEADER, RequestDeadline, current_request_deadline,
    resolve_single_stage_cap_ms,
};
use crate::clients::response_body::{
    ResponseBodyError, error_body_preview, read_response_body_bounded,
};
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
    single_stage_cap_ms: u64,
    deadline_override: Option<RequestDeadline>,
}

impl BackendRecommendationClient {
    pub fn new(config: &RecommendationConfig) -> Result<Self> {
        let single_stage_cap_ms = resolve_single_stage_cap_ms(config.timeout_ms);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(single_stage_cap_ms))
            .build()
            .context("build backend recommendation reqwest client")?;

        Ok(Self {
            client,
            base_url: config.backend_url.trim_end_matches('/').to_string(),
            token: config.internal_token.clone(),
            single_stage_cap_ms,
            deadline_override: None,
        })
    }

    /// 绑定显式请求级截止预算，支撑跨 `tokio::spawn` / `JoinSet` 子任务传播。
    pub fn with_deadline(&self, deadline: Option<RequestDeadline>) -> Self {
        let mut cloned = self.clone();
        cloned.deadline_override = deadline;
        cloned
    }

    /// 捕获当前异步任务上下文的 `RequestDeadline` 并固化到克隆客户端实例上。
    pub fn with_current_deadline(&self) -> Self {
        self.with_deadline(self.active_deadline())
    }

    /// 获取当前生效的请求截止上下文（优先使用显式绑定值，其次读取 task-local）。
    pub fn active_deadline(&self) -> Option<RequestDeadline> {
        self.deadline_override.or_else(current_request_deadline)
    }

    /// 判断当前请求剩余预算是否已耗尽（`< 150ms`），用于跳过拆单重试与低优回退调用。
    pub fn is_deadline_exhausted(&self) -> bool {
        self.active_deadline()
            .is_some_and(|deadline| deadline.is_exhausted())
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
        self.graph_author_candidates_with_cursor(author_ids, limit_per_author, lookback_days, None)
            .await
    }

    pub async fn graph_author_candidates_with_cursor(
        &self,
        author_ids: &[String],
        limit_per_author: usize,
        lookback_days: usize,
        created_before: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<ProviderResponse<GraphAuthorMaterializationResponse>> {
        self.post_json(
            "/providers/graph/authors",
            &GraphAuthorMaterializationRequest {
                author_ids: author_ids.to_vec(),
                limit_per_author: Some(limit_per_author),
                lookback_days: Some(lookback_days),
                created_before,
            },
        )
        .await
    }

    pub async fn self_post_rescue_candidates(
        &self,
        user_id: &str,
        limit: usize,
        lookback_days: usize,
        exclude_post_ids: &[String],
    ) -> Result<ProviderResponse<SelfPostRescueResponse>> {
        self.post_json(
            SELF_POST_RESCUE_PROVIDER_PATH,
            &SelfPostRescueRequest {
                user_id: user_id.to_string(),
                limit: Some(limit),
                lookback_days: Some(lookback_days),
                exclude_post_ids: exclude_post_ids.to_vec(),
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
        let active_deadline = self.active_deadline();
        let per_call_timeout_ms = if let Some(deadline) = active_deadline {
            let Some(timeout_ms) = deadline.per_call_timeout_ms() else {
                return Err(anyhow!(
                    "backend_recommendation_deadline_exceeded path={} remaining_ms={}",
                    path,
                    deadline.remaining_ms()
                ));
            };
            timeout_ms.min(self.single_stage_cap_ms)
        } else {
            self.single_stage_cap_ms
        };

        let url = format!("{}{}", self.base_url, path);
        let request_started_at = Instant::now();
        let mut request = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .timeout(std::time::Duration::from_millis(per_call_timeout_ms))
            .json(payload);

        if let Some(deadline) = active_deadline {
            request = request.header(
                RECOMMENDATION_DEADLINE_HEADER,
                deadline.deadline_epoch_ms().to_string(),
            );
        }

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
        let body = match read_response_body_bounded(response).await {
            Ok(body) => body,
            Err(error @ ResponseBodyError::TooLarge { .. }) if !status.is_success() => {
                return Err(anyhow!(
                    "backend_recommendation_request_failed status={} path={} body={}",
                    status,
                    path,
                    error_body_preview(&error.to_string())
                ));
            }
            Err(error) => Err(error)
                .with_context(|| format!("read backend recommendation adapter body {url}"))?,
        };

        if !status.is_success() {
            return Err(anyhow!(
                "backend_recommendation_request_failed status={} path={} body={}",
                status,
                path,
                error_body_preview(&body)
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
