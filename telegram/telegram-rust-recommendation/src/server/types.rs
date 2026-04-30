use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

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
pub struct ReadinessCheckResponse {
    pub name: String,
    pub ok: bool,
    pub detail: HashMap<String, Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessResponse {
    pub ok: bool,
    pub status: &'static str,
    pub service: &'static str,
    pub stage: String,
    pub checks: Vec<ReadinessCheckResponse>,
    pub manifest_entry_count: usize,
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
