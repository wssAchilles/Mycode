use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};

use crate::contracts::{RecommendationQueryPayload, RecommendationResultPayload};

pub const CACHE_KEY_MODE: &str = "normalized_query_v2";
pub const CACHE_POLICY_MODE: &str = "bounded_short_ttl_v1";

#[derive(Debug, Clone)]
pub struct ServeCacheStorePolicy {
    pub cacheable: bool,
    pub reason: String,
}

pub fn build_query_fingerprint(query: &RecommendationQueryPayload) -> String {
    let mut payload = serde_json::to_value(query).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut payload {
        map.remove("requestId");
        normalize_string_array(map, "seenIds");
        normalize_string_array(map, "servedIds");
        normalize_case(map, "countryCode", |value| value.to_ascii_uppercase());
        normalize_case(map, "languageCode", |value| value.to_ascii_lowercase());
        normalize_cursor(map, "cursor");
    }

    let mut hasher = DefaultHasher::new();
    hash_json_value(&payload, &mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn evaluate_store_policy(
    query: &RecommendationQueryPayload,
    result: &RecommendationResultPayload,
    enabled: bool,
) -> ServeCacheStorePolicy {
    if !enabled {
        return ServeCacheStorePolicy {
            cacheable: false,
            reason: "cache_disabled".to_string(),
        };
    }

    if result.candidates.is_empty() {
        return ServeCacheStorePolicy {
            cacheable: false,
            reason: "empty_result".to_string(),
        };
    }

    if result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason.contains("self_post_rescue"))
    {
        return ServeCacheStorePolicy {
            cacheable: false,
            reason: "self_post_rescue_applied".to_string(),
        };
    }

    if result
        .summary
        .degraded_reasons
        .iter()
        .any(|reason| reason.contains("timeout"))
    {
        return ServeCacheStorePolicy {
            cacheable: false,
            reason: "timeout_degraded".to_string(),
        };
    }

    let reason = if query.cursor.is_none() && query.served_ids.is_empty() {
        "first_page_stable"
    } else if query.cursor.is_some() {
        "cursor_replay_stable"
    } else if !query.served_ids.is_empty() {
        "served_state_replay_stable"
    } else {
        "bounded_replay_stable"
    };

    ServeCacheStorePolicy {
        cacheable: true,
        reason: reason.to_string(),
    }
}

fn normalize_string_array(map: &mut Map<String, Value>, key: &str) {
    let Some(Value::Array(entries)) = map.get_mut(key) else {
        return;
    };

    let mut normalized = entries
        .iter()
        .filter_map(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    normalized.sort_unstable();
    normalized.dedup();

    *entries = normalized.into_iter().map(Value::String).collect();
}

fn normalize_case<F>(map: &mut Map<String, Value>, key: &str, normalize: F)
where
    F: Fn(&str) -> String,
{
    let Some(Value::String(value)) = map.get_mut(key) else {
        return;
    };

    *value = normalize(value.trim());
}

fn normalize_cursor(map: &mut Map<String, Value>, key: &str) {
    let Some(Value::String(value)) = map.get_mut(key) else {
        return;
    };

    let trimmed = value.trim();
    if trimmed.is_empty() {
        *value = String::new();
        return;
    }

    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        *value = parsed
            .with_timezone(&Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    } else {
        *value = trimmed.to_string();
    }
}

fn hash_json_value(value: &Value, hasher: &mut DefaultHasher) {
    match value {
        Value::Null => {
            "null".hash(hasher);
        }
        Value::Bool(boolean) => {
            "bool".hash(hasher);
            boolean.hash(hasher);
        }
        Value::Number(number) => {
            "number".hash(hasher);
            number.to_string().hash(hasher);
        }
        Value::String(string) => {
            "string".hash(hasher);
            string.hash(hasher);
        }
        Value::Array(values) => {
            "array".hash(hasher);
            values.len().hash(hasher);
            for value in values {
                hash_json_value(value, hasher);
            }
        }
        Value::Object(entries) => {
            "object".hash(hasher);
            let mut keys = entries.keys().cloned().collect::<Vec<_>>();
            keys.sort_unstable();
            for key in keys {
                key.hash(hasher);
                if let Some(value) = entries.get(&key) {
                    hash_json_value(value, hasher);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{build_query_fingerprint, evaluate_store_policy};
    use crate::contracts::{
        RecommendationCandidatePayload, RecommendationGraphRetrievalPayload,
        RecommendationRankingSummaryPayload, RecommendationResultPayload,
        RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
        RecommendationServingSummaryPayload, RecommendationSummaryPayload,
    };
    use chrono::{DateTime, TimeZone, Utc};
    use std::collections::HashMap;

    fn query() -> crate::contracts::RecommendationQueryPayload {
        crate::contracts::RecommendationQueryPayload {
            request_id: "req-1".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 10,
            cursor: Some(Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap()),
            in_network_only: false,
            seen_ids: vec!["b".to_string(), "a".to_string(), "a".to_string()],
            served_ids: vec!["post-2".to_string(), "post-1".to_string()],
            is_bottom_request: true,
            client_app_id: Some(1),
            country_code: Some("cn".to_string()),
            language_code: Some("ZH".to_string()),
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        }
    }

    fn result() -> RecommendationResultPayload {
        let candidate = RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "hello".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("GraphSource".to_string()),
            retrieval_lane: None,
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
            weighted_score: Some(1.0),
            score: Some(1.0),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: Some(1.0),
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        };

        RecommendationResultPayload {
            request_id: "req-1".to_string(),
            serving_version: "rust_serving_v1".to_string(),
            cursor: None,
            next_cursor: None,
            has_more: false,
            served_state_version: "related_ids_v1".to_string(),
            stable_order_key: "stable-order-key".to_string(),
            candidates: vec![candidate],
            summary: RecommendationSummaryPayload {
                request_id: "req-1".to_string(),
                stage: "retrieval_ranking_v2".to_string(),
                pipeline_version: "xalgo_candidate_pipeline_v6".to_string(),
                owner: "rust".to_string(),
                fallback_mode: "node_provider_surface_with_cpp_graph_primary".to_string(),
                provider_calls: HashMap::new(),
                provider_latency_ms: HashMap::new(),
                retrieved_count: 1,
                selected_count: 1,
                source_counts: HashMap::new(),
                filter_drop_counts: HashMap::new(),
                stage_timings: HashMap::new(),
                stage_latency_ms: HashMap::new(),
                degraded_reasons: Vec::new(),
                recent_hot_applied: false,
                selector: RecommendationSelectorPayload {
                    oversample_factor: 5,
                    max_size: 200,
                    final_limit: 10,
                    truncated: false,
                },
                serving: RecommendationServingSummaryPayload {
                    serving_version: "rust_serving_v1".to_string(),
                    cursor_mode: "created_at_desc_v1".to_string(),
                    cursor: None,
                    next_cursor: None,
                    has_more: false,
                    served_state_version: "related_ids_v1".to_string(),
                    stable_order_key: "stable-order-key".to_string(),
                    duplicate_suppressed_count: 0,
                    cross_page_duplicate_count: 0,
                    suppression_reasons: HashMap::new(),
                    serve_cache_hit: false,
                    stable_order_drifted: false,
                    cache_key_mode: "normalized_query_v2".to_string(),
                    cache_policy: "bounded_short_ttl_v1".to_string(),
                    cache_policy_reason: "first_page_stable".to_string(),
                    page_remaining_count: 0,
                    page_underfilled: false,
                    page_underfill_reason: None,
                },
                retrieval: RecommendationRetrievalSummaryPayload {
                    stage: "source_parallel_lane_merge_v6".to_string(),
                    total_candidates: 1,
                    in_network_candidates: 0,
                    out_of_network_candidates: 1,
                    ml_retrieved_candidates: 0,
                    recent_hot_candidates: 0,
                    source_counts: HashMap::new(),
                    lane_counts: HashMap::new(),
                    ml_source_counts: HashMap::new(),
                    stage_timings: HashMap::new(),
                    degraded_reasons: Vec::new(),
                    graph: RecommendationGraphRetrievalPayload {
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
                    },
                },
                ranking: RecommendationRankingSummaryPayload {
                    stage: "xalgo_stageful_ranking_v2".to_string(),
                    input_candidates: 1,
                    hydrated_candidates: 1,
                    filtered_candidates: 1,
                    scored_candidates: 1,
                    ml_eligible_candidates: 0,
                    ml_ranked_candidates: 0,
                    weighted_candidates: 1,
                    stage_timings: HashMap::new(),
                    filter_drop_counts: HashMap::new(),
                    degraded_reasons: Vec::new(),
                },
                stages: Vec::new(),
                trace: None,
            },
        }
    }

    #[test]
    fn fingerprint_normalizes_array_order_and_case() {
        let first = query();
        let mut second = query();
        second.request_id = "req-2".to_string();
        second.seen_ids = vec!["a".to_string(), "b".to_string()];
        second.served_ids = vec!["post-1".to_string(), "post-2".to_string()];
        second.country_code = Some("CN".to_string());
        second.language_code = Some("zh".to_string());
        second.cursor = Some(
            DateTime::parse_from_rfc3339("2026-04-20T08:00:00+08:00")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(
            build_query_fingerprint(&first),
            build_query_fingerprint(&second)
        );
    }

    #[test]
    fn store_policy_prefers_cursor_replay_when_cursor_present() {
        let decision = evaluate_store_policy(&query(), &result(), true);
        assert!(decision.cacheable);
        assert_eq!(decision.reason, "cursor_replay_stable");
    }
}
