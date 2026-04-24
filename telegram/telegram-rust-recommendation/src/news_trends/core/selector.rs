use std::collections::HashMap;

use crate::news_trends::contracts::{
    NewsTrendItemPayload, NewsTrendKind, NewsTrendMode, NewsTrendRequestPayload, TrendSourceType,
};

use super::normalizer::{is_weak_keyword, normalize_keyword};
use super::scorer::ScoredTrendCluster;
use super::title_generator::{generate_display_name, representative_summary};
use super::util::{bounded_limit, iso_from_ms, slug_from_display_name};

struct TrendCandidate {
    item: NewsTrendItemPayload,
    source_key: String,
    latest_ms: i64,
}

pub fn select_trends(
    scored_clusters: Vec<ScoredTrendCluster>,
    request: &NewsTrendRequestPayload,
) -> Vec<NewsTrendItemPayload> {
    let max_score = scored_clusters
        .iter()
        .map(|cluster| cluster.score)
        .fold(0.0_f64, f64::max)
        .max(1.0);
    let mut candidates = scored_clusters
        .into_iter()
        .filter_map(|cluster| build_candidate(cluster, request, max_score))
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        right
            .item
            .score
            .partial_cmp(&left.item.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.latest_ms.cmp(&left.latest_ms))
            .then_with(|| left.item.trend_id.cmp(&right.item.trend_id))
    });

    let limit = bounded_limit(request.limit);
    let mut selected: Vec<TrendCandidate> = Vec::new();
    let mut deferred_by_source_cap: Vec<TrendCandidate> = Vec::new();
    let mut source_counts: HashMap<String, usize> = HashMap::new();
    let mut cluster_seen = std::collections::HashSet::new();

    for candidate in candidates {
        if selected.len() >= limit {
            deferred_by_source_cap.push(candidate);
            continue;
        }
        if cluster_seen.contains(&candidate.item.numeric_cluster_id) {
            continue;
        }
        let source_count = source_counts
            .get(&candidate.source_key)
            .copied()
            .unwrap_or(0);
        if source_count >= 2 {
            deferred_by_source_cap.push(candidate);
            continue;
        }
        cluster_seen.insert(candidate.item.numeric_cluster_id);
        source_counts.insert(candidate.source_key.clone(), source_count + 1);
        selected.push(candidate);
    }

    if selected.len() < limit {
        for candidate in deferred_by_source_cap {
            if selected.len() >= limit {
                break;
            }
            if !cluster_seen.insert(candidate.item.numeric_cluster_id) {
                continue;
            }
            selected.push(candidate);
        }
    }

    selected
        .into_iter()
        .map(|candidate| candidate.item)
        .collect()
}

fn build_candidate(
    cluster: ScoredTrendCluster,
    request: &NewsTrendRequestPayload,
    max_score: f64,
) -> Option<TrendCandidate> {
    let display_name = generate_display_name(&cluster)?;
    let representative = cluster
        .cluster
        .documents
        .get(cluster.representative_index)?;
    let kind = trend_kind(&cluster, request);
    let tag = select_tag(&cluster, &display_name)?;
    if is_weak_keyword(&tag) {
        return None;
    }

    let heat = ((cluster.score / max_score) * 100.0)
        .round()
        .clamp(0.0, 100.0) as i64;
    let document_ids = cluster
        .cluster
        .documents
        .iter()
        .map(|document| document.payload.id.clone())
        .collect::<Vec<_>>();
    let trend_id = format!("{:?}:{}", kind, cluster.cluster.numeric_cluster_id).to_lowercase();

    Some(TrendCandidate {
        source_key: representative.source_key.clone(),
        latest_ms: cluster.latest_ms,
        item: NewsTrendItemPayload {
            trend_id,
            numeric_cluster_id: cluster.cluster.numeric_cluster_id,
            tag,
            display_name,
            kind,
            count: cluster.cluster.documents.len(),
            heat,
            score: (cluster.score * 1000.0).round() / 1000.0,
            latest_at: iso_from_ms(cluster.latest_ms),
            summary: representative_summary(&cluster),
            cover_image_url: representative.payload.cover_image_url.clone(),
            representative_document_id: Some(representative.payload.id.clone()),
            document_ids,
            canonical_keywords: cluster.canonical_keywords.clone(),
            score_breakdown: cluster.score_breakdown.clone(),
        },
    })
}

fn trend_kind(cluster: &ScoredTrendCluster, request: &NewsTrendRequestPayload) -> NewsTrendKind {
    if request.mode == NewsTrendMode::NewsTopics
        || cluster
            .cluster
            .documents
            .iter()
            .any(|document| document.payload.source_type == TrendSourceType::NewsArticle)
    {
        NewsTrendKind::NewsEvent
    } else if cluster.cluster.documents.len() > 1 {
        NewsTrendKind::SocialTopic
    } else {
        NewsTrendKind::Keyword
    }
}

fn select_tag(cluster: &ScoredTrendCluster, display_name: &str) -> Option<String> {
    cluster
        .canonical_keywords
        .iter()
        .find(|keyword| !is_weak_keyword(keyword))
        .cloned()
        .or_else(|| normalize_keyword(display_name))
        .or_else(|| {
            let slug = slug_from_display_name(display_name);
            if slug.is_empty() { None } else { Some(slug) }
        })
}
