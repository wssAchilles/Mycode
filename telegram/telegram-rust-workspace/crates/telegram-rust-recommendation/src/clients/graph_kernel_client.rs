use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::Arc;

use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde::de::DeserializeOwned;
use telegram_rust_http_types::{SuccessEnvelopeDecodeError, decode_success_envelope};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::clients::response_body::{
    ResponseBodyError, error_body_preview, read_response_body_bounded,
};
use crate::config::RecommendationConfig;
use crate::contracts::{
    GraphKernelBatchRequest, GraphKernelBatchResponse, GraphKernelBridgeCandidate,
    GraphKernelBridgeRequest, GraphKernelCandidatesResponse, GraphKernelNeighborCandidate,
    GraphKernelNeighborRequest, GraphKernelQueryResult,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphKernelBatchMode {
    Disabled,
    ShadowCompare,
}

impl GraphKernelBatchMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("shadow" | "compare" | "shadow_compare") => Self::ShadowCompare,
            _ => Self::Disabled,
        }
    }
}

const DEFAULT_GRAPH_KERNEL_BATCH_SHADOW_MAX_IN_FLIGHT: usize = 2;

fn graph_kernel_batch_shadow_max_in_flight(value: Option<&str>) -> usize {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_GRAPH_KERNEL_BATCH_SHADOW_MAX_IN_FLIGHT)
}

#[derive(Debug, Clone)]
pub enum GraphKernelError {
    Timeout {
        path: String,
    },
    HttpStatus {
        path: String,
        status: reqwest::StatusCode,
        body: String,
    },
    Decode {
        path: String,
        source: String,
    },
    Contract {
        path: String,
        reason: String,
    },
    Unavailable {
        path: String,
        source: String,
    },
}

impl GraphKernelError {
    pub fn class(&self) -> &'static str {
        match self {
            Self::Timeout { .. } => "timeout",
            Self::HttpStatus { .. } => "http_status",
            Self::Decode { .. } => "decode",
            Self::Contract { .. } => "contract",
            Self::Unavailable { .. } => "unavailable",
        }
    }
}

impl Display for GraphKernelError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Timeout { path } => {
                write!(formatter, "graph_kernel_error class=timeout path={path}")
            }
            Self::HttpStatus { path, status, body } => write!(
                formatter,
                "graph_kernel_error class=http_status path={path} status={status} body={body}"
            ),
            Self::Decode { path, source } => write!(
                formatter,
                "graph_kernel_error class=decode path={path} source={source}"
            ),
            Self::Contract { path, reason } => write!(
                formatter,
                "graph_kernel_error class=contract path={path} reason={reason}"
            ),
            Self::Unavailable { path, source } => write!(
                formatter,
                "graph_kernel_error class=unavailable path={path} source={source}"
            ),
        }
    }
}

impl Error for GraphKernelError {}

#[derive(Debug, Clone)]
pub struct GraphKernelClient {
    client: reqwest::Client,
    base_url: String,
    timeout_ms: u64,
    batch_mode: GraphKernelBatchMode,
    batch_shadow_admission: Option<Arc<Semaphore>>,
}

impl GraphKernelClient {
    pub fn from_config(config: &RecommendationConfig) -> Option<Self> {
        if !config.graph_kernel_enabled {
            return None;
        }

        Some(
            Self::new(
                config.graph_kernel_url.trim_end_matches('/').to_string(),
                config.graph_kernel_timeout_ms,
            )
            .with_batch_mode(GraphKernelBatchMode::parse(
                std::env::var("CPP_GRAPH_KERNEL_BATCH_MODE").ok().as_deref(),
            )),
        )
    }

