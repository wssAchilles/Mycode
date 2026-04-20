use chrono::{DateTime, Utc};
use std::collections::{HashMap, VecDeque};

use crate::contracts::ops::StageLatencySnapshot;
use crate::contracts::{
    RecentStoreSnapshot, RecommendationOpsSummary, RecommendationSummaryPayload,
};

#[derive(Debug, Default)]
pub struct RecommendationMetrics {
    total_requests: u64,
    total_failures: u64,
    last_request_id: Option<String>,
    last_selected_count: Option<usize>,
    last_retrieved_count: Option<usize>,
    last_has_more: Option<bool>,
    last_next_cursor: Option<String>,
    last_serving_version: Option<String>,
    last_cursor_mode: Option<String>,
    last_served_state_version: Option<String>,
    last_stable_order_key: Option<String>,
    last_duplicate_suppressed_count: Option<usize>,
    last_cross_page_duplicate_count: Option<usize>,
    last_serve_cache_hit: Option<bool>,
    last_cache_policy_reason: Option<String>,
    last_page_remaining_count: Option<usize>,
    last_page_underfilled: Option<bool>,
    last_page_underfill_reason: Option<String>,
    last_suppression_reasons: HashMap<String, usize>,
    serve_cache_hit_count: u64,
    serve_cache_miss_count: u64,
    stable_order_drift_count: u64,
    page_underfill_count: u64,
    suppression_reason_counts: HashMap<String, u64>,
    underfill_reason_counts: HashMap<String, u64>,
    last_rescue_selected_count: Option<usize>,
    self_post_rescue_attempt_count: u64,
    self_post_rescue_hit_count: u64,
    last_ml_retrieved_count: Option<usize>,
    last_ml_ranked_count: Option<usize>,
    last_graph_retrieved_count: Option<usize>,
    last_graph_kernel_candidates: Option<usize>,
    last_graph_legacy_candidates: Option<usize>,
    last_graph_fallback_used: Option<bool>,
    last_graph_kernel_source_counts: HashMap<String, usize>,
    last_graph_per_kernel_candidate_counts: HashMap<String, usize>,
    last_graph_per_kernel_requested_limits: HashMap<String, usize>,
    last_graph_per_kernel_available_counts: HashMap<String, usize>,
    last_graph_per_kernel_returned_counts: HashMap<String, usize>,
    last_graph_per_kernel_truncated_counts: HashMap<String, usize>,
    last_graph_per_kernel_latency_ms: HashMap<String, u64>,
    last_graph_per_kernel_empty_reasons: HashMap<String, String>,
    last_graph_per_kernel_errors: HashMap<String, String>,
    last_graph_budget_exhausted_kernels: Vec<String>,
    last_graph_dominant_source: Option<String>,
    last_graph_dominance_share: Option<f64>,
    last_graph_empty_reason: Option<String>,
    last_provider_calls: HashMap<String, usize>,
    stage_latency_samples: HashMap<String, VecDeque<u64>>,
    last_stage_latency: HashMap<String, u64>,
    partial_degrade_count: u64,
    timeout_count: u64,
    side_effect_dispatch_count: u64,
    side_effect_complete_count: u64,
    side_effect_failure_count: u64,
    last_side_effect_error: Option<String>,
    last_side_effect_names: Vec<String>,
    last_side_effect_completed_at: Option<DateTime<Utc>>,
    last_degraded_reasons: Vec<String>,
    last_error: Option<String>,
    last_completed_at: Option<DateTime<Utc>>,
}

