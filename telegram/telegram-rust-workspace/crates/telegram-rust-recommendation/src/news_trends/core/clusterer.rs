use std::collections::{HashMap, HashSet};

use chrono::DateTime;

use crate::news_trends::contracts::{
    NewsTrendRequestPayload, TrendDocumentPayload, TrendSourceType,
};

use super::normalizer::{canonical_keywords, extract_keywords};
use super::util::stable_numeric_cluster_id;

const KEYWORD_JACCARD_THRESHOLD: f64 = 0.35;
const EMBEDDING_COSINE_THRESHOLD: f64 = 0.82;

#[derive(Debug, Clone)]
pub struct NormalizedDocument {
    pub payload: TrendDocumentPayload,
    pub canonical_keywords: Vec<String>,
    pub title_keywords: Vec<String>,
    pub action_tokens: Vec<String>,
    pub timestamp_ms: i64,
    pub url_key: Option<String>,
    pub source_key: String,
}

#[derive(Debug, Clone)]
pub struct TrendCluster {
    pub numeric_cluster_id: i64,
    pub documents: Vec<NormalizedDocument>,
}

pub fn normalize_documents(request: &NewsTrendRequestPayload) -> Vec<NormalizedDocument> {
    let now_ms = normalized_now_ms(request.now_ms);
    let window_ms = i64::from(request.window_hours.max(1)) * 60 * 60 * 1000;
    let earliest_ms = now_ms.saturating_sub(window_ms);

    request
        .documents
        .iter()
        .filter_map(|payload| normalize_document(payload, now_ms, earliest_ms))
        .collect()
}

pub fn cluster_documents(documents: Vec<NormalizedDocument>) -> Vec<TrendCluster> {
    let mut clusters: Vec<TrendCluster> = Vec::new();
    let mut cluster_id_index: HashMap<i64, usize> = HashMap::new();
    let mut url_index: HashMap<String, usize> = HashMap::new();

    for document in documents {
        let target_index = if let Some(cluster_id) = document.payload.cluster_id {
            cluster_id_index.get(&cluster_id).copied()
        } else {
            document
                .url_key
                .as_ref()
                .and_then(|url_key| url_index.get(url_key).copied())
                .or_else(|| find_best_cluster_index(&document, &clusters))
        };

        let index = match target_index {
            Some(index) => index,
            None => {
                let cluster_key = build_cluster_key(&document);
                let numeric_cluster_id = document
                    .payload
                    .cluster_id
                    .unwrap_or_else(|| stable_numeric_cluster_id(&cluster_key));
                clusters.push(TrendCluster {
                    numeric_cluster_id,
                    documents: Vec::new(),
                });
                clusters.len() - 1
            }
        };

        if let Some(cluster_id) = document.payload.cluster_id {
            cluster_id_index.entry(cluster_id).or_insert(index);
        }
        if let Some(url_key) = &document.url_key {
            url_index.entry(url_key.clone()).or_insert(index);
        }
        clusters[index].documents.push(document);
    }

    clusters
}

fn normalize_document(
    payload: &TrendDocumentPayload,
    now_ms: i64,
    earliest_ms: i64,
) -> Option<NormalizedDocument> {
    let timestamp_ms = document_timestamp_ms(payload).unwrap_or(now_ms).min(now_ms);
    if timestamp_ms < earliest_ms {
        return None;
    }

    let text = [
        payload.title.as_deref().unwrap_or(""),
        payload.summary.as_deref().unwrap_or(""),
        payload.body.as_deref().unwrap_or(""),
    ]
    .join("\n");
    let canonical_keywords = canonical_keywords(&payload.keywords, &text, 18);
    let title_keywords = extract_keywords(payload.title.as_deref().unwrap_or(""), 8);
    if canonical_keywords.is_empty() && title_keywords.is_empty() {
        return None;
    }

    Some(NormalizedDocument {
        payload: payload.clone(),
        canonical_keywords,
        title_keywords,
        action_tokens: extract_action_tokens(payload.title.as_deref().unwrap_or("")),
        timestamp_ms,
        url_key: payload
            .canonical_url
            .as_deref()
            .or(payload.source_url.as_deref())
            .and_then(normalize_url_key),
        source_key: source_key(payload),
    })
}

fn find_best_cluster_index(
    document: &NormalizedDocument,
    clusters: &[TrendCluster],
) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (index, cluster) in clusters.iter().enumerate() {
        let score = cluster_match_score(document, cluster);
        if score <= 0.0 {
            continue;
        }
        match best {
            Some((_, best_score)) if best_score >= score => {}
            _ => best = Some((index, score)),
        }
    }
    best.map(|(index, _)| index)
}