    pub(crate) fn new(base_url: String, timeout_ms: u64) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
            timeout_ms,
            batch_mode: GraphKernelBatchMode::Disabled,
            batch_shadow_admission: None,
        }
    }

    pub(crate) fn with_batch_mode(mut self, batch_mode: GraphKernelBatchMode) -> Self {
        self.batch_mode = batch_mode;
        self.batch_shadow_admission = match batch_mode {
            GraphKernelBatchMode::Disabled => None,
            GraphKernelBatchMode::ShadowCompare => Some(Arc::new(Semaphore::new(
                graph_kernel_batch_shadow_max_in_flight(
                    std::env::var("CPP_GRAPH_KERNEL_BATCH_SHADOW_MAX_IN_FLIGHT")
                        .ok()
                        .as_deref(),
                ),
            ))),
        };
        self
    }

    #[cfg(test)]
    pub(crate) fn with_batch_shadow_max_in_flight(mut self, max_in_flight: usize) -> Self {
        self.batch_shadow_admission = Some(Arc::new(Semaphore::new(max_in_flight)));
        self
    }

    pub(crate) fn batch_mode(&self) -> GraphKernelBatchMode {
        self.batch_mode
    }

    pub(crate) fn try_acquire_batch_shadow(&self) -> Option<OwnedSemaphorePermit> {
        self.batch_shadow_admission
            .as_ref()?
            .clone()
            .try_acquire_owned()
            .ok()
    }

    pub async fn batch(
        &self,
        user_id: &str,
        direct_limit: usize,
        bridge_limit: usize,
        max_depth: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphKernelBatchResponse, GraphKernelError> {
        let response: GraphKernelBatchResponse = self
            .post_json(
                "/graph/batch",
                &GraphKernelBatchRequest {
                    user_id: user_id.to_string(),
                    direct_limit,
                    bridge_limit,
                    max_depth,
                    exclude_user_ids: exclude_user_ids.to_vec(),
                },
            )
            .await?;
        response
            .validate()
            .map_err(|reason| GraphKernelError::Contract {
                path: "/graph/batch".to_string(),
                reason,
            })?;
        if response.user_id != user_id {
            return Err(GraphKernelError::Contract {
                path: "/graph/batch".to_string(),
                reason: "response_user_id_mismatch".to_string(),
            });
        }
        Ok(response)
    }

    pub async fn social_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphKernelQueryResult<GraphKernelNeighborCandidate>, GraphKernelError> {
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
    ) -> Result<GraphKernelQueryResult<GraphKernelNeighborCandidate>, GraphKernelError> {
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
    ) -> Result<GraphKernelQueryResult<GraphKernelNeighborCandidate>, GraphKernelError> {
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
    ) -> Result<GraphKernelQueryResult<GraphKernelNeighborCandidate>, GraphKernelError> {
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
    ) -> Result<GraphKernelQueryResult<GraphKernelBridgeCandidate>, GraphKernelError> {
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
    ) -> Result<GraphKernelQueryResult<TResponse>, GraphKernelError>
    where
        TResponse: DeserializeOwned,
        TRequest: Serialize + ?Sized,
    {
        let response: GraphKernelCandidatesResponse<TResponse> =
            self.post_json(path, payload).await?;
        if response.candidates.is_none() {
            return Err(GraphKernelError::Contract {
                path: path.to_string(),
                reason: "missing_candidates".to_string(),
            });
        }
        Ok(response.into_query_result())
    }

    async fn post_json<TRequest, TResponse>(
        &self,
        path: &str,
        payload: &TRequest,
    ) -> Result<TResponse, GraphKernelError>
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
            .map_err(|error| {
                if error.is_timeout() {
                    GraphKernelError::Timeout {
                        path: path.to_string(),
                    }
                } else {
                    GraphKernelError::Unavailable {
                        path: path.to_string(),
                        source: format!("request {url}: {error}"),
                    }
                }
            })?;
        let status = response.status();
        let body = match read_response_body_bounded(response).await {
            Ok(body) => body,
            Err(error @ ResponseBodyError::TooLarge { .. }) if !status.is_success() => {
                return Err(GraphKernelError::HttpStatus {
                    path: path.to_string(),
                    status,
                    body: error_body_preview(&error.to_string()),
                });
            }
            Err(error) => {
                if error.is_timeout() {
                    return Err(GraphKernelError::Timeout {
                        path: path.to_string(),
                    });
                }
                return Err(GraphKernelError::Unavailable {
                    path: path.to_string(),
                    source: format!("read body {url}: {error}"),
                });
            }
        };

        if !status.is_success() {
            return Err(GraphKernelError::HttpStatus {
                path: path.to_string(),
                status,
                body: error_body_preview(&body),
            });
        }

        match decode_success_envelope(&body) {
            Ok(payload) => Ok(payload),
            Err(SuccessEnvelopeDecodeError::Decode(error)) => Err(GraphKernelError::Decode {
                path: path.to_string(),
                source: error.to_string(),
            }),
            Err(SuccessEnvelopeDecodeError::Unsuccessful(_)) => Err(GraphKernelError::Contract {
                path: path.to_string(),
                reason: "unsuccessful_envelope".to_string(),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{GraphKernelBatchMode, GraphKernelClient, GraphKernelError};

    async fn spawn_graph_response_server(
        status: &str,
        body: &'static str,
        delay_ms: u64,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let status = status.to_string();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept graph request");
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer).await;
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
        format!("http://{address}")
    }

    async fn spawn_declared_length_graph_response(status: &str, declared_length: usize) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let status = status.to_string();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept graph request");
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer).await;
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {declared_length}\r\nconnection: close\r\n\r\n"
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
        format!("http://{address}")
    }

    async fn spawn_delayed_body_graph_response(delay_ms: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept graph request");
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer).await;
            let response = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\nconnection: close\r\n\r\n";
            let _ = stream.write_all(response.as_bytes()).await;
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            let _ = stream.write_all(b"{}").await;
        });
        format!("http://{address}")
    }

    fn client(base_url: String, timeout_ms: u64) -> GraphKernelClient {
        GraphKernelClient::new(base_url, timeout_ms)
    }

    #[test]
    fn graph_kernel_batch_mode_defaults_to_disabled() {
        assert_eq!(
            GraphKernelBatchMode::parse(None),
            GraphKernelBatchMode::Disabled
        );
        assert_eq!(
            GraphKernelBatchMode::parse(Some("shadow")),
            GraphKernelBatchMode::ShadowCompare
        );
        assert_eq!(
            GraphKernelBatchMode::parse(Some("compare")),
            GraphKernelBatchMode::ShadowCompare
        );
        assert!(
            GraphKernelClient::new("http://graph-kernel".to_string(), 1_000)
                .try_acquire_batch_shadow()
                .is_none()
        );
    }

    #[test]
    fn graph_kernel_batch_shadow_admission_is_shared_and_released_on_drop() {
        let client = GraphKernelClient::new("http://graph-kernel".to_string(), 1_000)
            .with_batch_mode(GraphKernelBatchMode::ShadowCompare)
            .with_batch_shadow_max_in_flight(1);
        let cloned = client.clone();

        let permit = client
            .try_acquire_batch_shadow()
            .expect("acquire first batch shadow permit");
        assert!(cloned.try_acquire_batch_shadow().is_none());

        drop(permit);
        assert!(cloned.try_acquire_batch_shadow().is_some());
    }

    #[tokio::test]
    async fn calls_graph_kernel_batch_contract() {
        let base_url = spawn_graph_response_server(
            "200 OK",
            r#"{"success":true,"data":{"userId":"viewer","snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"socialNeighbors":{"candidates":[],"diagnostics":{"kernel":"social_neighbors","queryDurationMs":1,"candidateCount":0,"requestedLimit":48,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_social_neighbors","relationKinds":[]}},"recentEngagers":{"candidates":[],"diagnostics":{"kernel":"recent_engagers","queryDurationMs":1,"candidateCount":0,"requestedLimit":48,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_recent_engagers","relationKinds":[]}},"bridgeUsers":{"candidates":[],"diagnostics":{"kernel":"bridge_users","queryDurationMs":1,"candidateCount":0,"requestedLimit":100,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_bridge_users","relationKinds":[]}},"coEngagers":{"candidates":[],"diagnostics":{"kernel":"co_engagers","queryDurationMs":1,"candidateCount":0,"requestedLimit":48,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_co_engagers","relationKinds":[]}},"contentAffinityNeighbors":{"candidates":[],"diagnostics":{"kernel":"content_affinity_neighbors","queryDurationMs":1,"candidateCount":0,"requestedLimit":48,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_content_affinity_neighbors","relationKinds":[]}}}}"#,
            0,
        )
        .await;

        let response = client(base_url, 1_000)
            .batch("viewer", 48, 100, 3, &[])
            .await
            .expect("batch graph response");

        assert_eq!(response.snapshot_version, "snapshot-v7");
        assert_eq!(response.snapshot_loaded_at_ms, 1_783_278_000_000);
    }

    #[tokio::test]
    async fn rejects_graph_kernel_batch_response_for_another_user() {
        let base_url = spawn_graph_response_server(
            "200 OK",
            r#"{"success":true,"data":{"userId":"other-viewer","snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"socialNeighbors":{"candidates":[],"diagnostics":{"kernel":"social_neighbors","queryDurationMs":1,"candidateCount":0,"requestedLimit":1,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_social_neighbors","relationKinds":[]}},"recentEngagers":{"candidates":[],"diagnostics":{"kernel":"recent_engagers","queryDurationMs":1,"candidateCount":0,"requestedLimit":1,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_recent_engagers","relationKinds":[]}},"bridgeUsers":{"candidates":[],"diagnostics":{"kernel":"bridge_users","queryDurationMs":1,"candidateCount":0,"requestedLimit":1,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_bridge_users","relationKinds":[]}},"coEngagers":{"candidates":[],"diagnostics":{"kernel":"co_engagers","queryDurationMs":1,"candidateCount":0,"requestedLimit":1,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_co_engagers","relationKinds":[]}},"contentAffinityNeighbors":{"candidates":[],"diagnostics":{"kernel":"content_affinity_neighbors","queryDurationMs":1,"candidateCount":0,"requestedLimit":1,"availableCount":0,"truncatedCount":0,"scannedCount":0,"visitedCount":0,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"prunedCount":0,"frontierMaxSize":0,"budgetExhausted":false,"empty":true,"emptyReason":"no_content_affinity_neighbors","relationKinds":[]}}}}"#,
            0,
        )
        .await;

        let error = client(base_url, 1_000)
            .batch("viewer", 1, 1, 1, &[])
            .await
            .expect_err("reject mismatched batch response identity");

        assert!(matches!(error, GraphKernelError::Contract { .. }));
        assert!(error.to_string().contains("response_user_id_mismatch"));
    }

    #[tokio::test]
    async fn classifies_graph_kernel_http_status_error() {
        let base_url =
            spawn_graph_response_server("503 Service Unavailable", r#"{"error":"down"}"#, 0).await;

        let error = client(base_url, 1_000)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("status error");

        assert!(matches!(error, GraphKernelError::HttpStatus { .. }));
        assert_eq!(error.class(), "http_status");
    }

    #[tokio::test]
    async fn classifies_oversized_graph_kernel_body_as_unavailable() {
        let base_url = spawn_declared_length_graph_response(
            "200 OK",
            super::super::response_body::MAX_RESPONSE_BODY_BYTES + 1,
        )
        .await;

        let error = client(base_url, 1_000)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("oversized response body");

        assert!(matches!(error, GraphKernelError::Unavailable { .. }));
        assert_eq!(error.class(), "unavailable");
        assert!(error.to_string().contains("response body exceeds"));
    }

    #[tokio::test]
    async fn preserves_graph_kernel_http_status_for_oversized_error_body() {
        let base_url = spawn_declared_length_graph_response(
            "503 Service Unavailable",
            super::super::response_body::MAX_RESPONSE_BODY_BYTES + 1,
        )
        .await;

        let error = client(base_url, 1_000)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("oversized error response body");

        assert!(matches!(error, GraphKernelError::HttpStatus { .. }));
        assert_eq!(error.class(), "http_status");
        assert!(error.to_string().contains("response body exceeds"));
    }

    #[tokio::test]
    async fn classifies_graph_kernel_body_read_timeout() {
        let base_url = spawn_delayed_body_graph_response(100).await;

        let error = client(base_url, 10)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("body read timeout");

        assert!(matches!(error, GraphKernelError::Timeout { .. }));
        assert_eq!(error.class(), "timeout");
    }

    #[tokio::test]
    async fn classifies_graph_kernel_envelope_decode_error() {
        let base_url = spawn_graph_response_server("200 OK", r#"{"success":true}"#, 0).await;

        let error = client(base_url, 1_000)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("decode error");

        assert!(matches!(error, GraphKernelError::Decode { .. }));
        assert_eq!(error.class(), "decode");
    }

    #[tokio::test]
    async fn classifies_graph_kernel_contract_errors() {
        let base_url = spawn_graph_response_server(
            "200 OK",
            r#"{"success":false,"data":{"candidates":[]}}"#,
            0,
        )
        .await;
        let error = client(base_url, 1_000)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("unsuccessful envelope");

        assert!(matches!(error, GraphKernelError::Contract { .. }));
        assert_eq!(error.class(), "contract");

        let base_url =
            spawn_graph_response_server("200 OK", r#"{"success":true,"data":{}}"#, 0).await;
        let error = client(base_url, 1_000)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("missing candidates");

        assert!(matches!(error, GraphKernelError::Contract { .. }));
        assert_eq!(error.class(), "contract");
    }

    #[tokio::test]
    async fn classifies_graph_kernel_request_timeout() {
        let base_url = spawn_graph_response_server(
            "200 OK",
            r#"{"success":true,"data":{"candidates":[]}}"#,
            100,
        )
        .await;

        let error = client(base_url, 10)
            .social_neighbors("viewer", 1, &[])
            .await
            .expect_err("timeout");

        assert!(matches!(error, GraphKernelError::Timeout { .. }));
        assert_eq!(error.class(), "timeout");
    }
}
