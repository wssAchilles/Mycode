use std::collections::HashMap;

use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct GraphRetrievalBreakdown {
    pub total_candidates: usize,
    pub kernel_candidates: usize,
    pub legacy_candidates: usize,
    pub fallback_used: bool,
    pub empty_result: bool,
    pub kernel_source_counts: HashMap<String, usize>,
    pub materializer_query_duration_ms: Option<u64>,
    pub materializer_provider_latency_ms: Option<u64>,
    pub materializer_cache_hit: Option<bool>,
    pub materializer_requested_author_count: Option<usize>,
    pub materializer_unique_author_count: Option<usize>,
    pub materializer_returned_post_count: Option<usize>,
    pub materializer_cache_key_mode: Option<String>,
    pub materializer_cache_ttl_ms: Option<u64>,
    pub materializer_cache_entry_count: Option<usize>,
    pub materializer_cache_eviction_count: Option<u64>,
    pub per_kernel_candidate_counts: HashMap<String, usize>,
    pub per_kernel_requested_limits: HashMap<String, usize>,
    pub per_kernel_available_counts: HashMap<String, usize>,
    pub per_kernel_returned_counts: HashMap<String, usize>,
    pub per_kernel_truncated_counts: HashMap<String, usize>,
    pub per_kernel_latency_ms: HashMap<String, u64>,
    pub per_kernel_empty_reasons: HashMap<String, String>,
    pub per_kernel_errors: HashMap<String, String>,
    pub budget_exhausted_kernels: Vec<String>,
    pub dominant_kernel_source: Option<String>,
    pub dominance_share: Option<f64>,
    pub empty_reason: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GraphKernelTelemetry {
    pub per_kernel_candidate_counts: HashMap<String, usize>,
    pub per_kernel_requested_limits: HashMap<String, usize>,
    pub per_kernel_available_counts: HashMap<String, usize>,
    pub per_kernel_returned_counts: HashMap<String, usize>,
    pub per_kernel_truncated_counts: HashMap<String, usize>,
    pub per_kernel_latency_ms: HashMap<String, u64>,
    pub per_kernel_empty_reasons: HashMap<String, String>,
    pub per_kernel_errors: HashMap<String, String>,
    pub budget_exhausted_kernels: Vec<String>,
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
    fallback_used: bool,
    telemetry: &GraphKernelTelemetry,
    upstream_reason: Option<&str>,
) -> GraphRetrievalBreakdown {
    let kernel_source_counts = if telemetry.per_kernel_candidate_counts.is_empty() {
        derive_kernel_source_counts(candidates)
    } else {
        telemetry.per_kernel_candidate_counts.clone()
    };
    let total_candidates = candidates.len();
    let kernel_candidates = if fallback_used { 0 } else { total_candidates };
    let legacy_candidates = if fallback_used { total_candidates } else { 0 };
    let dominant_kernel_source = kernel_source_counts
        .iter()
        .max_by(|left, right| left.1.cmp(right.1).then_with(|| right.0.cmp(left.0)))
        .map(|(key, _)| key.clone());
    let dominance_share = dominant_kernel_source
        .as_ref()
        .and_then(|key| kernel_source_counts.get(key).copied())
        .and_then(|count| {
            let total = kernel_source_counts.values().copied().sum::<usize>();
            (total > 0).then_some(count as f64 / total as f64)
        });

    GraphRetrievalBreakdown {
        total_candidates,
        kernel_candidates,
        legacy_candidates,
        fallback_used,
        empty_result: total_candidates == 0,
        kernel_source_counts: kernel_source_counts.clone(),
        materializer_query_duration_ms: None,
        materializer_provider_latency_ms: None,
        materializer_cache_hit: None,
        materializer_requested_author_count: None,
        materializer_unique_author_count: None,
        materializer_returned_post_count: None,
        materializer_cache_key_mode: None,
        materializer_cache_ttl_ms: None,
        materializer_cache_entry_count: None,
        materializer_cache_eviction_count: None,
        per_kernel_candidate_counts: kernel_source_counts,
        per_kernel_requested_limits: telemetry.per_kernel_requested_limits.clone(),
        per_kernel_available_counts: telemetry.per_kernel_available_counts.clone(),
        per_kernel_returned_counts: telemetry.per_kernel_returned_counts.clone(),
        per_kernel_truncated_counts: telemetry.per_kernel_truncated_counts.clone(),
        per_kernel_latency_ms: telemetry.per_kernel_latency_ms.clone(),
        per_kernel_empty_reasons: telemetry.per_kernel_empty_reasons.clone(),
        per_kernel_errors: telemetry.per_kernel_errors.clone(),
        budget_exhausted_kernels: telemetry.budget_exhausted_kernels.clone(),
        dominant_kernel_source,
        dominance_share,
        empty_reason: normalize_graph_empty_reason(
            fallback_used,
            upstream_reason,
            &telemetry.per_kernel_errors,
            total_candidates == 0,
        ),
    }
}

fn derive_kernel_source_counts(
    candidates: &[RecommendationCandidatePayload],
) -> HashMap<String, usize> {
    let mut kernel_source_counts = HashMap::new();

    for candidate in candidates
        .iter()
        .filter(|candidate| is_graph_kernel_candidate(candidate))
    {
        let key = candidate
            .graph_recall_type
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "cpp_graph_unknown".to_string());
        *kernel_source_counts.entry(key).or_insert(0) += 1;
    }

    kernel_source_counts
}