impl RecommendationMetrics {
    pub fn record_success(&mut self, summary: &RecommendationSummaryPayload) {
        self.total_requests = self.total_requests.saturating_add(1);
        self.last_request_id = Some(summary.request_id.clone());
        self.last_selected_count = Some(summary.selected_count);
        self.last_retrieved_count = Some(summary.retrieved_count);
        self.last_has_more = Some(summary.serving.has_more);
        self.last_next_cursor = summary
            .serving
            .next_cursor
            .map(|cursor| cursor.to_rfc3339());
        self.last_serving_version = Some(summary.serving.serving_version.clone());
        self.last_cursor_mode = Some(summary.serving.cursor_mode.clone());
        self.last_served_state_version = Some(summary.serving.served_state_version.clone());
        self.last_stable_order_key = Some(summary.serving.stable_order_key.clone());
        self.last_duplicate_suppressed_count = Some(summary.serving.duplicate_suppressed_count);
        self.last_cross_page_duplicate_count = Some(summary.serving.cross_page_duplicate_count);
        self.last_serve_cache_hit = Some(summary.serving.serve_cache_hit);
        self.last_cache_policy_reason = Some(summary.serving.cache_policy_reason.clone());
        self.last_page_remaining_count = Some(summary.serving.page_remaining_count);
        self.last_page_underfilled = Some(summary.serving.page_underfilled);
        self.last_page_underfill_reason = summary.serving.page_underfill_reason.clone();
        self.last_suppression_reasons = summary.serving.suppression_reasons.clone();
        if summary.serving.serve_cache_hit {
            self.serve_cache_hit_count = self.serve_cache_hit_count.saturating_add(1);
        } else {
            self.serve_cache_miss_count = self.serve_cache_miss_count.saturating_add(1);
        }
        if summary.serving.stable_order_drifted {
            self.stable_order_drift_count = self.stable_order_drift_count.saturating_add(1);
        }
        if summary.serving.page_underfilled {
            self.page_underfill_count = self.page_underfill_count.saturating_add(1);
            if let Some(reason) = summary.serving.page_underfill_reason.as_ref() {
                *self
                    .underfill_reason_counts
                    .entry(reason.clone())
                    .or_insert(0) += 1;
            }
        }
        for (reason, count) in &summary.serving.suppression_reasons {
            *self
                .suppression_reason_counts
                .entry(reason.clone())
                .or_insert(0) += *count as u64;
        }
        let rescue_selected_count = summary
            .stages
            .iter()
            .find(|stage| stage.name == "SelfPostRescueSource")
            .map(|stage| stage.output_count);
        self.last_rescue_selected_count = rescue_selected_count;
        if let Some(count) = rescue_selected_count {
            self.self_post_rescue_attempt_count =
                self.self_post_rescue_attempt_count.saturating_add(1);
            if count > 0 {
                self.self_post_rescue_hit_count = self.self_post_rescue_hit_count.saturating_add(1);
            }
        }
        self.last_ml_retrieved_count = Some(summary.retrieval.ml_retrieved_candidates);
        self.last_ml_ranked_count = Some(summary.ranking.ml_ranked_candidates);
        self.last_graph_retrieved_count = Some(summary.retrieval.graph.total_candidates);
        self.last_graph_kernel_candidates = Some(summary.retrieval.graph.kernel_candidates);
        self.last_graph_legacy_candidates = Some(summary.retrieval.graph.legacy_candidates);
        self.last_graph_fallback_used = Some(summary.retrieval.graph.fallback_used);
        self.last_graph_kernel_source_counts = summary.retrieval.graph.kernel_source_counts.clone();
        self.last_graph_per_kernel_candidate_counts =
            summary.retrieval.graph.per_kernel_candidate_counts.clone();
        self.last_graph_per_kernel_requested_limits =
            summary.retrieval.graph.per_kernel_requested_limits.clone();
        self.last_graph_per_kernel_available_counts =
            summary.retrieval.graph.per_kernel_available_counts.clone();
        self.last_graph_per_kernel_returned_counts =
            summary.retrieval.graph.per_kernel_returned_counts.clone();
        self.last_graph_per_kernel_truncated_counts =
            summary.retrieval.graph.per_kernel_truncated_counts.clone();
        self.last_graph_per_kernel_latency_ms =
            summary.retrieval.graph.per_kernel_latency_ms.clone();
        self.last_graph_per_kernel_empty_reasons =
            summary.retrieval.graph.per_kernel_empty_reasons.clone();
        self.last_graph_per_kernel_errors = summary.retrieval.graph.per_kernel_errors.clone();
        self.last_graph_budget_exhausted_kernels =
            summary.retrieval.graph.budget_exhausted_kernels.clone();
        self.last_graph_dominant_source = summary.retrieval.graph.dominant_kernel_source.clone();
        self.last_graph_dominance_share = summary.retrieval.graph.dominance_share;
        self.last_graph_empty_reason = summary.retrieval.graph.empty_reason.clone();
        self.last_provider_calls = summary.provider_calls.clone();
        self.last_stage_latency = summary.stage_latency_ms.clone();
        for (key, value) in &summary.stage_latency_ms {
            let samples = self.stage_latency_samples.entry(key.clone()).or_default();
            samples.push_back(*value);
            while samples.len() > 128 {
                samples.pop_front();
            }
        }
        if !summary.degraded_reasons.is_empty() {
            self.partial_degrade_count = self.partial_degrade_count.saturating_add(1);
        }
        let timeout_hits = summary
            .degraded_reasons
            .iter()
            .filter(|reason| reason.contains("timeout"))
            .count() as u64;
        self.timeout_count = self.timeout_count.saturating_add(timeout_hits);
        self.last_degraded_reasons = summary.degraded_reasons.clone();
        self.last_error = None;
        self.last_completed_at = Some(Utc::now());
    }

