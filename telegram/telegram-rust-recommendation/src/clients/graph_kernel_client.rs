use anyhow::{Context, Result, anyhow};
use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::config::RecommendationConfig;
use crate::contracts::SuccessEnvelope;

#[derive(Debug, Clone)]
pub struct GraphKernelClient {
    client: reqwest::Client,
    base_url: String,
    timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphKernelNeighborRequest {
    user_id: String,
    limit: usize,
    exclude_user_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphKernelBridgeRequest {
    user_id: String,
    limit: usize,
    max_depth: usize,
    exclude_user_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphKernelCandidatesResponse<T> {
    candidates: Option<Vec<T>>,
}

impl GraphKernelClient {
    pub fn from_config(config: &RecommendationConfig) -> Option<Self> {
        if !config.graph_kernel_enabled {
            return None;
        }

        Some(Self {
            client: reqwest::Client::new(),
            base_url: config.graph_kernel_url.trim_end_matches('/').to_string(),
            timeout_ms: config.graph_kernel_timeout_ms,
        })
    }

    pub async fn social_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<Vec<GraphKernelNeighborCandidate>> {
        self.post_candidates(
            "/graph/social-neighbors",
            &GraphKernelNeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    pub async fn recent_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<Vec<GraphKernelNeighborCandidate>> {
        self.post_candidates(
            "/graph/recent-engagers",
            &GraphKernelNeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    pub async fn co_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<Vec<GraphKernelNeighborCandidate>> {
        self.post_candidates(
            "/graph/co-engagers",
            &GraphKernelNeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    pub async fn content_affinity_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<Vec<GraphKernelNeighborCandidate>> {
        self.post_candidates(
            "/graph/content-affinity-neighbors",
            &GraphKernelNeighborRequest {
                user_id: user_id.to_string(),
                limit,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    pub async fn bridge_users(
        &self,
        user_id: &str,
        limit: usize,
        max_depth: usize,
        exclude_user_ids: &[String],
    ) -> Result<Vec<GraphKernelBridgeCandidate>> {
        self.post_candidates(
            "/graph/bridge-users",
            &GraphKernelBridgeRequest {
                user_id: user_id.to_string(),
                limit,
                max_depth,
                exclude_user_ids: exclude_user_ids.to_vec(),
            },
        )
        .await
    }

    async fn post_candidates<TResponse, TRequest>(
        &self,
        path: &str,
        payload: &TRequest,
    ) -> Result<Vec<TResponse>>
    where
        TResponse: DeserializeOwned,
        TRequest: Serialize + ?Sized,
    {
        let response: GraphKernelCandidatesResponse<TResponse> =
            self.post_json(path, payload).await?;
        Ok(response.candidates.unwrap_or_default())
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

        let envelope: SuccessEnvelope<TResponse> = serde_json::from_str(&body)
            .with_context(|| format!("parse graph kernel envelope {path}"))?;

        if !envelope.success {
            return Err(anyhow!("graph_kernel_unsuccessful path={path}"));
        }

        Ok(envelope.data)
    }
}
