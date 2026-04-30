use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrendSourceType {
    NewsArticle,
    SpacePost,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NewsTrendMode {
    NewsTopics,
    SpaceTrends,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NewsTrendKind {
    NewsEvent,
    Keyword,
    SocialTopic,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendMetricsPayload {
    #[serde(default)]
    pub impressions: Option<f64>,
    #[serde(default)]
    pub clicks: Option<f64>,
    #[serde(default)]
    pub shares: Option<f64>,
    #[serde(default)]
    pub dwell_count: Option<f64>,
    #[serde(default)]
    pub likes: Option<f64>,
    #[serde(default)]
    pub comments: Option<f64>,
    #[serde(default)]
    pub reposts: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendDocumentPayload {
    pub id: String,
    pub source_type: TrendSourceType,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub canonical_url: Option<String>,
    #[serde(default)]
    pub cover_image_url: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub fetched_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub cluster_id: Option<i64>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub metrics: TrendMetricsPayload,
    #[serde(default)]
    pub embedding: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsTrendRequestPayload {
    pub request_id: String,
    pub mode: NewsTrendMode,
    pub limit: usize,
    pub window_hours: u32,
    pub now_ms: i64,
    #[serde(default)]
    pub documents: Vec<TrendDocumentPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsTrendItemPayload {
    pub trend_id: String,
    pub numeric_cluster_id: i64,
    pub tag: String,
    pub display_name: String,
    pub kind: NewsTrendKind,
    pub count: usize,
    pub heat: i64,
    pub score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default)]
    pub cover_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub representative_document_id: Option<String>,
    pub document_ids: Vec<String>,
    pub canonical_keywords: Vec<String>,
    pub score_breakdown: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsTrendResponsePayload {
    pub request_id: String,
    pub mode: NewsTrendMode,
    pub generated_at: String,
    pub cache_hit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_key: Option<String>,
    pub trace_version: String,
    pub input_document_count: usize,
    pub selected_trend_count: usize,
    pub trends: Vec<NewsTrendItemPayload>,
}
