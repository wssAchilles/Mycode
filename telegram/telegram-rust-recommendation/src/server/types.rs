use serde::Serialize;

use crate::contracts::{RecentStoreSnapshot, RecommendationOpsRuntime, RecommendationOpsSummary};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub service: &'static str,
    pub stage: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsSummaryResponse {
    pub runtime: RecommendationOpsRuntime,
    pub summary: RecommendationOpsSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationOpsResponse {
    pub status: String,
    pub runtime: RecommendationOpsRuntime,
    pub summary: RecommendationOpsSummary,
    pub recent_store: RecentStoreSnapshot,
}
