use std::collections::{BTreeMap, HashMap, HashSet};

use crate::news_trends::contracts::{NewsTrendRequestPayload, TrendMetricsPayload};

use super::clusterer::{NormalizedDocument, TrendCluster};

#[derive(Debug, Clone)]
pub struct ScoredTrendCluster {
    pub cluster: TrendCluster,
    pub score: f64,
    pub representative_index: usize,
    pub latest_ms: i64,
    pub canonical_keywords: Vec<String>,
    pub score_breakdown: BTreeMap<String, f64>,
}

pub fn score_clusters(
    clusters: Vec<TrendCluster>,
    request: &NewsTrendRequestPayload,
) -> Vec<ScoredTrendCluster> {
    let half_life_hours = if request.window_hours >= 168 {
        36.0
    } else {
        18.0
    };
    clusters
        .into_iter()
        .filter_map(|cluster| score_cluster(cluster, request.now_ms, half_life_hours))
        .collect()
}

fn score_cluster(
    cluster: TrendCluster,
    now_ms: i64,
    half_life_hours: f64,
) -> Option<ScoredTrendCluster> {
    if cluster.documents.is_empty() {
        return None;
    }

    let doc_scores = cluster
        .documents
        .iter()
        .map(|document| score_document(document, now_ms, half_life_hours))
        .collect::<Vec<_>>();
    let sum_doc_score = doc_scores.iter().sum::<f64>();
    let article_count = cluster.documents.len() as f64;
    let unique_sources = cluster
        .documents
        .iter()
        .map(|document| document.source_key.clone())
        .collect::<HashSet<_>>()
        .len() as f64;
    let article_count_bonus = 0.8 * article_count.ln_1p();
    let unique_source_bonus = 0.6 * unique_sources.ln_1p();
    let score = sum_doc_score + article_count_bonus + unique_source_bonus;
    let average_source_credibility = cluster
        .documents
        .iter()
        .map(|document| source_credibility_prior(&document.source_key))
        .sum::<f64>()
        / article_count.max(1.0);

    let representative_index = doc_scores
        .iter()
        .enumerate()
        .max_by(|(left_index, left_score), (right_index, right_score)| {
            left_score
                .partial_cmp(right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    cluster.documents[*left_index]
                        .timestamp_ms
                        .cmp(&cluster.documents[*right_index].timestamp_ms)
                })
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let latest_ms = cluster
        .documents
        .iter()
        .map(|document| document.timestamp_ms)
        .max()
        .unwrap_or(now_ms);

    let mut score_breakdown = BTreeMap::new();
    score_breakdown.insert("sum_doc_score".to_string(), round_score(sum_doc_score));
    score_breakdown.insert(
        "article_count_bonus".to_string(),
        round_score(article_count_bonus),
    );
    score_breakdown.insert(
        "unique_source_bonus".to_string(),
        round_score(unique_source_bonus),
    );
    score_breakdown.insert(
        "source_credibility_prior".to_string(),
        round_score(average_source_credibility),
    );
    score_breakdown.insert("article_count".to_string(), article_count);
    score_breakdown.insert("unique_sources".to_string(), unique_sources);

    Some(ScoredTrendCluster {
        canonical_keywords: weighted_keywords(&cluster.documents, &doc_scores),
        cluster,
        score,
        representative_index,
        latest_ms,
        score_breakdown,
    })
}

fn score_document(document: &NormalizedDocument, now_ms: i64, half_life_hours: f64) -> f64 {
    let age_hours = ((now_ms - document.timestamp_ms).max(0) as f64) / (60.0 * 60.0 * 1000.0);
    let recency_decay = (-age_hours / half_life_hours).exp();
    let metrics = &document.payload.metrics;
    let source_prior = source_credibility_prior(&document.source_key);
    recency_decay
        * (1.0
            + 0.25 * metric(metrics.impressions).ln_1p()
            + 0.9 * metric(metrics.clicks).ln_1p()
            + 1.4 * metric(metrics.shares).ln_1p()
            + 0.35 * metric(metrics.dwell_count).ln_1p()
            + 0.5 * positive_social_actions(metrics).ln_1p())
        * source_prior
}

fn source_credibility_prior(source_key: &str) -> f64 {
    let key = source_key.to_lowercase();
    if key.contains("reuters") || key.contains("apnews") || key.contains("associatedpress") {
        1.08
    } else if key.contains("bbc") || key.contains("nytimes") || key.contains("theguardian") {
        1.05
    } else if key.contains("cnn") || key.contains("bloomberg") || key.contains("wsj") {
        1.03
    } else if key == "space" {
        0.98
    } else {
        1.0
    }
}

fn positive_social_actions(metrics: &TrendMetricsPayload) -> f64 {
    metric(metrics.likes) + metric(metrics.comments) + metric(metrics.reposts)
}

fn metric(value: Option<f64>) -> f64 {
    value
        .filter(|value| value.is_finite())
        .unwrap_or(0.0)
        .max(0.0)
}

fn weighted_keywords(documents: &[NormalizedDocument], doc_scores: &[f64]) -> Vec<String> {
    let mut weights: HashMap<String, f64> = HashMap::new();
    for (document, doc_score) in documents.iter().zip(doc_scores.iter()) {
        for (rank, keyword) in document.canonical_keywords.iter().enumerate() {
            let rank_weight = 1.0 / (rank as f64 + 1.0);
            *weights.entry(keyword.clone()).or_insert(0.0) += doc_score * rank_weight;
        }
    }

    let mut entries = weights.into_iter().collect::<Vec<_>>();
    entries.sort_by(|(left_keyword, left_score), (right_keyword, right_score)| {
        right_score
            .partial_cmp(left_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left_keyword.cmp(right_keyword))
    });
    entries
        .into_iter()
        .map(|(keyword, _)| keyword)
        .take(8)
        .collect()
}

fn round_score(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}
