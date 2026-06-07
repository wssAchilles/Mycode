use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use anyhow::Result;
use serde::Serialize;
use tokio::task::JoinSet;

use crate::contracts::{
    RecommendationGraphRetrievalPayload, RecommendationOnlineEvaluationPayload,
    RecommendationRankingSummaryPayload, RecommendationResultPayload,
    RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
    RecommendationServingSummaryPayload, RecommendationSummaryPayload,
};
use crate::serving::cache::ServeCache;
use crate::serving::singleflight::CacheSingleflight;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricRow {
    name: &'static str,
    iterations: usize,
    request_count: usize,
    batch_size: Option<usize>,
    queue_depth: Option<usize>,
    p50_us: u128,
    p95_us: u128,
    p99_us: u128,
    timeouts: usize,
    fallback: bool,
    budget_exhausted: bool,
    cache_hit: Option<u64>,
    cache_miss: Option<u64>,
    singleflight_collapsed_count: Option<u64>,
    cache_local_capacity: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixturePayload {
    schema_version: &'static str,
    service: &'static str,
    suite: &'static str,
    summary: MetricRow,
    results: Vec<MetricRow>,
}

pub async fn run() -> Result<()> {
    let cache_iterations = read_usize_env("RECOMMENDATION_PERF_CACHE_ITERATIONS", 1_000);
    let singleflight_waiters = read_usize_env("RECOMMENDATION_PERF_SINGLEFLIGHT_WAITERS", 64);
    let cache = ServeCache::new(
        true,
        60,
        "perf:serve:v1".to_string(),
        "redis://disabled".to_string(),
        None,
        4_096,
    );

    let mut cache_samples = Vec::with_capacity(cache_iterations);
    for index in 0..cache_iterations {
        let key = format!("fingerprint-{index}");
        let result = recommendation_result(&format!("stable-{index}"));
        cache.store(&key, &result).await?;
        let started = Instant::now();
        let hit = cache.get(&key).await;
        cache_samples.push(started.elapsed().as_micros());
        debug_assert!(hit.result.is_some());
    }
    let cache_snapshot = cache.snapshot();
    let cache_row = MetricRow {
        name: "serve_cache_local_hit",
        iterations: cache_iterations,
        request_count: cache_iterations,
        batch_size: None,
        queue_depth: None,
        p50_us: percentile(&cache_samples, 50),
        p95_us: percentile(&cache_samples, 95),
        p99_us: percentile(&cache_samples, 99),
        timeouts: 0,
        fallback: false,
        budget_exhausted: false,
        cache_hit: Some(cache_snapshot.local_hit_count + cache_snapshot.shared_hit_count),
        cache_miss: Some(cache_snapshot.local_miss_count + cache_snapshot.shared_miss_count),
        singleflight_collapsed_count: None,
        cache_local_capacity: Some(cache_snapshot.local_capacity),
    };

    let singleflight = CacheSingleflight::new(true);
    let upstream_calls = Arc::new(AtomicUsize::new(0));
    let started = Instant::now();
    let mut tasks = JoinSet::new();
    for _ in 0..singleflight_waiters {
        let sf = singleflight.clone();
        let calls = Arc::clone(&upstream_calls);
        tasks.spawn(async move {
            sf.run("hot-key".to_string(), move || async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                Ok(recommendation_result("singleflight-stable"))
            })
            .await
        });
    }
    while let Some(result) = tasks.join_next().await {
        result??;
    }
    let elapsed = started.elapsed().as_micros();
    let sf_snapshot = singleflight.snapshot();
    let singleflight_row = MetricRow {
        name: "cache_singleflight_hot_key",
        iterations: 1,
        request_count: singleflight_waiters,
        batch_size: Some(singleflight_waiters),
        queue_depth: Some(singleflight_waiters),
        p50_us: elapsed,
        p95_us: elapsed,
        p99_us: elapsed,
        timeouts: 0,
        fallback: false,
        budget_exhausted: false,
        cache_hit: None,
        cache_miss: None,
        singleflight_collapsed_count: Some(sf_snapshot.collapsed_count),
        cache_local_capacity: None,
    };

    let payload = FixturePayload {
        schema_version: "telegram_perf_fixture_v1",
        service: "rust_recommendation",
        suite: "recommendation_cache_local_hot_path",
        summary: cache_row.clone(),
        results: vec![cache_row, singleflight_row],
    };
    println!("{}", serde_json::to_string_pretty(&payload)?);
    Ok(())
}

