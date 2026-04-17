use std::collections::HashMap;

use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GraphRetrievalBreakdown {
    pub total_candidates: usize,
    pub kernel_candidates: usize,
    pub legacy_candidates: usize,
    pub fallback_used: bool,
    pub empty_result: bool,
}

pub fn normalize_source_candidates(
    source_name: &str,
    candidates: Vec<RecommendationCandidatePayload>,
) -> Vec<RecommendationCandidatePayload> {
    candidates
        .into_iter()
        .map(|mut candidate| {
            if candidate
                .recall_source
                .as_ref()
                .is_none_or(|value| value.trim().is_empty())
            {
                candidate.recall_source = Some(source_name.to_string());
            }
            candidate
        })
        .collect()
}

pub fn classify_graph_retrieval(
    candidates: &[RecommendationCandidatePayload],
) -> GraphRetrievalBreakdown {
    let kernel_candidates = candidates
        .iter()
        .filter(|candidate| is_graph_kernel_candidate(candidate))
        .count();
    let total_candidates = candidates.len();
    let legacy_candidates = total_candidates.saturating_sub(kernel_candidates);

    GraphRetrievalBreakdown {
        total_candidates,
        kernel_candidates,
        legacy_candidates,
        fallback_used: legacy_candidates > 0,
        empty_result: total_candidates == 0,
    }
}

pub fn build_disabled_source_stage(
    source_name: &str,
    detail_key: &str,
    detail_value: &str,
) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: source_name.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count: 1,
        output_count: 0,
        removed_count: None,
        detail: Some(HashMap::from([(
            detail_key.to_string(),
            Value::String(detail_value.to_string()),
        )])),
    }
}

pub fn is_graph_kernel_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    candidate
        .recall_source
        .as_ref()
        .is_some_and(|value| value == "GraphKernelSource")
        || candidate
            .graph_recall_type
            .as_ref()
            .is_some_and(|value| value.starts_with("cpp_graph_"))
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;

    use super::{classify_graph_retrieval, normalize_source_candidates};
    use crate::contracts::RecommendationCandidatePayload;

    fn candidate(
        post_id: &str,
        recall_source: Option<&str>,
        graph_recall_type: Option<&str>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: format!("author-{post_id}"),
            content: format!("content-{post_id}"),
            created_at: DateTime::parse_from_rfc3339("2026-04-17T00:00:00.000Z")
                .expect("valid fixture timestamp")
                .to_utc(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: recall_source.map(ToOwned::to_owned),
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
            graph_recall_type: graph_recall_type.map(ToOwned::to_owned),
        }
    }

    #[test]
    fn classify_graph_retrieval_distinguishes_kernel_and_legacy_candidates() {
        let breakdown = classify_graph_retrieval(&[
            candidate("1", Some("GraphKernelSource"), Some("cpp_graph_depth_1")),
            candidate("2", Some("GraphSource"), Some("friend_of_friend")),
            candidate("3", Some("GraphSource"), None),
        ]);

        assert_eq!(breakdown.total_candidates, 3);
        assert_eq!(breakdown.kernel_candidates, 1);
        assert_eq!(breakdown.legacy_candidates, 2);
        assert!(breakdown.fallback_used);
        assert!(!breakdown.empty_result);
    }

    #[test]
    fn normalize_source_candidates_backfills_missing_recall_source() {
        let normalized = normalize_source_candidates(
            "PopularSource",
            vec![
                candidate("1", None, None),
                candidate("2", Some("CustomSource"), None),
            ],
        );

        assert_eq!(
            normalized[0].recall_source.as_deref(),
            Some("PopularSource")
        );
        assert_eq!(normalized[1].recall_source.as_deref(), Some("CustomSource"));
    }
}
