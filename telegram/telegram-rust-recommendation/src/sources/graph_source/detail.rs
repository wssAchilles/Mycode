use std::collections::HashMap;

use serde_json::Value;

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
        ("provider".to_string(), Value::String(provider.to_string())),
        (
            "materializer".to_string(),
            Value::String(materializer.to_string()),
        ),
        (
            "perKernelCandidateCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_candidate_counts),
        ),
        (
            "perKernelRequestedLimits".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_requested_limits),
        ),
        (
            "perKernelAvailableCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_available_counts),
        ),
        (
            "perKernelReturnedCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_returned_counts),
        ),
        (
            "perKernelTruncatedCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_truncated_counts),
        ),
        (
            "perKernelLatencyMs".to_string(),
            hash_map_u64_to_json(&telemetry.per_kernel_latency_ms),
        ),
        (
            "perKernelEmptyReasons".to_string(),
            hash_map_string_to_json(&telemetry.per_kernel_empty_reasons),
        ),
        (
            "perKernelErrors".to_string(),
            hash_map_string_to_json(&telemetry.per_kernel_errors),
        ),
        (
            "budgetExhaustedKernels".to_string(),
            Value::Array(
                telemetry
                    .budget_exhausted_kernels
                    .iter()
                    .cloned()
                    .map(Value::String)
                    .collect(),
            ),
        ),
    ]);

    if let Some(source) = breakdown.dominant_kernel_source.as_ref() {
        detail.insert(
            "dominantKernelSource".to_string(),
            Value::String(source.clone()),
        );
    }
    if let Some(share) = breakdown.dominance_share {
        detail.insert("dominanceShare".to_string(), Value::from(share));
    }
    if let Some(reason) = breakdown.empty_reason.as_ref() {
        detail.insert("graphReason".to_string(), Value::String(reason.clone()));
    }
    if !query_errors.is_empty() {
        detail.insert(
            "queryErrors".to_string(),
            Value::Array(query_errors.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(fallback_from) = fallback_from {
        detail.insert(
            "fallbackFrom".to_string(),
            Value::String(fallback_from.to_string()),
        );
    }
    if let Some(fallback_reason) = fallback_reason.filter(|value| !value.trim().is_empty()) {
        detail.insert(
            "fallbackReason".to_string(),
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
        "materializerRetryApplied".to_string(),
        Value::Bool(retry.applied),
    );
    detail.insert(
        "materializerRetryRecovered".to_string(),
        Value::Bool(retry.recovered),
    );
    if let Some(lookback_days) = retry.lookback_days {
        detail.insert(
            "materializerRetryLookbackDays".to_string(),
            Value::from(lookback_days as u64),
        );
    }
    if let Some(limit_per_author) = retry.limit_per_author {
        detail.insert(
            "materializerRetryLimitPerAuthor".to_string(),
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
            "materializerQueryDurationMs".to_string(),
            Value::from(query_duration_ms),
        );
    }
    if let Some(provider_latency_ms) = telemetry.provider_latency_ms {
        detail.insert(
            "materializerProviderLatencyMs".to_string(),
            Value::from(provider_latency_ms),
        );
    }
    if let Some(cache_hit) = telemetry.cache_hit {
        detail.insert("materializerCacheHit".to_string(), Value::Bool(cache_hit));
    }
    if let Some(requested_author_count) = telemetry.requested_author_count {
        detail.insert(
            "materializerRequestedAuthorCount".to_string(),
            Value::from(requested_author_count as u64),
        );
    }
    if let Some(unique_author_count) = telemetry.unique_author_count {
        detail.insert(
            "materializerUniqueAuthorCount".to_string(),
            Value::from(unique_author_count as u64),
        );
    }
    if let Some(returned_post_count) = telemetry.returned_post_count {
        detail.insert(
            "materializerReturnedPostCount".to_string(),
            Value::from(returned_post_count as u64),
        );
    }
    if let Some(cache_key_mode) = telemetry.cache_key_mode.as_ref() {
        detail.insert(
            "materializerCacheKeyMode".to_string(),
            Value::String(cache_key_mode.clone()),
        );
    }
    if let Some(cache_ttl_ms) = telemetry.cache_ttl_ms {
        detail.insert(
            "materializerCacheTtlMs".to_string(),
            Value::from(cache_ttl_ms),
        );
    }
    if let Some(cache_entry_count) = telemetry.cache_entry_count {
        detail.insert(
            "materializerCacheEntryCount".to_string(),
            Value::from(cache_entry_count as u64),
        );
    }
    if let Some(cache_eviction_count) = telemetry.cache_eviction_count {
        detail.insert(
            "materializerCacheEvictionCount".to_string(),
            Value::from(cache_eviction_count),
        );
    }
}

fn hash_map_usize_to_json(values: &HashMap<String, usize>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value as u64)))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

fn hash_map_u64_to_json(values: &HashMap<String, u64>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value)))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

fn hash_map_string_to_json(values: &HashMap<String, String>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::String(value.clone())))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}
