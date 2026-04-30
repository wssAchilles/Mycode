use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{source_mixing_multiplier, source_retrieval_lane};

use super::evidence::annotate_candidate_recall_evidence;

#[derive(Default)]
struct MergeTelemetry {
    duplicate_recall_hits: usize,
    multi_source_candidates: usize,
    secondary_recall_edges: usize,
    cross_lane_recall_edges: usize,
}

struct MergeWorkset<'a> {
    query: &'a RecommendationQueryPayload,
    source_rank: HashMap<&'a str, usize>,
    merged: Vec<RecommendationCandidatePayload>,
    candidate_index_by_key: HashMap<String, usize>,
    telemetry: MergeTelemetry,
}

pub(super) fn merge_source_candidates(
    query: &RecommendationQueryPayload,
    source_candidates: Vec<(String, Vec<RecommendationCandidatePayload>)>,
    source_order: &[String],
) -> (
    Vec<RecommendationCandidatePayload>,
    HashMap<String, usize>,
    HashMap<String, Value>,
) {
    let source_rank = source_order
        .iter()
        .enumerate()
        .map(|(index, source_name)| (source_name.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut workset = MergeWorkset {
        query,
        source_rank,
        merged: Vec::new(),
        candidate_index_by_key: HashMap::new(),
        telemetry: MergeTelemetry::default(),
    };

    for (source_name, candidates) in source_candidates {
        for candidate in candidates {
            workset.merge_candidate(&source_name, candidate);
        }
    }

    let lane_counts = annotate_merged_candidates(&mut workset.merged, &mut workset.telemetry);
    let detail = build_merge_detail(&lane_counts, &workset.telemetry);

    (workset.merged, lane_counts, detail)
}

impl MergeWorkset<'_> {
    fn merge_candidate(
        &mut self,
        source_name: &str,
        mut candidate: RecommendationCandidatePayload,
    ) {
        let candidate_key = candidate_merge_key(&candidate);
        let primary_source = candidate
            .recall_source
            .clone()
            .unwrap_or_else(|| source_name.to_string());
        candidate.recall_source = Some(primary_source.clone());
        candidate.retrieval_lane = Some(source_retrieval_lane(&primary_source).to_string());

        let Some(existing_index) = self.candidate_index_by_key.get(&candidate_key).copied() else {
            self.candidate_index_by_key
                .insert(candidate_key, self.merged.len());
            self.merged.push(candidate);
            return;
        };

        self.telemetry.duplicate_recall_hits += 1;
        self.merge_duplicate_candidate(existing_index, primary_source, candidate);
    }

    fn merge_duplicate_candidate(
        &mut self,
        existing_index: usize,
        primary_source: String,
        mut candidate: RecommendationCandidatePayload,
    ) {
        let existing = self
            .merged
            .get_mut(existing_index)
            .expect("merged candidate index should be valid");
        let existing_primary_source = existing
            .recall_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let promote_incoming = should_promote_primary_source(
            self.query,
            &primary_source,
            &existing_primary_source,
            *self
                .source_rank
                .get(primary_source.as_str())
                .unwrap_or(&usize::MAX),
            *self
                .source_rank
                .get(existing_primary_source.as_str())
                .unwrap_or(&usize::MAX),
        );

        if promote_incoming {
            merge_promoted_candidate(
                existing,
                &primary_source,
                &existing_primary_source,
                &mut candidate,
            );
            self.merged[existing_index] = candidate;
        } else {
            merge_demoted_candidate(
                existing,
                &primary_source,
                &existing_primary_source,
                &candidate,
            );
        }
    }
}

fn merge_promoted_candidate(
    existing: &RecommendationCandidatePayload,
    primary_source: &str,
    existing_primary_source: &str,
    candidate: &mut RecommendationCandidatePayload,
) {
    merge_secondary_sources(
        &mut candidate.secondary_recall_sources,
        primary_source,
        std::iter::once(existing_primary_source.to_string())
            .chain(
                existing
                    .secondary_recall_sources
                    .clone()
                    .unwrap_or_default()
                    .into_iter(),
            )
            .collect(),
    );
    fill_missing_candidate_fields(candidate, existing);
}

fn merge_demoted_candidate(
    existing: &mut RecommendationCandidatePayload,
    primary_source: &str,
    existing_primary_source: &str,
    candidate: &RecommendationCandidatePayload,
) {
    fill_missing_candidate_fields(existing, candidate);
    merge_secondary_sources(
        &mut existing.secondary_recall_sources,
        existing_primary_source,
        std::iter::once(primary_source.to_string())
            .chain(
                candidate
                    .secondary_recall_sources
                    .clone()
                    .unwrap_or_default()
                    .into_iter(),
            )
            .collect(),
    );
}

fn annotate_merged_candidates(
    merged: &mut [RecommendationCandidatePayload],
    telemetry: &mut MergeTelemetry,
) -> HashMap<String, usize> {
    let mut lane_counts: HashMap<String, usize> = HashMap::new();
    for candidate in merged {
        if candidate
            .retrieval_lane
            .as_ref()
            .is_none_or(|value| value.trim().is_empty())
        {
            candidate.retrieval_lane = Some(
                source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")).to_string(),
            );
        }

        if let Some(lane) = candidate.retrieval_lane.as_ref() {
            *lane_counts.entry(lane.clone()).or_insert(0) += 1;
        }

        let evidence_stats = annotate_candidate_recall_evidence(candidate);
        if evidence_stats.secondary_count > 0 {
            telemetry.multi_source_candidates += 1;
            telemetry.secondary_recall_edges += evidence_stats.secondary_count;
            telemetry.cross_lane_recall_edges += evidence_stats.cross_lane_count;
        }
    }
    lane_counts
}

fn build_merge_detail(
    lane_counts: &HashMap<String, usize>,
    telemetry: &MergeTelemetry,
) -> HashMap<String, Value> {
    let mut detail = HashMap::new();
    detail.insert(
        "laneCounts".to_string(),
        serde_json::to_value(&lane_counts).unwrap_or(Value::Null),
    );
    detail.insert(
        "duplicateRecallHits".to_string(),
        Value::from(telemetry.duplicate_recall_hits as u64),
    );
    detail.insert(
        "multiSourceCandidates".to_string(),
        Value::from(telemetry.multi_source_candidates as u64),
    );
    detail.insert(
        "secondaryRecallEdges".to_string(),
        Value::from(telemetry.secondary_recall_edges as u64),
    );
    detail.insert(
        "crossLaneRecallEdges".to_string(),
        Value::from(telemetry.cross_lane_recall_edges as u64),
    );
    detail
}

fn candidate_merge_key(candidate: &RecommendationCandidatePayload) -> String {
    if candidate.is_news == Some(true) {
        if let Some(cluster_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
        {
            return format!("news:cluster:{cluster_id}");
        }
        if let Some(external_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.external_id.as_deref())
            .filter(|value| !value.trim().is_empty())
        {
            return format!("news:external:{}", external_id.trim().to_lowercase());
        }
        if let Some(url) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source_url.as_deref().or(metadata.url.as_deref()))
            .and_then(normalized_url_key)
        {
            return format!("news:url:{url}");
        }
    }

    candidate
        .original_post_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            candidate
                .model_post_id
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| candidate.post_id.clone())
}

