use std::collections::HashMap;

use serde_json::Value;

pub const GRAPH_DETAIL_PROVIDER_FIELD: &str = "provider";
pub const GRAPH_DETAIL_MATERIALIZER_FIELD: &str = "materializer";
pub const GRAPH_DETAIL_PER_KERNEL_CANDIDATE_COUNTS_FIELD: &str = "perKernelCandidateCounts";
pub const GRAPH_DETAIL_PER_KERNEL_REQUESTED_LIMITS_FIELD: &str = "perKernelRequestedLimits";
pub const GRAPH_DETAIL_PER_KERNEL_AVAILABLE_COUNTS_FIELD: &str = "perKernelAvailableCounts";
pub const GRAPH_DETAIL_PER_KERNEL_RETURNED_COUNTS_FIELD: &str = "perKernelReturnedCounts";
pub const GRAPH_DETAIL_PER_KERNEL_TRUNCATED_COUNTS_FIELD: &str = "perKernelTruncatedCounts";
pub const GRAPH_DETAIL_PER_KERNEL_LATENCY_MS_FIELD: &str = "perKernelLatencyMs";
pub const GRAPH_DETAIL_PER_KERNEL_EMPTY_REASONS_FIELD: &str = "perKernelEmptyReasons";
pub const GRAPH_DETAIL_PER_KERNEL_ERRORS_FIELD: &str = "perKernelErrors";
pub const GRAPH_DETAIL_BUDGET_EXHAUSTED_KERNELS_FIELD: &str = "budgetExhaustedKernels";
pub const GRAPH_DETAIL_DOMINANT_KERNEL_SOURCE_FIELD: &str = "dominantKernelSource";
pub const GRAPH_DETAIL_DOMINANCE_SHARE_FIELD: &str = "dominanceShare";
pub const GRAPH_DETAIL_REASON_FIELD: &str = "graphReason";
pub const GRAPH_DETAIL_QUERY_ERRORS_FIELD: &str = "queryErrors";
pub const GRAPH_DETAIL_FALLBACK_FROM_FIELD: &str = "fallbackFrom";
pub const GRAPH_DETAIL_FALLBACK_REASON_FIELD: &str = "fallbackReason";

pub const GRAPH_DETAIL_MATERIALIZER_RETRY_APPLIED_FIELD: &str = "materializerRetryApplied";
pub const GRAPH_DETAIL_MATERIALIZER_RETRY_RECOVERED_FIELD: &str = "materializerRetryRecovered";
pub const GRAPH_DETAIL_MATERIALIZER_RETRY_LOOKBACK_DAYS_FIELD: &str =
    "materializerRetryLookbackDays";
pub const GRAPH_DETAIL_MATERIALIZER_RETRY_LIMIT_PER_AUTHOR_FIELD: &str =
    "materializerRetryLimitPerAuthor";
pub const GRAPH_DETAIL_MATERIALIZER_QUERY_DURATION_MS_FIELD: &str = "materializerQueryDurationMs";
pub const GRAPH_DETAIL_MATERIALIZER_PROVIDER_LATENCY_MS_FIELD: &str =
    "materializerProviderLatencyMs";
pub const GRAPH_DETAIL_MATERIALIZER_CACHE_HIT_FIELD: &str = "materializerCacheHit";
pub const GRAPH_DETAIL_MATERIALIZER_REQUESTED_AUTHOR_COUNT_FIELD: &str =
    "materializerRequestedAuthorCount";
pub const GRAPH_DETAIL_MATERIALIZER_UNIQUE_AUTHOR_COUNT_FIELD: &str =
    "materializerUniqueAuthorCount";
pub const GRAPH_DETAIL_MATERIALIZER_RETURNED_POST_COUNT_FIELD: &str =
    "materializerReturnedPostCount";
