use std::collections::HashMap;

use serde_json::Value;

use crate::contracts::{
    RecommendationGraphRetrievalPayload, RecommendationRankingSummaryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
    RecommendationStagePayload, RecommendationSummaryPayload,
};

use super::RecommendationMetrics;

fn summary(
    request_id: &str,
    stage_latency_ms: HashMap<String, u64>,
    degraded_reasons: Vec<String>,
) -> RecommendationSummaryPayload {
    RecommendationSummaryPayload {
        request_id: request_id.to_string(),
        stage: "retrieval_ranking_v2".to_string(),
        pipeline_version: "xalgo_candidate_pipeline_v6".to_string(),
        owner: "rust".to_string(),
        fallback_mode: "node_provider_surface_with_cpp_graph_primary".to_string(),
        provider_calls: HashMap::from([(
            "query_hydrators/UserFeaturesQueryHydrator".to_string(),
            1,
        )]),
        provider_latency_ms: HashMap::from([
            ("query_hydrators/batch".to_string(), 6),
            ("sources/batch".to_string(), 14),
        ]),
        retrieved_count: 10,
        selected_count: 6,
        source_counts: HashMap::from([("GraphSource".to_string(), 4)]),
        filter_drop_counts: HashMap::from([("MutedKeywordFilter".to_string(), 2)]),
        stage_timings: HashMap::from([("GraphSource".to_string(), 12)]),
        stage_latency_ms,
        degraded_reasons,
        recent_hot_applied: false,
        online_eval: crate::contracts::RecommendationOnlineEvaluationPayload::default(),
        selector: RecommendationSelectorPayload {
            oversample_factor: 5,
            max_size: 200,
            final_limit: 20,
            truncated: false,
        },
        serving: crate::contracts::RecommendationServingSummaryPayload {
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
            total_candidates: 10,
            in_network_candidates: 3,
            out_of_network_candidates: 7,
            ml_retrieved_candidates: 5,
            recent_hot_candidates: 0,
            source_counts: HashMap::from([("GraphSource".to_string(), 4)]),
            lane_counts: HashMap::from([("social_expansion".to_string(), 4)]),
            ml_source_counts: HashMap::new(),
            stage_timings: HashMap::from([("GraphSource".to_string(), 12)]),
            degraded_reasons: Vec::new(),
            graph: RecommendationGraphRetrievalPayload {
                total_candidates: 4,
                kernel_candidates: 4,
                legacy_candidates: 0,
                fallback_used: false,
                empty_result: false,
                kernel_source_counts: HashMap::from([("cpp_graph_social_neighbor".to_string(), 2)]),
                materializer_query_duration_ms: Some(9),
                materializer_provider_latency_ms: Some(13),
                materializer_cache_hit: Some(false),
                materializer_requested_author_count: Some(4),
                materializer_unique_author_count: Some(4),
                materializer_returned_post_count: Some(6),
                materializer_cache_key_mode: Some("author_ids_limit_lookback_v1".to_string()),
                materializer_cache_ttl_ms: Some(15_000),
                materializer_cache_entry_count: Some(3),
                materializer_cache_eviction_count: Some(1),
                per_kernel_candidate_counts: HashMap::from([
                    ("social_neighbors".to_string(), 4),
                    ("recent_engagers".to_string(), 1),
                ]),
                per_kernel_requested_limits: HashMap::from([
                    ("social_neighbors".to_string(), 48),
                    ("recent_engagers".to_string(), 48),
                ]),
                per_kernel_available_counts: HashMap::from([
                    ("social_neighbors".to_string(), 6),
                    ("recent_engagers".to_string(), 1),
                ]),
                per_kernel_returned_counts: HashMap::from([
                    ("social_neighbors".to_string(), 4),
                    ("recent_engagers".to_string(), 1),
                ]),
                per_kernel_truncated_counts: HashMap::from([("social_neighbors".to_string(), 2)]),
                per_kernel_latency_ms: HashMap::from([
                    ("social_neighbors".to_string(), 18),
                    ("recent_engagers".to_string(), 11),
                ]),
                per_kernel_empty_reasons: HashMap::new(),
                per_kernel_errors: HashMap::new(),
                budget_exhausted_kernels: vec!["social_neighbors".to_string()],
                dominant_kernel_source: Some("cpp_graph_social_neighbor".to_string()),
                dominance_share: Some(0.8),
                empty_reason: None,
            },
        },
        ranking: RecommendationRankingSummaryPayload {
            stage: "xalgo_stageful_ranking_v2".to_string(),
            input_candidates: 10,
            hydrated_candidates: 10,
            filtered_candidates: 8,
            scored_candidates: 8,
            ml_eligible_candidates: 5,
            ml_ranked_candidates: 5,
            weighted_candidates: 8,
            stage_timings: HashMap::from([("PhoenixScorer".to_string(), 8)]),
            filter_drop_counts: HashMap::from([("MutedKeywordFilter".to_string(), 2)]),
            degraded_reasons: Vec::new(),
        },
        stages: Vec::new(),
        trace: None,
    }
}

