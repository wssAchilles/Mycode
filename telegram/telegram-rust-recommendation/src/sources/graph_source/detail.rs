use std::collections::HashMap;

use serde_json::Value;
use telegram_source_primitives::graph_detail::{
    GRAPH_DETAIL_BUDGET_EXHAUSTED_KERNELS_FIELD, GRAPH_DETAIL_DOMINANCE_SHARE_FIELD,
    GRAPH_DETAIL_DOMINANT_KERNEL_SOURCE_FIELD, GRAPH_DETAIL_FALLBACK_FROM_FIELD,
    GRAPH_DETAIL_FALLBACK_REASON_FIELD, GRAPH_DETAIL_MATERIALIZER_CACHE_ENTRY_COUNT_FIELD,
    GRAPH_DETAIL_MATERIALIZER_CACHE_EVICTION_COUNT_FIELD,
    GRAPH_DETAIL_MATERIALIZER_CACHE_HIT_FIELD, GRAPH_DETAIL_MATERIALIZER_CACHE_KEY_MODE_FIELD,
    GRAPH_DETAIL_MATERIALIZER_CACHE_TTL_MS_FIELD, GRAPH_DETAIL_MATERIALIZER_FIELD,
    GRAPH_DETAIL_MATERIALIZER_PROVIDER_LATENCY_MS_FIELD,
    GRAPH_DETAIL_MATERIALIZER_QUERY_DURATION_MS_FIELD,
    GRAPH_DETAIL_MATERIALIZER_REQUESTED_AUTHOR_COUNT_FIELD,
    GRAPH_DETAIL_MATERIALIZER_RETRY_APPLIED_FIELD,
    GRAPH_DETAIL_MATERIALIZER_RETRY_LIMIT_PER_AUTHOR_FIELD,
    GRAPH_DETAIL_MATERIALIZER_RETRY_LOOKBACK_DAYS_FIELD,
    GRAPH_DETAIL_MATERIALIZER_RETRY_RECOVERED_FIELD,
    GRAPH_DETAIL_MATERIALIZER_RETURNED_POST_COUNT_FIELD,
    GRAPH_DETAIL_MATERIALIZER_UNIQUE_AUTHOR_COUNT_FIELD,
    GRAPH_DETAIL_PER_KERNEL_AVAILABLE_COUNTS_FIELD, GRAPH_DETAIL_PER_KERNEL_CANDIDATE_COUNTS_FIELD,
    GRAPH_DETAIL_PER_KERNEL_EMPTY_REASONS_FIELD, GRAPH_DETAIL_PER_KERNEL_ERRORS_FIELD,
    GRAPH_DETAIL_PER_KERNEL_LATENCY_MS_FIELD, GRAPH_DETAIL_PER_KERNEL_REQUESTED_LIMITS_FIELD,
    GRAPH_DETAIL_PER_KERNEL_RETURNED_COUNTS_FIELD, GRAPH_DETAIL_PER_KERNEL_TRUNCATED_COUNTS_FIELD,
    GRAPH_DETAIL_PROVIDER_FIELD, GRAPH_DETAIL_QUERY_ERRORS_FIELD, GRAPH_DETAIL_REASON_FIELD,
    string_array_to_json, string_map_to_json, u64_map_to_json, usize_map_to_json,
};

use crate::contracts::GraphAuthorMaterializationDiagnostics;
use crate::sources::contracts::{GraphKernelTelemetry, GraphRetrievalBreakdown};

use super::materialization::{MaterializerRetryDetail, MaterializerTelemetry};

