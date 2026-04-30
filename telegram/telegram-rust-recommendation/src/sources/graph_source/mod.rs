use std::collections::HashMap;
use std::time::Instant;

use anyhow::Result;
use serde_json::Value;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::clients::graph_kernel_client::GraphKernelClient;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::contracts::{GraphKernelTelemetry, GraphRetrievalBreakdown, classify_graph_retrieval};

mod authors;
mod detail;
mod direct;
mod fallback;
mod materialization;

use detail::{
    apply_materializer_telemetry, build_graph_source_detail, insert_materializer_retry_detail,
    insert_materializer_telemetry_detail,
};
use materialization::{MaterializerRetryDetail, MaterializerTelemetry};

const GRAPH_SOURCE_NAME: &str = "GraphSource";
pub(super) const DEFAULT_DIRECT_LIMIT: usize = 48;
pub(super) const DEFAULT_BRIDGE_LIMIT: usize = 100;
pub(super) const DEFAULT_BRIDGE_MAX_DEPTH: usize = 3;
pub(super) const MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS: usize = 180;
pub(super) const MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR: usize = 8;

#[derive(Debug, Clone)]
pub struct GraphSourceRuntime {
    pub(super) backend_client: BackendRecommendationClient,
    pub(super) graph_kernel_client: Option<GraphKernelClient>,
    pub(super) materializer_limit_per_author: usize,
    pub(super) materializer_lookback_days: usize,
}

#[derive(Debug, Clone)]
pub struct GraphSourceExecution {
    pub stage: RecommendationStagePayload,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub provider_calls: HashMap<String, usize>,
    pub provider_latency_ms: HashMap<String, u64>,
    pub breakdown: GraphRetrievalBreakdown,
}

impl GraphSourceRuntime {
    pub fn new(
        backend_client: BackendRecommendationClient,
        graph_kernel_client: Option<GraphKernelClient>,
        materializer_limit_per_author: usize,
        materializer_lookback_days: usize,
    ) -> Self {
        Self {
            backend_client,
            graph_kernel_client,
            materializer_limit_per_author,
            materializer_lookback_days,
        }
    }