#[test]
fn aggregates_stage_latency_percentiles_and_degrade_counts() {
    let mut metrics = RecommendationMetrics::default();
    let mut first = summary(
        "req-1",
        HashMap::from([
            ("queryHydrators".to_string(), 10),
            ("sources".to_string(), 25),
        ]),
        vec!["query:UserFeaturesQueryHydrator:timeout".to_string()],
    );
    first.stages.push(RecommendationStagePayload {
        name: "PopularSource".to_string(),
        enabled: true,
        duration_ms: 1_200,
        input_count: 1,
        output_count: 0,
        removed_count: None,
        detail: Some(HashMap::from([
            ("timedOut".to_string(), Value::Bool(true)),
            ("timeoutMs".to_string(), Value::from(1_200)),
            (
                "errorClass".to_string(),
                Value::String("source_timeout".to_string()),
            ),
        ])),
    });
    metrics.record_success(&first);
    let mut second = summary(
        "req-2",
        HashMap::from([
            ("queryHydrators".to_string(), 30),
            ("sources".to_string(), 50),
        ]),
        vec!["empty_selection".to_string()],
    );
    second.stages.push(RecommendationStagePayload {
        name: "PopularSource".to_string(),
        enabled: true,
        duration_ms: 1_200,
        input_count: 1,
        output_count: 0,
        removed_count: None,
        detail: Some(HashMap::from([
            ("timedOut".to_string(), Value::Bool(true)),
            ("timeoutMs".to_string(), Value::from(1_200)),
            (
                "errorClass".to_string(),
                Value::String("source_timeout".to_string()),
            ),
        ])),
    });
    metrics.record_success(&second);

    let snapshot = metrics.build_summary(
        "retrieval_ranking_v2",
        crate::contracts::RecentStoreSnapshot {
            global_size: 4,
            tracked_users: 2,
        },
    );

    assert_eq!(snapshot.partial_degrade_count, 2);
    assert_eq!(snapshot.timeout_count, 1);
    assert_eq!(snapshot.source_batch_timeout_count, 2);
    assert_eq!(
        snapshot.last_source_batch_timed_out_sources,
        vec!["PopularSource".to_string()]
    );
    assert_eq!(snapshot.source_batch_component_timeout_ms, 1_200);
    assert_eq!(
        snapshot
            .last_graph_per_kernel_candidate_counts
            .get("social_neighbors"),
        Some(&4)
    );
    assert_eq!(
        snapshot
            .last_graph_per_kernel_latency_ms
            .get("recent_engagers"),
        Some(&11)
    );
    assert_eq!(
        snapshot
            .last_graph_per_kernel_requested_limits
            .get("social_neighbors"),
        Some(&48)
    );
    assert_eq!(
        snapshot
            .last_graph_per_kernel_truncated_counts
            .get("social_neighbors"),
        Some(&2)
    );
    assert_eq!(
        snapshot.last_graph_budget_exhausted_kernels,
        vec!["social_neighbors".to_string()]
    );
    assert_eq!(snapshot.last_graph_dominance_share, Some(0.8));
    assert_eq!(snapshot.last_graph_materializer_query_duration_ms, Some(9));
    assert_eq!(
        snapshot.last_graph_materializer_provider_latency_ms,
        Some(13)
    );
    assert_eq!(
        snapshot.last_graph_materializer_requested_author_count,
        Some(4)
    );
    assert_eq!(
        snapshot.last_graph_materializer_unique_author_count,
        Some(4)
    );
    assert_eq!(
        snapshot.last_graph_materializer_returned_post_count,
        Some(6)
    );
    assert_eq!(
        snapshot.last_graph_materializer_cache_key_mode.as_deref(),
        Some("author_ids_limit_lookback_v1")
    );
    assert_eq!(snapshot.last_graph_materializer_cache_ttl_ms, Some(15_000));
    assert_eq!(snapshot.last_graph_materializer_cache_entry_count, Some(3));
    assert_eq!(
        snapshot.last_graph_materializer_cache_eviction_count,
        Some(1)
    );
    assert_eq!(
        snapshot.last_slow_provider.as_deref(),
        Some("sources/batch")
    );
    assert_eq!(snapshot.last_slow_provider_ms, Some(14));
    assert_eq!(snapshot.provider_latency_budget_ms, 1_000);
    assert_eq!(snapshot.provider_latency_budget_exceeded_count, 0);
    assert_eq!(
        snapshot.last_provider_latency_ms.get("sources/batch"),
        Some(&14)
    );
    assert_eq!(
        snapshot.stage_latency.get("queryHydrators").map(|value| (
            value.last_ms,
            value.p50_ms,
            value.p95_ms
        )),
        Some((30, 10, 10))
    );
    assert_eq!(
        snapshot.stage_latency.get("sources").map(|value| (
            value.last_ms,
            value.p50_ms,
            value.p95_ms
        )),
        Some((50, 25, 25))
    );
}

