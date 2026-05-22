use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde::de::DeserializeOwned;
use telegram_rust_http_types::{SuccessEnvelopeDecodeError, decode_success_envelope};

use super::types::{
    BridgeCandidate, BridgeRequest, GraphKernelCandidatesResponse, GraphQueryResult,
    NeighborCandidate, NeighborRequest,
};
use super::GraphClient;

/// HTTP-based graph client implementation
#[derive(Debug, Clone)]
pub struct HttpGraphClient {
    client: reqwest::Client,
    base_url: String,
    timeout_ms: u64,
}

impl HttpGraphClient {
    pub fn new(base_url: String, timeout_ms: u64) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            timeout_ms,
        }
    }

    async fn post_candidates<TResponse, TRequest>(
        &self,
        path: &str,
        payload: &TRequest,
    ) -> Result<GraphQueryResult<TResponse>>
    where
        TResponse: DeserializeOwned,
        TRequest: Serialize + ?Sized,
    {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .header("x-internal-ops-client", "rust-recommendation")
            .timeout(std::time::Duration::from_millis(self.timeout_ms))
            .json(payload)
            .send()
            .await
            .with_context(|| format!("request graph kernel {url}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .with_context(|| format!("read graph kernel body {url}"))?;

        if !status.is_success() {
            return Err(anyhow!(
                "graph_kernel_request_failed status={} path={} body={}",
                status,
                path,
                body
            ));
        }

        let envelope: GraphKernelCandidatesResponse<TResponse> =
            decode_success_envelope(&body)
                .map_err(|e| match e {
                    SuccessEnvelopeDecodeError::Decode(err) => anyhow::Error::from(err),
                    SuccessEnvelopeDecodeError::Unsuccessful(_) => {
                        anyhow!("graph_kernel_unsuccessful path={path}")
                    }
                })
                .with_context(|| format!("parse graph kernel envelope {path}"))?;

        Ok(envelope.into_query_result())
    }
}

#[async_trait]
impl GraphClient for HttpGraphClient {
    async fn social_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.post_candidates(
            "/graph/social-neighbors",
            &NeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    async fn recent_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.post_candidates(
            "/graph/recent-engagers",
            &NeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    async fn co_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.post_candidates(
            "/graph/co-engagers",
            &NeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    async fn content_affinity_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.post_candidates(
            "/graph/content-affinity-neighbors",
            &NeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    async fn bridge_users(
        &self,
        user_id: &str,
        limit: usize,
        max_depth: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<BridgeCandidate>> {
        self.post_candidates(
            "/graph/bridge-users",
            &BridgeRequest {
                user_id: user_id.to_string(),
                limit,
                max_depth,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }
}
