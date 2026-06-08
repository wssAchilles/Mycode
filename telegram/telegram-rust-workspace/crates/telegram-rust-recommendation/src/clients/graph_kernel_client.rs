use std::error::Error;
use std::fmt::{Display, Formatter};

use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde::de::DeserializeOwned;
use telegram_rust_http_types::{SuccessEnvelopeDecodeError, decode_success_envelope};

use crate::config::RecommendationConfig;
use crate::contracts::{
    GraphKernelBridgeCandidate, GraphKernelBridgeRequest, GraphKernelCandidatesResponse,
    GraphKernelNeighborCandidate, GraphKernelNeighborRequest, GraphKernelQueryResult,
};

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
}

impl GraphKernelClient {
    pub fn from_config(config: &RecommendationConfig) -> Option<Self> {
        if !config.graph_kernel_enabled {
            return None;
        }

        Some(Self::new(
            config.graph_kernel_url.trim_end_matches('/').to_string(),
            config.graph_kernel_timeout_ms,
        ))
    }

    pub(crate) fn new(base_url: String, timeout_ms: u64) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
            timeout_ms,
        }
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
        let body = response.text().await.map_err(|error| {
            if error.is_timeout() {
                GraphKernelError::Timeout {
                    path: path.to_string(),
                }
            } else {
                GraphKernelError::Unavailable {
                    path: path.to_string(),
                    source: format!("read body {url}: {error}"),
                }
            }
        })?;

        if !status.is_success() {
            return Err(GraphKernelError::HttpStatus {
                path: path.to_string(),
                status,
                body,
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

    use super::{GraphKernelClient, GraphKernelError};

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

    fn client(base_url: String, timeout_ms: u64) -> GraphKernelClient {
        GraphKernelClient::new(base_url, timeout_ms)
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