#[test]
fn tracks_self_post_rescue_as_quality_debt() {
    let mut metrics = RecommendationMetrics::default();
    let mut payload = summary(
        "req-rescue",
        HashMap::from([("selfPostRescue".to_string(), 15)]),
        vec!["selection:self_post_rescue_applied".to_string()],
    );
    payload.stages.push(RecommendationStagePayload {
        name: "SelfPostRescueSource".to_string(),
        enabled: true,
        duration_ms: 15,
        input_count: 1,
        output_count: 7,
        removed_count: None,
        detail: None,
    });

    metrics.record_success(&payload);
    let snapshot = metrics.build_summary(
        "retrieval_ranking_v2",
        crate::contracts::RecentStoreSnapshot {
            global_size: 0,
            tracked_users: 0,
        },
    );

    assert_eq!(snapshot.last_rescue_selected_count, Some(7));
    assert_eq!(snapshot.self_post_rescue_attempt_count, 1);
    assert_eq!(snapshot.self_post_rescue_hit_count, 1);
    assert_eq!(snapshot.self_post_rescue_hit_rate, Some(1.0));
}

#[test]
fn aggregates_serving_policy_and_side_effect_metrics() {
    let mut metrics = RecommendationMetrics::default();
    let mut payload = summary("req-cache", HashMap::new(), Vec::new());
    payload.serving.serve_cache_hit = true;
    payload.serving.page_underfilled = true;
    payload.serving.page_underfill_reason = Some("supply_exhausted".to_string());
    payload.serving.page_remaining_count = 0;
    payload.serving.cache_policy_reason = "cursor_replay_stable".to_string();
    payload.serving.suppression_reasons = HashMap::from([("cross_page_duplicate".to_string(), 2)]);

    metrics.record_success(&payload);
    metrics.record_side_effect_dispatch(&["RecentStoreSideEffect".to_string()]);
    metrics.record_side_effect_completion(&["RecentStoreSideEffect".to_string()], true);

    let snapshot = metrics.build_summary(
        "retrieval_ranking_v2",
        crate::contracts::RecentStoreSnapshot {
            global_size: 1,
            tracked_users: 1,
        },
    );

    assert_eq!(snapshot.serve_cache_hit_rate, Some(1.0));
    assert_eq!(
        snapshot.last_cache_policy_reason.as_deref(),
        Some("cursor_replay_stable")
    );
    assert_eq!(
        snapshot.last_page_underfill_reason.as_deref(),
        Some("supply_exhausted")
    );
    assert_eq!(snapshot.page_underfill_count, 1);
    assert_eq!(snapshot.page_underfill_rate, Some(1.0));
    assert_eq!(
        snapshot
            .suppression_reason_counts
            .get("cross_page_duplicate"),
        Some(&2)
    );
    assert_eq!(snapshot.side_effect_dispatch_count, 1);
    assert_eq!(snapshot.side_effect_complete_count, 1);
    assert_eq!(snapshot.stable_order_drift_count, 1);
}

#[test]
fn exposes_source_health_and_guardrails() {
    let mut metrics = RecommendationMetrics::default();
    let mut payload = summary(
        "req-guardrail",
        HashMap::from([("sources".to_string(), 44)]),
        vec![
            "underfilled_selection".to_string(),
            "ranking:PhoenixScorer:empty_ml_ranking".to_string(),
        ],
    );
    payload.serving.page_underfilled = true;
    payload.provider_latency_ms = HashMap::from([("sources/batch".to_string(), 1_240)]);
    payload.stages.push(RecommendationStagePayload {
        name: "FollowingSource".to_string(),
        enabled: true,
        duration_ms: 12,
        input_count: 1,
        output_count: 18,
        removed_count: None,
        detail: Some(HashMap::from([
            ("sourceBudget".to_string(), Value::from(80)),
            ("prePolicyCount".to_string(), Value::from(24)),
        ])),
    });
    payload.stages.push(RecommendationStagePayload {
        name: "TwoTowerSource".to_string(),
        enabled: true,
        duration_ms: 31,
        input_count: 1,
        output_count: 0,
        removed_count: None,
        detail: Some(HashMap::from([
            ("timedOut".to_string(), Value::Bool(true)),
            (
                "errorClass".to_string(),
                Value::String("source_timeout".to_string()),
            ),
        ])),
    });

    metrics.record_success(&payload);
    let snapshot = metrics.build_summary(
        "retrieval_ranking_v2",
        crate::contracts::RecentStoreSnapshot {
            global_size: 0,
            tracked_users: 0,
        },
    );

    assert_eq!(snapshot.guardrails.status, "tripped");
    assert!(snapshot.guardrails.underfilled_selection);
    assert!(snapshot.guardrails.ml_ranking_empty);
    assert!(snapshot.guardrails.provider_budget_exceeded);
    assert_eq!(snapshot.guardrails.source_timeout_count, 1);
    assert_eq!(snapshot.phoenix_empty_ranking_count, 1);
    assert_eq!(snapshot.underfilled_selection_count, 1);
    assert_eq!(snapshot.last_source_health.len(), 2);
    assert_eq!(snapshot.last_source_health[0].source, "FollowingSource");
    assert_eq!(snapshot.last_source_health[0].source_budget, Some(80));
    assert_eq!(snapshot.last_source_health[1].source, "TwoTowerSource");
    assert!(snapshot.last_source_health[1].timed_out);
}
