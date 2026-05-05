use std::collections::{HashMap, HashSet};

pub const GRAPH_KERNEL_AUTHOR_AGGREGATE_MIN_LIMIT: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum GraphKernelSourceKind {
    SocialNeighbor,
    RecentEngager,
    BridgeUser,
    CoEngager,
    ContentAffinity,
}

#[derive(Debug, Clone)]
pub struct GraphKernelAuthorSignal {
    pub user_id: String,
    pub score: f64,
    pub source_kind: GraphKernelSourceKind,
    pub relation_kinds: Vec<String>,
    pub via_user_ids: Vec<String>,
}

impl GraphKernelAuthorSignal {
    pub fn new(user_id: impl Into<String>, score: f64, source_kind: GraphKernelSourceKind) -> Self {
        Self {
            user_id: user_id.into(),
            score,
            source_kind,
            relation_kinds: Vec::new(),
            via_user_ids: Vec::new(),
        }
    }

    pub fn with_relation_kinds(mut self, relation_kinds: &[String]) -> Self {
        self.relation_kinds = relation_kinds.to_vec();
        self
    }

    pub fn with_via_user_ids(mut self, via_user_ids: &[String]) -> Self {
        self.via_user_ids = via_user_ids.to_vec();
        self
    }
}

#[derive(Debug, Clone)]
pub struct GraphKernelAuthorAggregate {
    pub user_id: String,
    pub total_score: f64,
    pub dominant_score: f64,
    pub dominant_kind: GraphKernelSourceKind,
    pub source_kinds: HashSet<GraphKernelSourceKind>,
    pub relation_kinds: HashSet<String>,
    pub via_user_ids: HashSet<String>,
}

pub fn graph_kernel_neighbor_signal_score(
    source_kind: &GraphKernelSourceKind,
    score: f64,
    engagement_score: Option<f64>,
    recentness_score: Option<f64>,
) -> f64 {
    match source_kind {
        GraphKernelSourceKind::SocialNeighbor => {
            score + engagement_score.unwrap_or(0.0) * 0.25 + recentness_score.unwrap_or(0.0) * 0.05
        }
        GraphKernelSourceKind::RecentEngager => {
            score * 0.2
                + engagement_score.unwrap_or(0.0) * 0.45
                + recentness_score.unwrap_or(0.0) * 0.45
        }
        GraphKernelSourceKind::CoEngager => {
            score * 0.65
                + engagement_score.unwrap_or(0.0) * 0.25
                + recentness_score.unwrap_or(0.0) * 0.1
        }
        GraphKernelSourceKind::ContentAffinity => {
            score * 0.55
                + engagement_score.unwrap_or(0.0) * 0.15
                + recentness_score.unwrap_or(0.0) * 0.3
        }
        GraphKernelSourceKind::BridgeUser => score,
    }
}

pub fn graph_kernel_bridge_signal_score(score: f64, bridge_strength: Option<f64>) -> f64 {
    bridge_strength.unwrap_or(score)
}

pub fn aggregate_graph_kernel_author_signals(
    signals: impl IntoIterator<Item = GraphKernelAuthorSignal>,
    requested_limit: usize,
) -> Vec<GraphKernelAuthorAggregate> {
    let mut author_aggregates = HashMap::new();

    for signal in signals {
        upsert_graph_kernel_author(&mut author_aggregates, signal);
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
    ranked.truncate(requested_limit.max(GRAPH_KERNEL_AUTHOR_AGGREGATE_MIN_LIMIT));
    ranked
}

pub fn sorted_graph_kernel_source_kinds(
    source_kinds: &HashSet<GraphKernelSourceKind>,
) -> Vec<GraphKernelSourceKind> {
    let mut items = source_kinds.iter().cloned().collect::<Vec<_>>();
    items.sort_by_key(graph_kernel_source_kind_key);
    items
}

pub fn sorted_graph_kernel_strings(items: &HashSet<String>) -> Vec<String> {
    let mut sorted = items.iter().cloned().collect::<Vec<_>>();
    sorted.sort();
    sorted
}

pub fn graph_kernel_source_kind_key(source_kind: &GraphKernelSourceKind) -> &'static str {
    match source_kind {
        GraphKernelSourceKind::SocialNeighbor => "cpp_graph_social_neighbor",
        GraphKernelSourceKind::RecentEngager => "cpp_graph_recent_engager",
        GraphKernelSourceKind::BridgeUser => "cpp_graph_bridge_user",
        GraphKernelSourceKind::CoEngager => "cpp_graph_co_engager",
        GraphKernelSourceKind::ContentAffinity => "cpp_graph_content_affinity",
    }
}

