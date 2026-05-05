use std::collections::HashMap;

pub(super) use telegram_source_primitives::graph_kernel::{
    GraphKernelAuthorAggregate, GraphKernelSourceKind,
};
use telegram_source_primitives::graph_kernel::{
    GraphKernelAuthorSignal, aggregate_graph_kernel_author_signals,
    graph_kernel_bridge_signal_score, graph_kernel_neighbor_signal_score,
    graph_kernel_source_kind_key, sorted_graph_kernel_source_kinds, sorted_graph_kernel_strings,
};

use crate::contracts::{
    GraphKernelBridgeCandidate, GraphKernelNeighborCandidate, RecommendationCandidatePayload,
};

use super::DEFAULT_BRIDGE_LIMIT;

pub(super) fn aggregate_graph_kernel_authors(
    social_neighbors: &[GraphKernelNeighborCandidate],
    recent_engagers: &[GraphKernelNeighborCandidate],
    bridge_users: &[GraphKernelBridgeCandidate],
    co_engagers: &[GraphKernelNeighborCandidate],
    content_affinity_neighbors: &[GraphKernelNeighborCandidate],
) -> Vec<GraphKernelAuthorAggregate> {
    let mut signals = Vec::new();

    for candidate in social_neighbors {
        signals.push(
            GraphKernelAuthorSignal::new(
                &candidate.user_id,
                graph_kernel_neighbor_signal_score(
                    &GraphKernelSourceKind::SocialNeighbor,
                    candidate.score,
                    candidate.engagement_score,
                    candidate.recentness_score,
                ),
                GraphKernelSourceKind::SocialNeighbor,
            )
            .with_relation_kinds(&candidate.relation_kinds),
        );
    }

    for candidate in recent_engagers {
        signals.push(
            GraphKernelAuthorSignal::new(
                &candidate.user_id,
                graph_kernel_neighbor_signal_score(
                    &GraphKernelSourceKind::RecentEngager,
                    candidate.score,
                    candidate.engagement_score,
                    candidate.recentness_score,
                ),
                GraphKernelSourceKind::RecentEngager,
            )
            .with_relation_kinds(&candidate.relation_kinds),
        );
    }

    for candidate in bridge_users {
        signals.push(
            GraphKernelAuthorSignal::new(
                &candidate.user_id,
                graph_kernel_bridge_signal_score(candidate.score, candidate.bridge_strength),
                GraphKernelSourceKind::BridgeUser,
            )
            .with_via_user_ids(&candidate.via_user_ids),
        );
    }

    for candidate in co_engagers {
        signals.push(
            GraphKernelAuthorSignal::new(
                &candidate.user_id,
                graph_kernel_neighbor_signal_score(
                    &GraphKernelSourceKind::CoEngager,
                    candidate.score,
                    candidate.engagement_score,
                    candidate.recentness_score,
                ),
                GraphKernelSourceKind::CoEngager,
            )
            .with_relation_kinds(&candidate.relation_kinds),
        );
    }

    for candidate in content_affinity_neighbors {
        signals.push(
            GraphKernelAuthorSignal::new(
                &candidate.user_id,
                graph_kernel_neighbor_signal_score(
                    &GraphKernelSourceKind::ContentAffinity,
                    candidate.score,
                    candidate.engagement_score,
                    candidate.recentness_score,
                ),
                GraphKernelSourceKind::ContentAffinity,
            )
            .with_relation_kinds(&candidate.relation_kinds),
        );
    }

    aggregate_graph_kernel_author_signals(signals, DEFAULT_BRIDGE_LIMIT)
}

pub(super) fn apply_graph_metadata(
    mut candidate: RecommendationCandidatePayload,
    aggregate: &GraphKernelAuthorAggregate,
    rank: usize,
) -> RecommendationCandidatePayload {
    let source_kinds = sorted_graph_kernel_source_kinds(&aggregate.source_kinds);
    let relation_kinds = sorted_graph_kernel_strings(&aggregate.relation_kinds);
    let via_user_ids = sorted_graph_kernel_strings(&aggregate.via_user_ids);
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
                .map(map_graph_kernel_source_kind)
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

pub(super) fn map_graph_kernel_source_kind(source_kind: &GraphKernelSourceKind) -> &'static str {
    graph_kernel_source_kind_key(source_kind)
}
