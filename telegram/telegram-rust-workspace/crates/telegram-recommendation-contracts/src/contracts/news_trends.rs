use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const NEWS_TREND_MIN_LIMIT: usize = 1;
pub const NEWS_TREND_MAX_LIMIT: usize = 50;

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

impl NewsTrendMode {
    pub fn cache_key(&self) -> &'static str {
        match self {
            Self::NewsTopics => "news_topics",
            Self::SpaceTrends => "space_trends",
        }
    }
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

impl NewsTrendRequestPayload {
    pub fn canonical_limit(&self) -> usize {
        self.limit.clamp(NEWS_TREND_MIN_LIMIT, NEWS_TREND_MAX_LIMIT)
    }

    pub fn cache_fingerprint(&self) -> String {
        let mut cache_request = self.clone();
        cache_request.request_id.clear();
        cache_request.now_ms = 0;
        cache_request.limit = cache_request.canonical_limit();
        let serialized = serde_json::to_string(&cache_request).unwrap_or_default();
        format!(
            "{}:{}:{}:{:016x}",
            cache_request.mode.cache_key(),
            cache_request.window_hours,
            cache_request.limit,
            stable_hash_u64(&serialized)
        )
    }
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

fn stable_hash_u64(input: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::{NewsTrendMode, NewsTrendRequestPayload, TrendDocumentPayload, TrendSourceType};

    #[test]
    fn parses_news_trend_request_contract() {
        let request: NewsTrendRequestPayload = serde_json::from_str(
            r#"{
                "requestId":"req-1",
                "mode":"news_topics",
                "limit":10,
                "windowHours":24,
                "nowMs":1774454400000,
                "documents":[{
                    "id":"doc-1",
                    "sourceType":"news_article",
                    "title":"Ranking quality improves",
                    "keywords":["ranking","quality"],
                    "metrics":{"clicks":3.0}
                }]
            }"#,
        )
        .expect("parse news trend request contract");

        assert_eq!(request.mode, NewsTrendMode::NewsTopics);
        assert_eq!(request.documents.len(), 1);
        assert_eq!(
            request.documents[0].source_type,
            TrendSourceType::NewsArticle
        );
        assert_eq!(request.documents[0].keywords, ["ranking", "quality"]);
    }

    #[test]
    fn defaults_optional_news_trend_document_fields() {
        let document: TrendDocumentPayload =
            serde_json::from_str(r#"{"id":"doc-1","sourceType":"space_post"}"#)
                .expect("parse minimal document");

        assert_eq!(document.source_type, TrendSourceType::SpacePost);
        assert!(document.title.is_none());
        assert!(document.keywords.is_empty());
        assert!(document.metrics.clicks.is_none());
    }

    #[test]
    fn cache_fingerprint_ignores_request_id_and_now_ms() {
        let request = NewsTrendRequestPayload {
            request_id: "req-1".to_string(),
            mode: NewsTrendMode::NewsTopics,
            limit: 10,
            window_hours: 24,
            now_ms: 1,
            documents: Vec::new(),
        };
        let mut same_cache_request = request.clone();
        same_cache_request.request_id = "req-2".to_string();
        same_cache_request.now_ms = 2;
        let mut different_cache_request = request.clone();
        different_cache_request.limit = 11;

        assert_eq!(
            request.cache_fingerprint(),
            same_cache_request.cache_fingerprint()
        );
        assert_ne!(
            request.cache_fingerprint(),
            different_cache_request.cache_fingerprint()
        );
        assert!(
            request
                .cache_fingerprint()
                .starts_with("news_topics:24:10:")
        );
    }

    #[test]
    fn cache_fingerprint_uses_canonical_limit() {
        let below_min = NewsTrendRequestPayload {
            request_id: "req-1".to_string(),
            mode: NewsTrendMode::NewsTopics,
            limit: 0,
            window_hours: 24,
            now_ms: 1,
            documents: Vec::new(),
        };
        let mut min = below_min.clone();
        min.limit = 1;
        let mut above_max = below_min.clone();
        above_max.limit = 51;
        let mut max = below_min.clone();
        max.limit = 50;

        assert_eq!(below_min.canonical_limit(), 1);
        assert_eq!(above_max.canonical_limit(), 50);
        assert_eq!(below_min.cache_fingerprint(), min.cache_fingerprint());
        assert_eq!(above_max.cache_fingerprint(), max.cache_fingerprint());
    }
}
