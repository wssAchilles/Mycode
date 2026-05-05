use std::collections::HashMap;

use crate::contracts::RecommendationGraphRetrievalPayload;

use crate::sources::contracts::GraphRetrievalBreakdown;

pub(super) fn empty_graph_summary() -> RecommendationGraphRetrievalPayload {
    RecommendationGraphRetrievalPayload {
        total_candidates: 0,
        kernel_candidates: 0,
        legacy_candidates: 0,
        fallback_used: false,
        empty_result: false,
        kernel_source_counts: HashMap::new(),
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
        per_kernel_candidate_counts: HashMap::new(),
        per_kernel_requested_limits: HashMap::new(),
        per_kernel_available_counts: HashMap::new(),
        per_kernel_returned_counts: HashMap::new(),
        per_kernel_truncated_counts: HashMap::new(),
        per_kernel_latency_ms: HashMap::new(),
        per_kernel_empty_reasons: HashMap::new(),
        per_kernel_errors: HashMap::new(),
        budget_exhausted_kernels: Vec::new(),
        dominant_kernel_source: None,
        dominance_share: None,
        empty_reason: None,
    }
}

pub(super) fn apply_graph_breakdown(
    summary: &mut RecommendationGraphRetrievalPayload,
    breakdown: GraphRetrievalBreakdown,
    degraded_reasons: &mut Vec<String>,
) {
    summary.total_candidates = breakdown.total_candidates;
    summary.kernel_candidates = breakdown.kernel_candidates;
    summary.legacy_candidates = breakdown.legacy_candidates;
    summary.fallback_used = breakdown.fallback_used;
    summary.empty_result = breakdown.empty_result;
    summary.kernel_source_counts = breakdown.kernel_source_counts;
    summary.materializer_query_duration_ms = breakdown.materializer_query_duration_ms;
    summary.materializer_provider_latency_ms = breakdown.materializer_provider_latency_ms;
    summary.materializer_cache_hit = breakdown.materializer_cache_hit;
    summary.materializer_requested_author_count = breakdown.materializer_requested_author_count;
    summary.materializer_unique_author_count = breakdown.materializer_unique_author_count;
    summary.materializer_returned_post_count = breakdown.materializer_returned_post_count;
    summary.materializer_cache_key_mode = breakdown.materializer_cache_key_mode;
    summary.materializer_cache_ttl_ms = breakdown.materializer_cache_ttl_ms;
    summary.materializer_cache_entry_count = breakdown.materializer_cache_entry_count;
    summary.materializer_cache_eviction_count = breakdown.materializer_cache_eviction_count;
    summary.per_kernel_candidate_counts = breakdown.per_kernel_candidate_counts;
    summary.per_kernel_requested_limits = breakdown.per_kernel_requested_limits;
    summary.per_kernel_available_counts = breakdown.per_kernel_available_counts;
    summary.per_kernel_returned_counts = breakdown.per_kernel_returned_counts;
    summary.per_kernel_truncated_counts = breakdown.per_kernel_truncated_counts;
    summary.per_kernel_latency_ms = breakdown.per_kernel_latency_ms;
    summary.per_kernel_empty_reasons = breakdown.per_kernel_empty_reasons;
    summary.per_kernel_errors = breakdown.per_kernel_errors;
    summary.budget_exhausted_kernels = breakdown.budget_exhausted_kernels;
    summary.dominant_kernel_source = breakdown.dominant_kernel_source;
    summary.dominance_share = breakdown.dominance_share;
    summary.empty_reason = breakdown.empty_reason;

    match summary.empty_reason.as_deref() {
        Some("legacy_fallback_used") => {
            degraded_reasons.push("graph_source:legacy_fallback".to_string());
        }
        Some("all_kernels_empty") => {
            degraded_reasons.push("graph_source:all_kernels_empty".to_string());
        }
        Some("all_kernels_failed") => {
            degraded_reasons.push("graph_source:all_kernels_failed".to_string());
        }
        Some("partial_kernel_failure") => {
            degraded_reasons.push("graph_source:partial_kernel_failure".to_string());
        }
        Some("authors_materialized_empty") => {
            degraded_reasons.push("graph_source:authors_materialized_empty".to_string());
        }
        Some("authors_materialized_empty_after_retry") => {
            degraded_reasons
                .push("graph_source:authors_materialized_empty_after_retry".to_string());
        }
        Some("graph_author_materializer_failed") => {
            degraded_reasons.push("graph_source:graph_author_materializer_failed".to_string());
        }
        Some("graph_author_materializer_retry_failed") => {
            degraded_reasons
                .push("graph_source:graph_author_materializer_retry_failed".to_string());
        }
        _ => {}
    }
}
