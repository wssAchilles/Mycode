pub mod batch;
pub mod cache;
pub mod grpc_client;
pub mod http_client;
pub mod types;

use anyhow::Result;
use async_trait::async_trait;

use types::{BridgeCandidate, GraphQueryResult, NeighborCandidate};

/// Trait for graph service clients
#[async_trait]
pub trait GraphClient: Send + Sync {
    async fn social_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    async fn recent_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    async fn co_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    async fn content_affinity_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    async fn bridge_users(
        &self,
        user_id: &str,
        limit: usize,
        max_depth: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<BridgeCandidate>>;
}