fn upsert_graph_kernel_author(
    target: &mut HashMap<String, GraphKernelAuthorAggregate>,
    signal: GraphKernelAuthorSignal,
) {
    let aggregate =
        target
            .entry(signal.user_id.clone())
            .or_insert_with(|| GraphKernelAuthorAggregate {
                user_id: signal.user_id,
                total_score: 0.0,
                dominant_score: f64::NEG_INFINITY,
                dominant_kind: signal.source_kind.clone(),
                source_kinds: HashSet::new(),
                relation_kinds: HashSet::new(),
                via_user_ids: HashSet::new(),
            });

    aggregate.total_score += signal.score;
    aggregate.source_kinds.insert(signal.source_kind.clone());
    if signal.score > aggregate.dominant_score {
        aggregate.dominant_score = signal.score;
        aggregate.dominant_kind = signal.source_kind;
    }

    for relation_kind in signal.relation_kinds {
        let trimmed = relation_kind.trim();
        if !trimmed.is_empty() {
            aggregate.relation_kinds.insert(trimmed.to_string());
        }
    }

    for via_user_id in signal.via_user_ids {
        let trimmed = via_user_id.trim();
        if !trimmed.is_empty() {
            aggregate.via_user_ids.insert(trimmed.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GraphKernelAuthorSignal, GraphKernelSourceKind, aggregate_graph_kernel_author_signals,
        graph_kernel_bridge_signal_score, graph_kernel_neighbor_signal_score,
        graph_kernel_source_kind_key,
    };

    #[test]
    fn graph_kernel_signal_scores_follow_policy_weights() {
        let social = graph_kernel_neighbor_signal_score(
            &GraphKernelSourceKind::SocialNeighbor,
            8.0,
            Some(6.0),
            Some(0.4),
        );
        let recent = graph_kernel_neighbor_signal_score(
            &GraphKernelSourceKind::RecentEngager,
            3.0,
            Some(7.0),
            Some(0.9),
        );

        assert_eq!(social, 9.52);
        assert_eq!(recent, 4.155);
        assert_eq!(graph_kernel_bridge_signal_score(4.0, Some(6.5)), 6.5);
    }

    #[test]
    fn aggregates_and_ranks_graph_kernel_author_signals() {
        let signals = vec![
            GraphKernelAuthorSignal::new("author-1", 9.52, GraphKernelSourceKind::SocialNeighbor)
                .with_relation_kinds(&["follow".to_string(), " reply ".to_string()]),
            GraphKernelAuthorSignal::new("author-1", 4.155, GraphKernelSourceKind::RecentEngager),
            GraphKernelAuthorSignal::new("author-2", 6.5, GraphKernelSourceKind::BridgeUser)
                .with_via_user_ids(&["bridge-a".to_string(), "".to_string()]),
        ];

        let ranked = aggregate_graph_kernel_author_signals(signals, 1);

        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].user_id, "author-1");
        assert_eq!(
            graph_kernel_source_kind_key(&ranked[0].dominant_kind),
            "cpp_graph_social_neighbor"
        );
        assert!(ranked[0].relation_kinds.contains("reply"));
        assert!(ranked[1].via_user_ids.contains("bridge-a"));
    }
}