    pub fn record_failure(&mut self, request_id: Option<&str>, error: &str) {
        self.total_requests = self.total_requests.saturating_add(1);
        self.total_failures = self.total_failures.saturating_add(1);
        self.last_request_id = request_id.map(ToOwned::to_owned);
        self.last_error = Some(error.to_string());
        self.last_completed_at = Some(Utc::now());
    }

    pub fn record_side_effect_dispatch(&mut self, names: &[String]) {
        self.side_effect_dispatch_count = self.side_effect_dispatch_count.saturating_add(1);
        self.last_side_effect_names = names.to_vec();
    }

    pub fn record_side_effect_completion(&mut self, names: &[String], cache_store_drifted: bool) {
        self.side_effect_complete_count = self.side_effect_complete_count.saturating_add(1);
        self.last_side_effect_names = names.to_vec();
        self.last_side_effect_error = None;
        self.last_side_effect_completed_at = Some(Utc::now());
        if cache_store_drifted {
            self.stable_order_drift_count = self.stable_order_drift_count.saturating_add(1);
        }
    }

    pub fn record_side_effect_failure(&mut self, names: &[String], error: &str) {
        self.side_effect_failure_count = self.side_effect_failure_count.saturating_add(1);
        self.last_side_effect_names = names.to_vec();
        self.last_side_effect_error = Some(error.to_string());
        self.last_side_effect_completed_at = Some(Utc::now());
    }