    pub async fn retrieve(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<GraphSourceExecution> {
        let start = Instant::now();
        let Some(graph_kernel_client) = self.graph_kernel_client.clone() else {
            return self
                .fallback_to_backend(
                    query,
                    start,
                    Some("graph_kernel_disabled".to_string()),
                    HashMap::new(),
                    HashMap::new(),
                    GraphKernelTelemetry::default(),
                    MaterializerRetryDetail::default(),
                    MaterializerTelemetry::default(),
                )
                .await;
        };

        let direct = self
            .retrieve_direct_candidates(graph_kernel_client, query)
            .await?;

        if direct.candidates.is_empty() {
            return self
                .fallback_to_backend(
                    query,
                    start,
                    direct.fallback_reason,
                    direct.provider_calls,
                    direct.provider_latency_ms,
                    direct.telemetry,
                    direct.materializer_retry,
                    direct.materializer_telemetry,
                )
                .await;
        }

        let mut breakdown =
            classify_graph_retrieval(&direct.candidates, false, &direct.telemetry, None);
        apply_materializer_telemetry(&mut breakdown, &direct.materializer_telemetry);
        let mut detail = build_graph_source_detail(
            "cpp_graph_kernel_primary",
            "node_graph_author_provider",
            &direct.telemetry,
            &direct.query_errors,
            None,
            None,
            &breakdown,
        );
        insert_materializer_retry_detail(&mut detail, &direct.materializer_retry);
        insert_materializer_telemetry_detail(&mut detail, &direct.materializer_telemetry);

        if !direct.query_errors.is_empty() {
            detail.insert(
                "error".to_string(),
                Value::String("graph_kernel_partial_failure".to_string()),
            );
            detail.insert(
                "queryErrors".to_string(),
                Value::Array(
                    direct
                        .query_errors
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }

        Ok(GraphSourceExecution {
            stage: RecommendationStagePayload {
                name: GRAPH_SOURCE_NAME.to_string(),
                enabled: true,
                duration_ms: start.elapsed().as_millis() as u64,
                input_count: 1,
                output_count: direct.candidates.len(),
                removed_count: None,
                detail: Some(detail),
            },
            candidates: direct.candidates,
            provider_calls: direct.provider_calls,
            provider_latency_ms: direct.provider_latency_ms,
            breakdown,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use chrono::{DateTime, Utc};

    use super::authors::{
        GraphKernelAuthorAggregate, GraphKernelSourceKind, aggregate_graph_kernel_authors,
        apply_graph_metadata, map_graph_kernel_source_kind,
    };
    use super::materialization::{
        materializer_retry_limit_per_author, materializer_retry_lookback_days,
    };
    use crate::clients::graph_kernel_client::{
        GraphKernelBridgeCandidate, GraphKernelNeighborCandidate,
    };
    use crate::contracts::RecommendationCandidatePayload;

    fn candidate(author_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: "content".to_string(),
            created_at: DateTime::parse_from_rfc3339("2026-04-18T00:00:00Z")
                .expect("valid timestamp")
                .with_timezone(&Utc),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn aggregate_graph_kernel_authors_combines_multi_signal_scores() {
        let ranked = aggregate_graph_kernel_authors(
            &[GraphKernelNeighborCandidate {
                user_id: "author-1".to_string(),
                score: 8.0,
                interaction_probability: None,
                engagement_score: Some(6.0),
                recentness_score: Some(0.4),
                relation_kinds: vec!["follow".to_string(), "reply".to_string()],
            }],
            &[GraphKernelNeighborCandidate {
                user_id: "author-1".to_string(),
                score: 3.0,
                interaction_probability: None,
                engagement_score: Some(7.0),
                recentness_score: Some(0.9),
                relation_kinds: vec!["recent_activity".to_string()],
            }],
            &[GraphKernelBridgeCandidate {
                user_id: "author-2".to_string(),
                score: 4.0,
                depth: 2,
                path_count: 3,
                via_user_ids: vec!["bridge-a".to_string(), "bridge-b".to_string()],
                bridge_strength: Some(6.5),
                via_user_count: Some(2),
            }],
            &[],
            &[],
        );

        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].user_id, "author-1");
        assert!(ranked[0].total_score > ranked[1].total_score);
        assert!(
            ranked[0]
                .source_kinds
                .contains(&GraphKernelSourceKind::SocialNeighbor)
        );
        assert!(
            ranked[0]
                .source_kinds
                .contains(&GraphKernelSourceKind::RecentEngager)
        );
        assert!(ranked[1].via_user_ids.contains("bridge-a"));
    }

    #[test]
    fn apply_graph_metadata_marks_multi_signal_candidates() {
        let aggregate = GraphKernelAuthorAggregate {
            user_id: "author-1".to_string(),
            total_score: 12.4,
            dominant_score: 9.5,
            dominant_kind: GraphKernelSourceKind::SocialNeighbor,
            source_kinds: HashSet::from([
                GraphKernelSourceKind::SocialNeighbor,
                GraphKernelSourceKind::RecentEngager,
            ]),
            relation_kinds: HashSet::from([
                "reply".to_string(),
                "follow".to_string(),
                "recent_activity".to_string(),
            ]),
            via_user_ids: HashSet::new(),
        };

        let candidate = apply_graph_metadata(candidate("author-1"), &aggregate, 0);

        assert_eq!(
            candidate.recall_source.as_deref(),
            Some("GraphKernelSource")
        );
        assert_eq!(
            candidate.graph_recall_type.as_deref(),
            Some("cpp_graph_multi_signal")
        );
        assert_eq!(candidate.graph_score, Some(12.4));
        assert!(
            candidate
                .graph_path
                .as_deref()
                .is_some_and(|path| path.contains(map_graph_kernel_source_kind(
                    &GraphKernelSourceKind::SocialNeighbor
                )))
        );
        assert!(
            candidate
                .graph_path
                .as_deref()
                .is_some_and(|path| path.contains("relations:follow|recent_activity|reply"))
        );
    }

    #[test]
    fn materializer_retry_expands_to_sparse_corpus_window() {
        assert_eq!(materializer_retry_lookback_days(7), 180);
        assert_eq!(materializer_retry_lookback_days(42), 180);
        assert_eq!(materializer_retry_limit_per_author(2), 4);
        assert_eq!(materializer_retry_limit_per_author(8), 8);
    }
}