fn normalize_graph_empty_reason(
    fallback_used: bool,
    upstream_reason: Option<&str>,
    per_kernel_errors: &HashMap<String, String>,
    empty_result: bool,
) -> Option<String> {
    match upstream_reason
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("all_kernels_empty") => return Some("all_kernels_empty".to_string()),
        Some("all_kernels_failed") => return Some("all_kernels_failed".to_string()),
        Some("partial_kernel_failure") => return Some("partial_kernel_failure".to_string()),
        Some("authors_materialized_empty") => {
            return Some("authors_materialized_empty".to_string());
        }
        Some("authors_materialized_empty_after_retry") => {
            return Some("authors_materialized_empty_after_retry".to_string());
        }
        Some("graph_author_materializer_failed") => {
            return Some("graph_author_materializer_failed".to_string());
        }
        Some("graph_author_materializer_retry_failed") => {
            return Some("graph_author_materializer_retry_failed".to_string());
        }
        _ => {}
    }

    if fallback_used {
        return Some("legacy_fallback_used".to_string());
    }

    if !per_kernel_errors.is_empty() {
        return Some("partial_kernel_failure".to_string());
    }

    if empty_result {
        return Some("all_kernels_empty".to_string());
    }

    None
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

pub fn build_failed_source_stage(
    source_name: &str,
    error: &str,
    duration_ms: u64,
) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: source_name.to_string(),
        enabled: true,
        duration_ms,
        input_count: 1,
        output_count: 0,
        removed_count: None,
        detail: Some(HashMap::from([
            ("error".to_string(), Value::String(error.to_string())),
            (
                "executionMode".to_string(),
                Value::String("parallel_bounded".to_string()),
            ),
            (
                "degradeMode".to_string(),
                Value::String("fail_open".to_string()),
            ),
        ])),
    }
}

