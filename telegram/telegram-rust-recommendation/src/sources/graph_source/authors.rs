use std::collections::{HashMap, HashSet};

use crate::clients::graph_kernel_client::{
    GraphKernelBridgeCandidate, GraphKernelNeighborCandidate,
};
use crate::contracts::RecommendationCandidatePayload;

use super::DEFAULT_BRIDGE_LIMIT;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) enum GraphKernelSourceKind {
    SocialNeighbor,
    RecentEngager,
    BridgeUser,
    CoEngager,
    ContentAffinity,
}

#[derive(Debug, Clone)]
pub(super) struct GraphKernelAuthorAggregate {
    pub(super) user_id: String,
    pub(super) total_score: f64,
    pub(super) dominant_score: f64,
    pub(super) dominant_kind: GraphKernelSourceKind,
    pub(super) source_kinds: HashSet<GraphKernelSourceKind>,
    pub(super) relation_kinds: HashSet<String>,
    pub(super) via_user_ids: HashSet<String>,
}

pub(super) fn aggregate_graph_kernel_authors(
    social_neighbors: &[GraphKernelNeighborCandidate],
    recent_engagers: &[GraphKernelNeighborCandidate],
    bridge_users: &[GraphKernelBridgeCandidate],
    co_engagers: &[GraphKernelNeighborCandidate],
    content_affinity_neighbors: &[GraphKernelNeighborCandidate],
) -> Vec<GraphKernelAuthorAggregate> {
    let mut author_aggregates = HashMap::new();

    for candidate in social_neighbors {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score
                + candidate.engagement_score.unwrap_or(0.0) * 0.25
                + candidate.recentness_score.unwrap_or(0.0) * 0.05,
            GraphKernelSourceKind::SocialNeighbor,
            &candidate.relation_kinds,
            &[],
        );
    }

    for candidate in recent_engagers {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score * 0.2
                + candidate.engagement_score.unwrap_or(0.0) * 0.45
                + candidate.recentness_score.unwrap_or(0.0) * 0.45,
            GraphKernelSourceKind::RecentEngager,
            &candidate.relation_kinds,
            &[],
        );
    }

    for candidate in bridge_users {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.bridge_strength.unwrap_or(candidate.score),
            GraphKernelSourceKind::BridgeUser,
            &[],
            &candidate.via_user_ids,
        );
    }

    for candidate in co_engagers {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score * 0.65
                + candidate.engagement_score.unwrap_or(0.0) * 0.25
                + candidate.recentness_score.unwrap_or(0.0) * 0.1,
            GraphKernelSourceKind::CoEngager,
            &candidate.relation_kinds,
            &[],
        );
    }

    for candidate in content_affinity_neighbors {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score * 0.55
                + candidate.engagement_score.unwrap_or(0.0) * 0.15
                + candidate.recentness_score.unwrap_or(0.0) * 0.3,
            GraphKernelSourceKind::ContentAffinity,
            &candidate.relation_kinds,
            &[],
        );
    }

    let mut ranked = author_aggregates.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .total_score
            .partial_cmp(&left.total_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                right
                    .dominant_score
                    .partial_cmp(&left.dominant_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    ranked.truncate(DEFAULT_BRIDGE_LIMIT.max(32));
    ranked
}

fn upsert_graph_kernel_author(
    target: &mut HashMap<String, GraphKernelAuthorAggregate>,
    user_id: &str,
    score: f64,
    source_kind: GraphKernelSourceKind,
    relation_kinds: &[String],
    via_user_ids: &[String],
) {
    let aggregate =
        target
            .entry(user_id.to_string())
            .or_insert_with(|| GraphKernelAuthorAggregate {
                user_id: user_id.to_string(),
                total_score: 0.0,
                dominant_score: f64::NEG_INFINITY,
                dominant_kind: source_kind.clone(),
                source_kinds: HashSet::new(),
                relation_kinds: HashSet::new(),
                via_user_ids: HashSet::new(),
            });

    aggregate.total_score += score;
    aggregate.source_kinds.insert(source_kind.clone());
    if score > aggregate.dominant_score {
        aggregate.dominant_score = score;
        aggregate.dominant_kind = source_kind;
    }

    for relation_kind in relation_kinds {
        let trimmed = relation_kind.trim();
        if !trimmed.is_empty() {
            aggregate.relation_kinds.insert(trimmed.to_string());
        }
    }

    for via_user_id in via_user_ids {
        let trimmed = via_user_id.trim();
        if !trimmed.is_empty() {
            aggregate.via_user_ids.insert(trimmed.to_string());
        }
    }
}

pub(super) fn apply_graph_metadata(
    mut candidate: RecommendationCandidatePayload,
    aggregate: &GraphKernelAuthorAggregate,
    rank: usize,
) -> RecommendationCandidatePayload {
    let source_kinds = sorted_source_kinds(&aggregate.source_kinds);
    let relation_kinds = sorted_strings(&aggregate.relation_kinds);
    let via_user_ids = sorted_strings(&aggregate.via_user_ids);
    let graph_recall_type = if source_kinds.len() > 1 {
        "cpp_graph_multi_signal".to_string()
    } else {
        map_graph_kernel_source_kind(&aggregate.dominant_kind).to_string()
    };

    let mut graph_path_parts = vec![
        format!(
            "signals:{}",
            source_kinds
                .iter()
                .map(|kind| map_graph_kernel_source_kind(kind))
                .collect::<Vec<_>>()
                .join("|")
        ),
        format!(
            "dominant:{}",
            map_graph_kernel_source_kind(&aggregate.dominant_kind)
        ),
    ];
    if !relation_kinds.is_empty() {
        graph_path_parts.push(format!("relations:{}", relation_kinds.join("|")));
    }
    if !via_user_ids.is_empty() {
        graph_path_parts.push(format!("via_users:{}", via_user_ids.join("|")));
    }

    candidate.in_network = Some(false);
    candidate.recall_source = Some("GraphKernelSource".to_string());
    candidate.retrieval_lane = Some("social_expansion".to_string());
    candidate.graph_score = Some(aggregate.total_score);
    candidate.graph_path = Some(graph_path_parts.join(";"));
    candidate.graph_recall_type = Some(graph_recall_type);
    candidate.score = Some(aggregate.total_score);
    candidate.pipeline_score = Some(aggregate.total_score);
    candidate.score_breakdown = Some(HashMap::from([
        ("graphKernelRank".to_string(), rank as f64),
        ("graphKernelScore".to_string(), aggregate.total_score),
    ]));
    candidate
}

fn sorted_source_kinds(
    source_kinds: &HashSet<GraphKernelSourceKind>,
) -> Vec<GraphKernelSourceKind> {
    let mut items = source_kinds.iter().cloned().collect::<Vec<_>>();
    items.sort_by_key(|item| map_graph_kernel_source_kind(item));
    items
}

fn sorted_strings(items: &HashSet<String>) -> Vec<String> {
    let mut sorted = items.iter().cloned().collect::<Vec<_>>();
    sorted.sort();
    sorted
}

pub(super) fn map_graph_kernel_source_kind(source_kind: &GraphKernelSourceKind) -> &'static str {
    match source_kind {
        GraphKernelSourceKind::SocialNeighbor => "cpp_graph_social_neighbor",
        GraphKernelSourceKind::RecentEngager => "cpp_graph_recent_engager",
        GraphKernelSourceKind::BridgeUser => "cpp_graph_bridge_user",
        GraphKernelSourceKind::CoEngager => "cpp_graph_co_engager",
        GraphKernelSourceKind::ContentAffinity => "cpp_graph_content_affinity",
    }
}