pub(super) fn build_graph_source_detail(
    provider: &str,
    materializer: &str,
    telemetry: &GraphKernelTelemetry,
    query_errors: &[String],
    fallback_from: Option<&str>,
    fallback_reason: Option<&str>,
    breakdown: &GraphRetrievalBreakdown,
) -> HashMap<String, Value> {
    let mut detail = HashMap::from([
        (
            GRAPH_DETAIL_PROVIDER_FIELD.to_string(),
            Value::String(provider.to_string()),
        ),
        (
            GRAPH_DETAIL_MATERIALIZER_FIELD.to_string(),
            Value::String(materializer.to_string()),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_CANDIDATE_COUNTS_FIELD.to_string(),
            usize_map_to_json(&telemetry.per_kernel_candidate_counts),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_REQUESTED_LIMITS_FIELD.to_string(),
            usize_map_to_json(&telemetry.per_kernel_requested_limits),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_AVAILABLE_COUNTS_FIELD.to_string(),
            usize_map_to_json(&telemetry.per_kernel_available_counts),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_RETURNED_COUNTS_FIELD.to_string(),
            usize_map_to_json(&telemetry.per_kernel_returned_counts),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_TRUNCATED_COUNTS_FIELD.to_string(),
            usize_map_to_json(&telemetry.per_kernel_truncated_counts),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_LATENCY_MS_FIELD.to_string(),
            u64_map_to_json(&telemetry.per_kernel_latency_ms),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_EMPTY_REASONS_FIELD.to_string(),
            string_map_to_json(&telemetry.per_kernel_empty_reasons),
        ),
        (
            GRAPH_DETAIL_PER_KERNEL_ERRORS_FIELD.to_string(),
            string_map_to_json(&telemetry.per_kernel_errors),
        ),
        (
            GRAPH_DETAIL_BUDGET_EXHAUSTED_KERNELS_FIELD.to_string(),
            string_array_to_json(&telemetry.budget_exhausted_kernels),
        ),
    ]);

    if let Some(source) = breakdown.dominant_kernel_source.as_ref() {
        detail.insert(
            GRAPH_DETAIL_DOMINANT_KERNEL_SOURCE_FIELD.to_string(),
            Value::String(source.clone()),
        );
    }
    if let Some(share) = breakdown.dominance_share {
        detail.insert(
            GRAPH_DETAIL_DOMINANCE_SHARE_FIELD.to_string(),
            Value::from(share),
        );
    }
    if let Some(reason) = breakdown.empty_reason.as_ref() {
        detail.insert(
            GRAPH_DETAIL_REASON_FIELD.to_string(),
            Value::String(reason.clone()),
        );
    }
    if !query_errors.is_empty() {
        detail.insert(
            GRAPH_DETAIL_QUERY_ERRORS_FIELD.to_string(),
            string_array_to_json(query_errors),
        );
    }
    if let Some(fallback_from) = fallback_from {
        detail.insert(
            GRAPH_DETAIL_FALLBACK_FROM_FIELD.to_string(),
            Value::String(fallback_from.to_string()),
        );
    }
    if let Some(fallback_reason) = fallback_reason.filter(|value| !value.trim().is_empty()) {
        detail.insert(
            GRAPH_DETAIL_FALLBACK_REASON_FIELD.to_string(),
            Value::String(fallback_reason.to_string()),
        );
    }

    detail
}

pub(super) fn insert_materializer_retry_detail(
    detail: &mut HashMap<String, Value>,
    retry: &MaterializerRetryDetail,
) {
    detail.insert(
        GRAPH_DETAIL_MATERIALIZER_RETRY_APPLIED_FIELD.to_string(),
        Value::Bool(retry.applied),
    );
    detail.insert(
        GRAPH_DETAIL_MATERIALIZER_RETRY_RECOVERED_FIELD.to_string(),
        Value::Bool(retry.recovered),
    );
    if let Some(lookback_days) = retry.lookback_days {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_RETRY_LOOKBACK_DAYS_FIELD.to_string(),
            Value::from(lookback_days as u64),
        );
    }
    if let Some(limit_per_author) = retry.limit_per_author {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_RETRY_LIMIT_PER_AUTHOR_FIELD.to_string(),
            Value::from(limit_per_author as u64),
        );
    }
}