    pub fn build_summary(
        &self,
        current_stage: &str,
        recent_store: RecentStoreSnapshot,
    ) -> RecommendationOpsSummary {
        let mut degraded_reasons = self.last_degraded_reasons.clone();
        if let Some(error) = self.last_error.as_ref() {
            degraded_reasons.push(format!("last_error:{error}"));
        }

        let status = if self.last_error.is_some() {
            "degraded"
        } else if degraded_reasons.is_empty() {
            "running"
        } else {
            "degraded"
        };

        RecommendationOpsSummary {
            status: status.to_string(),
            current_stage: current_stage.to_string(),
            total_requests: self.total_requests,
            total_failures: self.total_failures,
            last_request_id: self.last_request_id.clone(),
            last_selected_count: self.last_selected_count,
            last_retrieved_count: self.last_retrieved_count,
            last_has_more: self.last_has_more,
            last_next_cursor: self.last_next_cursor.clone(),
            last_serving_version: self.last_serving_version.clone(),
            last_cursor_mode: self.last_cursor_mode.clone(),
            last_served_state_version: self.last_served_state_version.clone(),
            last_stable_order_key: self.last_stable_order_key.clone(),
            last_duplicate_suppressed_count: self.last_duplicate_suppressed_count,
            last_cross_page_duplicate_count: self.last_cross_page_duplicate_count,
            last_serve_cache_hit: self.last_serve_cache_hit,
            serve_cache_hit_rate: ratio(
                self.serve_cache_hit_count,
                self.serve_cache_hit_count
                    .saturating_add(self.serve_cache_miss_count),
            ),
            last_cache_policy_reason: self.last_cache_policy_reason.clone(),
            last_page_remaining_count: self.last_page_remaining_count,
            last_page_underfilled: self.last_page_underfilled,
            last_page_underfill_reason: self.last_page_underfill_reason.clone(),
            last_suppression_reasons: self.last_suppression_reasons.clone(),
            serve_cache_hit_count: self.serve_cache_hit_count,
            serve_cache_miss_count: self.serve_cache_miss_count,
            stable_order_drift_count: self.stable_order_drift_count,
            page_underfill_count: self.page_underfill_count,
            page_underfill_rate: ratio(
                self.page_underfill_count,
                self.total_requests.saturating_sub(self.total_failures),
            ),
            suppression_reason_counts: self.suppression_reason_counts.clone(),
            underfill_reason_counts: self.underfill_reason_counts.clone(),
            last_rescue_selected_count: self.last_rescue_selected_count,
            self_post_rescue_attempt_count: self.self_post_rescue_attempt_count,
            self_post_rescue_hit_count: self.self_post_rescue_hit_count,
            self_post_rescue_hit_rate: rescue_hit_rate(
                self.self_post_rescue_attempt_count,
                self.self_post_rescue_hit_count,
            ),
            last_ml_retrieved_count: self.last_ml_retrieved_count,
            last_ml_ranked_count: self.last_ml_ranked_count,
            last_graph_retrieved_count: self.last_graph_retrieved_count,
            last_graph_kernel_candidates: self.last_graph_kernel_candidates,
            last_graph_legacy_candidates: self.last_graph_legacy_candidates,
            last_graph_fallback_used: self.last_graph_fallback_used,
            last_graph_kernel_source_counts: self.last_graph_kernel_source_counts.clone(),
            last_graph_per_kernel_candidate_counts: self
                .last_graph_per_kernel_candidate_counts
                .clone(),
            last_graph_per_kernel_requested_limits: self
                .last_graph_per_kernel_requested_limits
                .clone(),
            last_graph_per_kernel_available_counts: self
                .last_graph_per_kernel_available_counts
                .clone(),
            last_graph_per_kernel_returned_counts: self
                .last_graph_per_kernel_returned_counts
                .clone(),
            last_graph_per_kernel_truncated_counts: self
                .last_graph_per_kernel_truncated_counts
                .clone(),
            last_graph_per_kernel_latency_ms: self.last_graph_per_kernel_latency_ms.clone(),
            last_graph_per_kernel_empty_reasons: self.last_graph_per_kernel_empty_reasons.clone(),
            last_graph_per_kernel_errors: self.last_graph_per_kernel_errors.clone(),
            last_graph_budget_exhausted_kernels: self.last_graph_budget_exhausted_kernels.clone(),
            last_graph_dominant_source: self.last_graph_dominant_source.clone(),
            last_graph_dominance_share: self.last_graph_dominance_share,
            last_graph_empty_reason: self.last_graph_empty_reason.clone(),
            last_provider_calls: self.last_provider_calls.clone(),
            stage_latency: self.build_stage_latency_summary(),
            partial_degrade_count: self.partial_degrade_count,
            timeout_count: self.timeout_count,
            side_effect_dispatch_count: self.side_effect_dispatch_count,
            side_effect_complete_count: self.side_effect_complete_count,
            side_effect_failure_count: self.side_effect_failure_count,
            last_side_effect_error: self.last_side_effect_error.clone(),
            last_side_effect_names: self.last_side_effect_names.clone(),
            last_side_effect_completed_at: self
                .last_side_effect_completed_at
                .map(|value| value.to_rfc3339()),
            degraded_reasons,
            recent_store,
        }
    }

