use serde::Serialize;

use crate::contracts::{RecentStoreSnapshot, RecommendationOpsRuntime, RecommendationOpsSummary};
use crate::pipeline::executor::CacheControlPlaneSnapshot;
use crate::state::recent_store::RecentHotControlPlaneSnapshot;

pub use crate::contracts::{HealthResponse, ReadinessResponse};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsSummaryResponse {
    pub runtime: RecommendationOpsRuntime,
    pub summary: RecommendationOpsSummary,
    pub cache_control_plane: CacheControlPlaneSnapshot,
    pub recent_control_plane: RecentHotControlPlaneSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsResponse {
    pub status: String,
    pub runtime: RecommendationOpsRuntime,
    pub summary: RecommendationOpsSummary,
    pub recent_store: RecentStoreSnapshot,
    pub cache_control_plane: CacheControlPlaneSnapshot,
    pub recent_control_plane: RecentHotControlPlaneSnapshot,
}