pub(super) fn build_materializer_telemetry(
    diagnostics: Option<&GraphAuthorMaterializationDiagnostics>,
    provider_latency_ms: u64,
) -> MaterializerTelemetry {
    let Some(diagnostics) = diagnostics else {
        return MaterializerTelemetry {
            provider_latency_ms: Some(provider_latency_ms),
            ..MaterializerTelemetry::default()
        };
    };

    MaterializerTelemetry {
        query_duration_ms: Some(diagnostics.query_duration_ms),
        provider_latency_ms: Some(provider_latency_ms),
        cache_hit: Some(diagnostics.cache_hit),
        requested_author_count: Some(diagnostics.requested_author_count),
        unique_author_count: Some(diagnostics.unique_author_count),
        returned_post_count: Some(diagnostics.returned_post_count),
        cache_key_mode: diagnostics.cache_key_mode.clone(),
        cache_ttl_ms: diagnostics.cache_ttl_ms,
        cache_entry_count: diagnostics.cache_entry_count,
        cache_eviction_count: diagnostics.cache_eviction_count,
    }
}

pub(super) fn apply_materializer_telemetry(
    breakdown: &mut GraphRetrievalBreakdown,
    telemetry: &MaterializerTelemetry,
) {
    breakdown.materializer_query_duration_ms = telemetry.query_duration_ms;
    breakdown.materializer_provider_latency_ms = telemetry.provider_latency_ms;
    breakdown.materializer_cache_hit = telemetry.cache_hit;
    breakdown.materializer_requested_author_count = telemetry.requested_author_count;
    breakdown.materializer_unique_author_count = telemetry.unique_author_count;
    breakdown.materializer_returned_post_count = telemetry.returned_post_count;
    breakdown.materializer_cache_key_mode = telemetry.cache_key_mode.clone();
    breakdown.materializer_cache_ttl_ms = telemetry.cache_ttl_ms;
    breakdown.materializer_cache_entry_count = telemetry.cache_entry_count;
    breakdown.materializer_cache_eviction_count = telemetry.cache_eviction_count;
}

pub(super) fn insert_materializer_telemetry_detail(
    detail: &mut HashMap<String, Value>,
    telemetry: &MaterializerTelemetry,
) {
    if let Some(query_duration_ms) = telemetry.query_duration_ms {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_QUERY_DURATION_MS_FIELD.to_string(),
            Value::from(query_duration_ms),
        );
    }
    if let Some(provider_latency_ms) = telemetry.provider_latency_ms {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_PROVIDER_LATENCY_MS_FIELD.to_string(),
            Value::from(provider_latency_ms),
        );
    }
    if let Some(cache_hit) = telemetry.cache_hit {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_CACHE_HIT_FIELD.to_string(),
            Value::Bool(cache_hit),
        );
    }
    if let Some(requested_author_count) = telemetry.requested_author_count {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_REQUESTED_AUTHOR_COUNT_FIELD.to_string(),
            Value::from(requested_author_count as u64),
        );
    }
    if let Some(unique_author_count) = telemetry.unique_author_count {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_UNIQUE_AUTHOR_COUNT_FIELD.to_string(),
            Value::from(unique_author_count as u64),
        );
    }
    if let Some(returned_post_count) = telemetry.returned_post_count {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_RETURNED_POST_COUNT_FIELD.to_string(),
            Value::from(returned_post_count as u64),
        );
    }
    if let Some(cache_key_mode) = telemetry.cache_key_mode.as_ref() {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_CACHE_KEY_MODE_FIELD.to_string(),
            Value::String(cache_key_mode.clone()),
        );
    }
    if let Some(cache_ttl_ms) = telemetry.cache_ttl_ms {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_CACHE_TTL_MS_FIELD.to_string(),
            Value::from(cache_ttl_ms),
        );
    }
    if let Some(cache_entry_count) = telemetry.cache_entry_count {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_CACHE_ENTRY_COUNT_FIELD.to_string(),
            Value::from(cache_entry_count as u64),
        );
    }
    if let Some(cache_eviction_count) = telemetry.cache_eviction_count {
        detail.insert(
            GRAPH_DETAIL_MATERIALIZER_CACHE_EVICTION_COUNT_FIELD.to_string(),
            Value::from(cache_eviction_count),
        );
    }
}