fn normalized_url_key(url: &str) -> Option<String> {
    let trimmed = url.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed.as_str());
    let without_www = without_scheme
        .strip_prefix("www.")
        .unwrap_or(without_scheme);
    let without_fragment = without_www.split('#').next().unwrap_or(without_www);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);
    let normalized = without_query.trim_end_matches('/');
    (!normalized.is_empty()).then(|| normalized.to_string())
}

fn should_promote_primary_source(
    query: &RecommendationQueryPayload,
    incoming_source: &str,
    existing_source: &str,
    incoming_rank: usize,
    existing_rank: usize,
) -> bool {
    let incoming_mixing = source_mixing_multiplier(query, incoming_source);
    let existing_mixing = source_mixing_multiplier(query, existing_source);

    incoming_mixing > existing_mixing + f64::EPSILON
        || ((incoming_mixing - existing_mixing).abs() <= f64::EPSILON
            && incoming_rank < existing_rank)
}

fn merge_secondary_sources(
    secondary_recall_sources: &mut Option<Vec<String>>,
    primary_source: &str,
    incoming_sources: Vec<String>,
) {
    let existing = secondary_recall_sources.take().unwrap_or_default();
    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    for source in incoming_sources {
        if source == primary_source {
            continue;
        }
        if seen.insert(source.clone()) {
            merged.push(source);
        }
    }

    for source in existing {
        if source != primary_source && seen.insert(source.clone()) {
            merged.push(source);
        }
    }

    *secondary_recall_sources = (!merged.is_empty()).then_some(merged);
}

fn fill_missing_candidate_fields(
    target: &mut RecommendationCandidatePayload,
    source: &RecommendationCandidatePayload,
) {
    if target.graph_score.is_none() {
        target.graph_score = source.graph_score;
    }
    if target.graph_path.is_none() {
        target.graph_path = source.graph_path.clone();
    }
    if target.graph_recall_type.is_none() {
        target.graph_recall_type = source.graph_recall_type.clone();
    }
    if target.author_affinity_score.is_none() {
        target.author_affinity_score = source.author_affinity_score;
    }

    match (&mut target.score_breakdown, &source.score_breakdown) {
        (Some(target_breakdown), Some(source_breakdown)) => {
            merge_score_breakdown(target_breakdown, source_breakdown);
        }
        (None, Some(source_breakdown)) => {
            target.score_breakdown = Some(source_breakdown.clone());
        }
        _ => {}
    }
}

fn merge_score_breakdown(target: &mut HashMap<String, f64>, source: &HashMap<String, f64>) {
    for (key, value) in source {
        if !value.is_finite() {
            continue;
        }
        target
            .entry(key.clone())
            .and_modify(|current| {
                if value > current {
                    *current = *value;
                }
            })
            .or_insert(*value);
    }
}
