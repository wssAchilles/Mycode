pub mod types;
pub mod cache;
pub mod http_client;
pub mod grpc_client;

use anyhow::Result;
use async_trait::async_trait;

use types::{BridgeCandidate, GraphQueryResult, NeighborCandidate};

/// Trait for graph service clients
#[async_trait]
pub trait GraphClient: Send + Sync {
    /// Get social neighbors for a user
    async fn social_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    /// Get recent engagers for a user
    async fn recent_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    /// Get co-engagers for a user
    async fn co_engagers(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    /// Get content affinity neighbors for a user
    async fn content_affinity_neighbors(
        &self,
        user_id: &str,
        limit: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<NeighborCandidate>>;

    /// Get bridge users for a user
    async fn bridge_users(
        &self,
        user_id: &str,
        limit: usize,
        max_depth: usize,
        exclude_user_ids: &[String],
    ) -> Result<GraphQueryResult<BridgeCandidate>>;
}