fn recommendation_result(stable_order_key: &str) -> RecommendationResultPayload {
    RecommendationResultPayload {
        request_id: "perf-request".to_string(),
        serving_version: "rust_serving_v1".to_string(),
        cursor: None,
        next_cursor: None,
        has_more: false,
        served_state_version: "state-v1".to_string(),
        stable_order_key: stable_order_key.to_string(),
        candidates: Vec::new(),
        summary: RecommendationSummaryPayload {
            request_id: "perf-request".to_string(),
            stage: "perf".to_string(),
            pipeline_version: "perf_fixture_v1".to_string(),
            owner: "rust".to_string(),
            fallback_mode: "off".to_string(),
            provider_calls: Default::default(),
            provider_latency_ms: Default::default(),
            retrieved_count: 0,
            selected_count: 0,
            source_counts: Default::default(),
            filter_drop_counts: Default::default(),
            stage_timings: Default::default(),
            stage_latency_ms: Default::default(),
            degraded_reasons: Vec::new(),
            recent_hot_applied: false,
            online_eval: RecommendationOnlineEvaluationPayload::default(),
            selector: RecommendationSelectorPayload {
                oversample_factor: 1,
                max_size: 1,
                final_limit: 1,
                truncated: false,
            },
            serving: RecommendationServingSummaryPayload {
                serving_version: "rust_serving_v1".to_string(),
                cursor_mode: "created_at_desc_v1".to_string(),
                cursor: None,
                next_cursor: None,
                has_more: false,
                served_state_version: "state-v1".to_string(),
                stable_order_key: stable_order_key.to_string(),
                duplicate_suppressed_count: 0,
                cross_page_duplicate_count: 0,
                suppression_reasons: Default::default(),
                serve_cache_hit: true,
                stable_order_drifted: false,
                cache_key_mode: "normalized_query_v2".to_string(),
                cache_policy: "bounded_short_ttl_v1".to_string(),
                cache_policy_reason: "perf_fixture".to_string(),
                page_remaining_count: 0,
                page_underfilled: false,
                page_underfill_reason: None,
            },
            retrieval: RecommendationRetrievalSummaryPayload {
                stage: "retrieval".to_string(),
                total_candidates: 0,
                in_network_candidates: 0,
                out_of_network_candidates: 0,
                ml_retrieved_candidates: 0,
                recent_hot_candidates: 0,
                source_counts: Default::default(),
                source_outcome_counts: Default::default(),
                source_failure_counts: Default::default(),
                source_disabled_counts: Default::default(),
                lane_counts: Default::default(),
                ml_source_counts: Default::default(),
                stage_timings: Default::default(),
                degraded_reasons: Vec::new(),
                graph: RecommendationGraphRetrievalPayload::default(),
            },
            ranking: RecommendationRankingSummaryPayload {
                stage: "ranking".to_string(),
                input_candidates: 0,
                hydrated_candidates: 0,
                filtered_candidates: 0,
                scored_candidates: 0,
                ml_eligible_candidates: 0,
                ml_ranked_candidates: 0,
                weighted_candidates: 0,
                stage_timings: Default::default(),
                filter_drop_counts: Default::default(),
                degraded_reasons: Vec::new(),
            },
            stages: Vec::new(),
            trace: None,
        },
    }
}

fn percentile(values: &[u128], pct: usize) -> u128 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) * pct.min(100)) / 100;
    sorted[index]
}

fn read_usize_env(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}