    fn build_stage_latency_summary(&self) -> HashMap<String, StageLatencySnapshot> {
        self.stage_latency_samples
            .iter()
            .map(|(key, samples)| {
                let values = samples.iter().copied().collect::<Vec<u64>>();
                let last_ms = *self.last_stage_latency.get(key).unwrap_or(&0);
                (
                    key.clone(),
                    StageLatencySnapshot {
                        last_ms,
                        p50_ms: percentile(&values, 50),
                        p95_ms: percentile(&values, 95),
                    },
                )
            })
            .collect()
    }
}

fn percentile(values: &[u64], percentile: usize) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let percentile = percentile.clamp(0, 100);
    let index = ((sorted.len() - 1) * percentile) / 100;
    sorted[index]
}

fn rescue_hit_rate(attempts: u64, hits: u64) -> Option<f64> {
    (attempts > 0).then_some(hits as f64 / attempts as f64)
}

fn ratio(numerator: u64, denominator: u64) -> Option<f64> {
    (denominator > 0).then_some(numerator as f64 / denominator as f64)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

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
            retrieved_count: 10,
            selected_count: 6,
            source_counts: HashMap::from([("GraphSource".to_string(), 4)]),
            filter_drop_counts: HashMap::from([("MutedKeywordFilter".to_string(), 2)]),
            stage_timings: HashMap::from([("GraphSource".to_string(), 12)]),
            stage_latency_ms,
            degraded_reasons,
            recent_hot_applied: false,
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
                stage: "source_parallel_graph_v5".to_string(),
                total_candidates: 10,
                in_network_candidates: 3,
                out_of_network_candidates: 7,
                ml_retrieved_candidates: 5,
                recent_hot_candidates: 0,
                source_counts: HashMap::from([("GraphSource".to_string(), 4)]),
                ml_source_counts: HashMap::new(),
                stage_timings: HashMap::from([("GraphSource".to_string(), 12)]),
                degraded_reasons: Vec::new(),
                graph: RecommendationGraphRetrievalPayload {
                    total_candidates: 4,
                    kernel_candidates: 4,
                    legacy_candidates: 0,
                    fallback_used: false,
                    empty_result: false,
                    kernel_source_counts: HashMap::from([(
                        "cpp_graph_social_neighbor".to_string(),
                        2,
                    )]),
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
                    per_kernel_truncated_counts: HashMap::from([(
                        "social_neighbors".to_string(),
                        2,
                    )]),
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
        }
    }

    #[test]
    fn aggregates_stage_latency_percentiles_and_degrade_counts() {
        let mut metrics = RecommendationMetrics::default();
        metrics.record_success(&summary(
            "req-1",
            HashMap::from([
                ("queryHydrators".to_string(), 10),
                ("sources".to_string(), 25),
            ]),
            vec!["query:UserFeaturesQueryHydrator:timeout".to_string()],
        ));
        metrics.record_success(&summary(
            "req-2",
            HashMap::from([
                ("queryHydrators".to_string(), 30),
                ("sources".to_string(), 50),
            ]),
            vec!["empty_selection".to_string()],
        ));

        let snapshot = metrics.build_summary(
            "retrieval_ranking_v2",
            crate::contracts::RecentStoreSnapshot {
                global_size: 4,
                tracked_users: 2,
            },
        );

        assert_eq!(snapshot.partial_degrade_count, 2);
        assert_eq!(snapshot.timeout_count, 1);
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
        payload.serving.suppression_reasons =
            HashMap::from([("cross_page_duplicate".to_string(), 2)]);

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
}
