use anyhow::Result;
use async_trait::async_trait;

use super::types::{BridgeCandidate, GraphQueryResult, NeighborCandidate};
use super::GraphClient;

/// gRPC-based graph client implementation
/// Note: Requires proto file compilation for actual gRPC calls
/// Currently delegates to HTTP client as fallback
#[derive(Debug, Clone)]
pub struct GrpcGraphClient {
    http_fallback: super::http_client::HttpGraphClient,
}

impl GrpcGraphClient {
    pub fn new(http_base_url: String, http_timeout_ms: u64) -> Self {
        Self {
            http_fallback: super::http_client::HttpGraphClient::new(http_base_url, http_timeout_ms),
        }
    }
}

#[async_trait]
impl GraphClient for GrpcGraphClient {
    async fn social_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.http_fallback.social_neighbors(user_id, limit, exclude_user_ids).await
    }

    async fn recent_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.http_fallback.recent_engagers(user_id, limit, exclude_user_ids).await
    }

    async fn co_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.http_fallback.co_engagers(user_id, limit, exclude_user_ids).await
    }

    async fn content_affinity_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>> {
        self.http_fallback.content_affinity_neighbors(user_id, limit, exclude_user_ids).await
    }

    async fn bridge_users(
        &self,
        user_id: &str,
        limit: usize,
        max_depth: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<BridgeCandidate>> {
        self.http_fallback.bridge_users(user_id, limit, max_depth, exclude_user_ids).await
    }
}