pub fn build_failed_graph_breakdown() -> GraphRetrievalBreakdown {
    GraphRetrievalBreakdown {
        empty_result: true,
        empty_reason: Some("all_kernels_failed".to_string()),
        ..GraphRetrievalBreakdown::default()
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
    use std::collections::HashMap;

    use chrono::DateTime;

    use super::{
        GraphKernelTelemetry, build_failed_graph_breakdown, build_failed_source_stage,
        classify_graph_retrieval, normalize_source_candidates,
    };
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
        let breakdown = classify_graph_retrieval(
            &[
                candidate("1", Some("GraphKernelSource"), Some("cpp_graph_depth_1")),
                candidate("2", Some("GraphSource"), Some("friend_of_friend")),
                candidate("3", Some("GraphSource"), None),
            ],
            true,
            &GraphKernelTelemetry::default(),
            Some("all_kernels_empty"),
        );

        assert_eq!(breakdown.total_candidates, 3);
        assert_eq!(breakdown.kernel_candidates, 0);
        assert_eq!(breakdown.legacy_candidates, 3);
        assert!(breakdown.fallback_used);
        assert!(!breakdown.empty_result);
        assert_eq!(
            breakdown.kernel_source_counts.get("cpp_graph_depth_1"),
            Some(&1)
        );
        assert_eq!(
            breakdown.dominant_kernel_source.as_deref(),
            Some("cpp_graph_depth_1")
        );
        assert_eq!(breakdown.empty_reason.as_deref(), Some("all_kernels_empty"));
    }

    #[test]
    fn classify_graph_retrieval_keeps_legacy_reason_when_upstream_reason_is_missing() {
        let breakdown = classify_graph_retrieval(
            &[candidate("1", Some("GraphSource"), None)],
            true,
            &GraphKernelTelemetry::default(),
            None,
        );

        assert_eq!(
            breakdown.empty_reason.as_deref(),
            Some("legacy_fallback_used")
        );
    }

    #[test]
    fn classify_graph_retrieval_preserves_materializer_retry_empty_reason() {
        let breakdown = classify_graph_retrieval(
            &[],
            true,
            &GraphKernelTelemetry::default(),
            Some("authors_materialized_empty_after_retry"),
        );

        assert_eq!(
            breakdown.empty_reason.as_deref(),
            Some("authors_materialized_empty_after_retry")
        );
    }

    #[test]
    fn builds_failed_source_stage_with_parallel_fail_open_detail() {
        let stage = build_failed_source_stage("PopularSource", "upstream_timeout", 19);

        assert!(stage.enabled);
        assert_eq!(stage.duration_ms, 19);
        assert_eq!(stage.output_count, 0);
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("error"))
                .and_then(|value| value.as_str()),
            Some("upstream_timeout")
        );
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("executionMode"))
                .and_then(|value| value.as_str()),
            Some("parallel_bounded")
        );
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("degradeMode"))
                .and_then(|value| value.as_str()),
            Some("fail_open")
        );
    }

    #[test]
    fn builds_failed_graph_breakdown_as_all_kernels_failed() {
        let breakdown = build_failed_graph_breakdown();

        assert!(breakdown.empty_result);
        assert_eq!(
            breakdown.empty_reason.as_deref(),
            Some("all_kernels_failed")
        );
        assert!(!breakdown.fallback_used);
        assert_eq!(breakdown.total_candidates, 0);
    }

    #[test]
    fn classify_graph_retrieval_reports_per_kernel_details_and_partial_failure() {
        let breakdown = classify_graph_retrieval(
            &[candidate(
                "1",
                Some("GraphKernelSource"),
                Some("cpp_graph_social_neighbor"),
            )],
            false,
            &GraphKernelTelemetry {
                per_kernel_candidate_counts: HashMap::from([
                    ("social_neighbors".to_string(), 5),
                    ("recent_engagers".to_string(), 2),
                ]),
                per_kernel_requested_limits: HashMap::from([
                    ("social_neighbors".to_string(), 48),
                    ("recent_engagers".to_string(), 48),
                ]),
                per_kernel_available_counts: HashMap::from([
                    ("social_neighbors".to_string(), 9),
                    ("recent_engagers".to_string(), 2),
                ]),
                per_kernel_returned_counts: HashMap::from([
                    ("social_neighbors".to_string(), 5),
                    ("recent_engagers".to_string(), 2),
                ]),
                per_kernel_truncated_counts: HashMap::from([("social_neighbors".to_string(), 4)]),
                per_kernel_latency_ms: HashMap::from([
                    ("social_neighbors".to_string(), 14),
                    ("recent_engagers".to_string(), 18),
                ]),
                per_kernel_empty_reasons: HashMap::from([(
                    "content_affinity_neighbors".to_string(),
                    "no_content_affinity_neighbors".to_string(),
                )]),
                per_kernel_errors: HashMap::from([(
                    "bridge_users".to_string(),
                    "graph_kernel_request_failed".to_string(),
                )]),
                budget_exhausted_kernels: vec!["social_neighbors".to_string()],
            },
            None,
        );

        assert_eq!(
            breakdown
                .per_kernel_candidate_counts
                .get("social_neighbors"),
            Some(&5)
        );
        assert_eq!(
            breakdown.per_kernel_latency_ms.get("recent_engagers"),
            Some(&18)
        );
        assert_eq!(
            breakdown
                .per_kernel_requested_limits
                .get("social_neighbors"),
            Some(&48)
        );
        assert_eq!(
            breakdown
                .per_kernel_available_counts
                .get("social_neighbors"),
            Some(&9)
        );
        assert_eq!(
            breakdown
                .per_kernel_truncated_counts
                .get("social_neighbors"),
            Some(&4)
        );
        assert_eq!(
            breakdown
                .per_kernel_empty_reasons
                .get("content_affinity_neighbors")
                .map(String::as_str),
            Some("no_content_affinity_neighbors")
        );
        assert_eq!(
            breakdown
                .per_kernel_errors
                .get("bridge_users")
                .map(String::as_str),
            Some("graph_kernel_request_failed")
        );
        assert_eq!(
            breakdown.dominant_kernel_source.as_deref(),
            Some("social_neighbors")
        );
        assert_eq!(
            breakdown.budget_exhausted_kernels,
            vec!["social_neighbors".to_string()]
        );
        assert_eq!(breakdown.dominance_share, Some(5.0 / 7.0));
        assert_eq!(
            breakdown.empty_reason.as_deref(),
            Some("partial_kernel_failure")
        );
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