fn cluster_match_score(document: &NormalizedDocument, cluster: &TrendCluster) -> f64 {
    let keyword_score = jaccard_keywords(
        &document.canonical_keywords,
        &cluster_keywords(&cluster.documents),
    );
    if keyword_score >= KEYWORD_JACCARD_THRESHOLD {
        return keyword_score;
    }

    if title_event_overlap(document, cluster) {
        return 0.4;
    }

    if embedding_match(document, cluster) {
        return 0.38;
    }

    0.0
}

fn cluster_keywords(documents: &[NormalizedDocument]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut keywords = Vec::new();
    for document in documents {
        for keyword in &document.canonical_keywords {
            if seen.insert(keyword.clone()) {
                keywords.push(keyword.clone());
            }
        }
    }
    keywords
}

fn jaccard_keywords(left: &[String], right: &[String]) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let left_set = left.iter().collect::<HashSet<_>>();
    let right_set = right.iter().collect::<HashSet<_>>();
    let intersection = left_set.intersection(&right_set).count() as f64;
    let union = left_set.union(&right_set).count() as f64;
    if union <= 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn title_event_overlap(document: &NormalizedDocument, cluster: &TrendCluster) -> bool {
    if document.title_keywords.is_empty() || document.action_tokens.is_empty() {
        return false;
    }
    let document_title_keywords = document.title_keywords.iter().collect::<HashSet<_>>();
    let document_actions = document.action_tokens.iter().collect::<HashSet<_>>();

    cluster.documents.iter().any(|candidate| {
        let title_overlap = candidate
            .title_keywords
            .iter()
            .any(|keyword| document_title_keywords.contains(keyword));
        let action_overlap = candidate
            .action_tokens
            .iter()
            .any(|action| document_actions.contains(action));
        title_overlap && action_overlap
    })
}

fn embedding_match(document: &NormalizedDocument, cluster: &TrendCluster) -> bool {
    let Some(left) = document.payload.embedding.as_ref() else {
        return false;
    };
    cluster.documents.iter().any(|candidate| {
        candidate
            .payload
            .embedding
            .as_ref()
            .is_some_and(|right| cosine_similarity(left, right) >= EMBEDDING_COSINE_THRESHOLD)
    })
}

fn cosine_similarity(left: &[f64], right: &[f64]) -> f64 {
    if left.is_empty() || left.len() != right.len() {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (l, r) in left.iter().zip(right.iter()) {
        dot += l * r;
        left_norm += l * l;
        right_norm += r * r;
    }
    if left_norm <= 0.0 || right_norm <= 0.0 {
        return 0.0;
    }
    dot / (left_norm.sqrt() * right_norm.sqrt())
}

fn build_cluster_key(document: &NormalizedDocument) -> String {
    if let Some(cluster_id) = document.payload.cluster_id {
        return format!("cluster:{cluster_id}");
    }
    if let Some(url_key) = &document.url_key {
        return format!("url:{url_key}");
    }
    if !document.canonical_keywords.is_empty() {
        return format!(
            "kw:{}",
            document
                .canonical_keywords
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("|")
        );
    }
    format!("doc:{}", document.payload.id)
}

fn document_timestamp_ms(payload: &TrendDocumentPayload) -> Option<i64> {
    parse_time_ms(payload.published_at.as_deref())
        .or_else(|| parse_time_ms(payload.fetched_at.as_deref()))
        .or_else(|| parse_time_ms(payload.created_at.as_deref()))
}

fn parse_time_ms(value: Option<&str>) -> Option<i64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date_time| date_time.timestamp_millis())
}

fn normalized_now_ms(now_ms: i64) -> i64 {
    if now_ms > 0 {
        now_ms
    } else {
        chrono::Utc::now().timestamp_millis()
    }
}

fn normalize_url_key(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let without_hash = raw.split('#').next().unwrap_or(raw);
    let without_query = without_hash.split('?').next().unwrap_or(without_hash);
    Some(without_query.trim_end_matches('/').to_lowercase())
}

fn source_key(payload: &TrendDocumentPayload) -> String {
    payload
        .canonical_url
        .as_deref()
        .or(payload.source_url.as_deref())
        .and_then(extract_domain)
        .or_else(|| {
            payload
                .source
                .as_deref()
                .map(|source| source.to_lowercase())
        })
        .unwrap_or_else(|| match payload.source_type {
            TrendSourceType::NewsArticle => "news".to_string(),
            TrendSourceType::SpacePost => "space".to_string(),
        })
}

fn extract_domain(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let host_start = trimmed.find("://").map_or(0, |index| index + 3);
    let host = trimmed[host_start..]
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_lowercase();
    if host.is_empty() { None } else { Some(host) }
}

fn extract_action_tokens(title: &str) -> Vec<String> {
    const ACTIONS: &[&str] = &[
        "case", "claim", "collide", "collides", "court", "dies", "died", "killed", "launch",
        "lawsuit", "release", "ruling", "sued", "sues",
    ];
    let lower = title.to_lowercase();
    ACTIONS
        .iter()
        .filter(|action| lower.contains(**action))
        .map(|action| (*action).to_string())
        .collect()
}