pub const GRAPH_DETAIL_MATERIALIZER_CACHE_KEY_MODE_FIELD: &str = "materializerCacheKeyMode";
pub const GRAPH_MATERIALIZER_CACHE_KEY_MODE: &str = "rust_author_ids_limit_lookback_v1";
pub const GRAPH_DETAIL_MATERIALIZER_CACHE_TTL_MS_FIELD: &str = "materializerCacheTtlMs";
pub const GRAPH_DETAIL_MATERIALIZER_CACHE_ENTRY_COUNT_FIELD: &str = "materializerCacheEntryCount";
pub const GRAPH_DETAIL_MATERIALIZER_CACHE_EVICTION_COUNT_FIELD: &str =
    "materializerCacheEvictionCount";

pub const GRAPH_REASON_ALL_KERNELS_EMPTY: &str = "all_kernels_empty";
pub const GRAPH_REASON_ALL_KERNELS_FAILED: &str = "all_kernels_failed";
pub const GRAPH_REASON_PARTIAL_KERNEL_FAILURE: &str = "partial_kernel_failure";
pub const GRAPH_REASON_AUTHORS_MATERIALIZED_EMPTY: &str = "authors_materialized_empty";
pub const GRAPH_REASON_AUTHORS_MATERIALIZED_EMPTY_AFTER_RETRY: &str =
    "authors_materialized_empty_after_retry";
pub const GRAPH_REASON_AUTHOR_MATERIALIZER_FAILED: &str = "graph_author_materializer_failed";
pub const GRAPH_REASON_AUTHOR_MATERIALIZER_RETRY_FAILED: &str =
    "graph_author_materializer_retry_failed";
pub const GRAPH_REASON_LEGACY_FALLBACK_USED: &str = "legacy_fallback_used";
pub const GRAPH_UNKNOWN_KERNEL_SOURCE: &str = "cpp_graph_unknown";

pub fn usize_map_to_json(values: &HashMap<String, usize>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value as u64)))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

pub fn u64_map_to_json(values: &HashMap<String, u64>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value)))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

pub fn string_map_to_json(values: &HashMap<String, String>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::String(value.clone())))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

pub fn string_array_to_json(values: &[String]) -> Value {
    Value::Array(values.iter().cloned().map(Value::String).collect())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        GRAPH_DETAIL_PER_KERNEL_CANDIDATE_COUNTS_FIELD, GRAPH_REASON_ALL_KERNELS_EMPTY,
        GRAPH_UNKNOWN_KERNEL_SOURCE, string_array_to_json, string_map_to_json, u64_map_to_json,
        usize_map_to_json,
    };

    #[test]
    fn exports_graph_detail_field_contract() {
        assert_eq!(
            GRAPH_DETAIL_PER_KERNEL_CANDIDATE_COUNTS_FIELD,
            "perKernelCandidateCounts"
        );
        assert_eq!(GRAPH_REASON_ALL_KERNELS_EMPTY, "all_kernels_empty");
        assert_eq!(GRAPH_UNKNOWN_KERNEL_SOURCE, "cpp_graph_unknown");
    }

    #[test]
    fn converts_graph_detail_maps_to_json_objects() {
        let value = usize_map_to_json(&HashMap::from([("depth_1".to_string(), 3)]));
        assert_eq!(
            value
                .as_object()
                .and_then(|object| object.get("depth_1"))
                .and_then(serde_json::Value::as_u64),
            Some(3)
        );

        let value = u64_map_to_json(&HashMap::from([("depth_1".to_string(), 17)]));
        assert_eq!(
            value
                .as_object()
                .and_then(|object| object.get("depth_1"))
                .and_then(serde_json::Value::as_u64),
            Some(17)
        );

        let value = string_map_to_json(&HashMap::from([(
            "depth_1".to_string(),
            "no_neighbors".to_string(),
        )]));
        assert_eq!(
            value
                .as_object()
                .and_then(|object| object.get("depth_1"))
                .and_then(serde_json::Value::as_str),
            Some("no_neighbors")
        );
    }

    #[test]
    fn converts_string_arrays_to_json_arrays() {
        let value = string_array_to_json(&["depth_1".to_string()]);

        assert_eq!(
            value
                .as_array()
                .and_then(|values| values.first())
                .and_then(serde_json::Value::as_str),
            Some("depth_1")
        );
    }
}
