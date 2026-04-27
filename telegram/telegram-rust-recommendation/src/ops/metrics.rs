use chrono::{DateTime, Utc};
use std::collections::{HashMap, VecDeque};

use crate::candidate_pipeline::definition::{
    PROVIDER_LATENCY_BUDGET_MS, SOURCE_BATCH_COMPONENT_TIMEOUT_MS,
};
use crate::contracts::ops::{RecommendationComponentHealthWindowEntry, StageLatencySnapshot};
use crate::contracts::{
    RecentStoreSnapshot, RecommendationGuardrailStatus, RecommendationOpsSummary,
    RecommendationSourceHealthEntry, RecommendationStagePayload, RecommendationSummaryPayload,
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
    last_graph_materializer_query_duration_ms: Option<u64>,
    last_graph_materializer_provider_latency_ms: Option<u64>,
    last_graph_materializer_cache_hit: Option<bool>,
    last_graph_materializer_cache_key_mode: Option<String>,
    last_graph_materializer_cache_ttl_ms: Option<u64>,
    last_graph_materializer_cache_entry_count: Option<usize>,
    last_graph_materializer_cache_eviction_count: Option<u64>,
    graph_materializer_cache_hit_count: u64,
    graph_materializer_cache_miss_count: u64,
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
    last_provider_latency_ms: HashMap<String, u64>,
    last_slow_provider: Option<String>,
    last_slow_provider_ms: Option<u64>,
    provider_latency_budget_exceeded_count: u64,
    source_batch_timeout_count: u64,
    last_source_batch_timed_out_sources: Vec<String>,
    last_source_health: Vec<RecommendationSourceHealthEntry>,
    component_health_events: HashMap<String, VecDeque<ComponentHealthEvent>>,
    empty_retrieval_count: u64,
    empty_selection_count: u64,
    underfilled_selection_count: u64,
    phoenix_empty_ranking_count: u64,
    last_online_eval: crate::contracts::RecommendationOnlineEvaluationPayload,
    online_eval_total_selected: u64,
    online_eval_trend_selected: u64,
    online_eval_news_selected: u64,
    online_eval_exploration_selected: u64,
    online_eval_source_counts: HashMap<String, u64>,
    online_eval_lane_counts: HashMap<String, u64>,
    online_eval_pool_counts: HashMap<String, u64>,
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

const COMPONENT_HEALTH_WINDOW_SECONDS: i64 = 300;
const CIRCUIT_MIN_EVENTS: usize = 2;
const CIRCUIT_FAILURE_RATE: f64 = 0.6;

#[derive(Debug, Clone)]
struct ComponentHealthEvent {
    recorded_at: DateTime<Utc>,
    component: String,
    stage: String,
    enabled: bool,
    output_count: usize,
    duration_ms: u64,
    timed_out: bool,
    error: bool,
    degraded: bool,
    error_class: Option<String>,
    disabled_reason: Option<String>,
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
        self.last_graph_materializer_query_duration_ms =
            summary.retrieval.graph.materializer_query_duration_ms;
        self.last_graph_materializer_provider_latency_ms =
            summary.retrieval.graph.materializer_provider_latency_ms;
        self.last_graph_materializer_cache_hit = summary.retrieval.graph.materializer_cache_hit;
        self.last_graph_materializer_cache_key_mode =
            summary.retrieval.graph.materializer_cache_key_mode.clone();
        self.last_graph_materializer_cache_ttl_ms =
            summary.retrieval.graph.materializer_cache_ttl_ms;
        self.last_graph_materializer_cache_entry_count =
            summary.retrieval.graph.materializer_cache_entry_count;
        self.last_graph_materializer_cache_eviction_count =
            summary.retrieval.graph.materializer_cache_eviction_count;
        if let Some(cache_hit) = summary.retrieval.graph.materializer_cache_hit {
            if cache_hit {
                self.graph_materializer_cache_hit_count =
                    self.graph_materializer_cache_hit_count.saturating_add(1);
            } else {
                self.graph_materializer_cache_miss_count =
                    self.graph_materializer_cache_miss_count.saturating_add(1);
            }
        }
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
        self.last_provider_latency_ms = summary.provider_latency_ms.clone();
        let slowest_provider = slowest_provider(&summary.provider_latency_ms);
        self.last_slow_provider = slowest_provider
            .as_ref()
            .map(|(provider, _)| provider.clone());
        self.last_slow_provider_ms = slowest_provider.map(|(_, latency_ms)| latency_ms);
        self.provider_latency_budget_exceeded_count =
            self.provider_latency_budget_exceeded_count.saturating_add(
                summary
                    .provider_latency_ms
                    .values()
                    .filter(|latency_ms| **latency_ms > PROVIDER_LATENCY_BUDGET_MS)
                    .count() as u64,
            );
        let timed_out_sources = timed_out_source_names(&summary.stages);
        self.source_batch_timeout_count = self
            .source_batch_timeout_count
            .saturating_add(timed_out_sources.len() as u64);
        self.last_source_batch_timed_out_sources = timed_out_sources;
        self.last_source_health = extract_source_health(&summary.stages);
        self.record_component_health_events(&summary.stages);
        if summary
            .degraded_reasons
            .iter()
            .any(|reason| reason == "empty_retrieval")
        {
            self.empty_retrieval_count = self.empty_retrieval_count.saturating_add(1);
        }
        if summary
            .degraded_reasons
            .iter()
            .any(|reason| reason == "empty_selection")
        {
            self.empty_selection_count = self.empty_selection_count.saturating_add(1);
        }
        if summary
            .degraded_reasons
            .iter()
            .any(|reason| reason == "underfilled_selection")
            || summary.serving.page_underfilled
        {
            self.underfilled_selection_count = self.underfilled_selection_count.saturating_add(1);
        }
        if summary
            .degraded_reasons
            .iter()
            .any(|reason| reason == "ranking:PhoenixScorer:empty_ml_ranking")
        {
            self.phoenix_empty_ranking_count = self.phoenix_empty_ranking_count.saturating_add(1);
        }
        self.last_online_eval = summary.online_eval.clone();
        self.online_eval_total_selected = self
            .online_eval_total_selected
            .saturating_add(summary.online_eval.selected_count as u64);
        self.online_eval_trend_selected = self
            .online_eval_trend_selected
            .saturating_add(summary.online_eval.trend_count as u64);
        self.online_eval_news_selected = self
            .online_eval_news_selected
            .saturating_add(summary.online_eval.news_count as u64);
        self.online_eval_exploration_selected = self
            .online_eval_exploration_selected
            .saturating_add(summary.online_eval.exploration_count as u64);
        accumulate_count_map(
            &mut self.online_eval_source_counts,
            &summary.online_eval.source_counts,
        );
        accumulate_count_map(
            &mut self.online_eval_lane_counts,
            &summary.online_eval.lane_counts,
        );
        accumulate_count_map(
            &mut self.online_eval_pool_counts,
            &summary.online_eval.pool_counts,
        );
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

    pub fn circuit_open_sources(&self) -> Vec<String> {
        self.component_health_windows()
            .into_iter()
            .filter(|entry| entry.stage == "Source" && entry.circuit_open)
            .map(|entry| entry.component)
            .collect()
    }

    pub fn circuit_open_hydrators(&self) -> Vec<String> {
        self.component_health_windows()
            .into_iter()
            .filter(|entry| entry.stage.contains("Hydrator") && entry.circuit_open)
            .map(|entry| entry.component)
            .collect()
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
        let guardrails = build_guardrails(
            &degraded_reasons,
            &self.last_provider_latency_ms,
            &self.last_source_health,
            self.last_page_underfilled.unwrap_or(false),
        );
        let component_health_windows = self.component_health_windows();
        let circuit_breaker_open_components = component_health_windows
            .iter()
            .filter(|entry| entry.circuit_open)
            .map(|entry| entry.component.clone())
            .collect::<Vec<_>>();
        let circuit_breaker_open_sources = component_health_windows
            .iter()
            .filter(|entry| entry.circuit_open && entry.stage == "Source")
            .map(|entry| entry.component.clone())
            .collect::<Vec<_>>();
        let circuit_breaker_open_hydrators = component_health_windows
            .iter()
            .filter(|entry| entry.circuit_open && entry.stage.contains("Hydrator"))
            .map(|entry| entry.component.clone())
            .collect::<Vec<_>>();

        let status = if self.last_error.is_some() {
            "degraded"
        } else if guardrails.status == "ok" && degraded_reasons.is_empty() {
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
            last_graph_materializer_query_duration_ms: self
                .last_graph_materializer_query_duration_ms,
            last_graph_materializer_provider_latency_ms: self
                .last_graph_materializer_provider_latency_ms,
            last_graph_materializer_cache_hit: self.last_graph_materializer_cache_hit,
            graph_materializer_cache_hit_count: self.graph_materializer_cache_hit_count,
            graph_materializer_cache_miss_count: self.graph_materializer_cache_miss_count,
            graph_materializer_cache_hit_rate: ratio(
                self.graph_materializer_cache_hit_count,
                self.graph_materializer_cache_hit_count
                    .saturating_add(self.graph_materializer_cache_miss_count),
            ),
            last_graph_materializer_cache_key_mode: self
                .last_graph_materializer_cache_key_mode
                .clone(),
            last_graph_materializer_cache_ttl_ms: self.last_graph_materializer_cache_ttl_ms,
            last_graph_materializer_cache_entry_count: self
                .last_graph_materializer_cache_entry_count,
            last_graph_materializer_cache_eviction_count: self
                .last_graph_materializer_cache_eviction_count,
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
            last_provider_latency_ms: self.last_provider_latency_ms.clone(),
            last_slow_provider: self.last_slow_provider.clone(),
            last_slow_provider_ms: self.last_slow_provider_ms,
            provider_latency_budget_exceeded_count: self.provider_latency_budget_exceeded_count,
            provider_latency_budget_ms: PROVIDER_LATENCY_BUDGET_MS,
            source_batch_timeout_count: self.source_batch_timeout_count,
            last_source_batch_timed_out_sources: self.last_source_batch_timed_out_sources.clone(),
            source_batch_component_timeout_ms: SOURCE_BATCH_COMPONENT_TIMEOUT_MS,
            last_source_health: self.last_source_health.clone(),
            component_health_windows,
            circuit_breaker_open_components,
            circuit_breaker_open_sources,
            circuit_breaker_open_hydrators,
            guardrails,
            empty_retrieval_count: self.empty_retrieval_count,
            empty_selection_count: self.empty_selection_count,
            underfilled_selection_count: self.underfilled_selection_count,
            phoenix_empty_ranking_count: self.phoenix_empty_ranking_count,
            last_online_eval: self.last_online_eval.clone(),
            online_eval_total_selected: self.online_eval_total_selected,
            online_eval_trend_selected: self.online_eval_trend_selected,
            online_eval_news_selected: self.online_eval_news_selected,
            online_eval_exploration_selected: self.online_eval_exploration_selected,
            online_eval_source_counts: self.online_eval_source_counts.clone(),
            online_eval_lane_counts: self.online_eval_lane_counts.clone(),
            online_eval_pool_counts: self.online_eval_pool_counts.clone(),
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

    fn record_component_health_events(&mut self, stages: &[RecommendationStagePayload]) {
        let now = Utc::now();
        for stage in stages.iter().filter(|stage| is_health_tracked_stage(stage)) {
            let event = component_health_event(stage, now);
            let samples = self
                .component_health_events
                .entry(event.component.clone())
                .or_default();
            samples.push_back(event);
            prune_component_health_events(samples, now);
        }
    }

    fn component_health_windows(&self) -> Vec<RecommendationComponentHealthWindowEntry> {
        let now = Utc::now();
        let mut entries = self
            .component_health_events
            .values()
            .filter_map(|events| summarize_component_health_events(events, now))
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            left.stage
                .cmp(&right.stage)
                .then_with(|| left.component.cmp(&right.component))
        });
        entries
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

fn component_health_event(
    stage: &RecommendationStagePayload,
    recorded_at: DateTime<Utc>,
) -> ComponentHealthEvent {
    let detail = stage.detail.as_ref();
    let timed_out = stage_timed_out(stage);
    let error_class = detail
        .and_then(|detail| detail.get("errorClass"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            detail
                .and_then(|detail| detail.get("error"))
                .and_then(serde_json::Value::as_str)
                .filter(|error| !error.trim().is_empty())
                .map(|_| "component_error".to_string())
        });
    let error = detail
        .and_then(|detail| detail.get("error"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error| !error.trim().is_empty())
        || error_class.is_some();

    ComponentHealthEvent {
        recorded_at,
        component: stage.name.clone(),
        stage: health_stage_kind(stage),
        enabled: stage.enabled,
        output_count: stage.output_count,
        duration_ms: stage.duration_ms,
        timed_out,
        error,
        degraded: stage.enabled && (timed_out || error),
        error_class,
        disabled_reason: stage_disabled_reason(stage),
    }
}

fn prune_component_health_events(events: &mut VecDeque<ComponentHealthEvent>, now: DateTime<Utc>) {
    while events.front().is_some_and(|event| {
        now.signed_duration_since(event.recorded_at).num_seconds() > COMPONENT_HEALTH_WINDOW_SECONDS
    }) {
        events.pop_front();
    }
    while events.len() > 256 {
        events.pop_front();
    }
}

fn summarize_component_health_events(
    events: &VecDeque<ComponentHealthEvent>,
    now: DateTime<Utc>,
) -> Option<RecommendationComponentHealthWindowEntry> {
    let recent = events
        .iter()
        .filter(|event| {
            now.signed_duration_since(event.recorded_at).num_seconds()
                <= COMPONENT_HEALTH_WINDOW_SECONDS
        })
        .collect::<Vec<_>>();
    let first = recent.first()?;
    let request_count = recent.len();
    let enabled_count = recent.iter().filter(|event| event.enabled).count();
    let timeout_count = recent.iter().filter(|event| event.timed_out).count();
    let error_count = recent.iter().filter(|event| event.error).count();
    let degraded_count = recent.iter().filter(|event| event.degraded).count();
    let success_count = recent
        .iter()
        .filter(|event| event.enabled && !event.timed_out && !event.error)
        .count();
    let output_count = recent.iter().map(|event| event.output_count).sum::<usize>();
    let duration_sum = recent.iter().map(|event| event.duration_ms).sum::<u64>();
    let last = recent
        .iter()
        .max_by_key(|event| event.recorded_at)
        .copied()
        .unwrap_or(first);
    let circuit_open = component_circuit_open(
        &first.component,
        &first.stage,
        enabled_count,
        timeout_count,
        error_count,
    );

    Some(RecommendationComponentHealthWindowEntry {
        component: first.component.clone(),
        stage: first.stage.clone(),
        window_seconds: COMPONENT_HEALTH_WINDOW_SECONDS as u64,
        request_count,
        enabled_count,
        success_count,
        timeout_count,
        error_count,
        degraded_count,
        output_count,
        avg_duration_ms: duration_sum / request_count.max(1) as u64,
        last_duration_ms: last.duration_ms,
        circuit_open,
        readiness_impact: readiness_impact(&first.component, &first.stage, circuit_open),
        last_error_class: last.error_class.clone(),
        last_disabled_reason: last.disabled_reason.clone(),
    })
}

fn is_health_tracked_stage(stage: &RecommendationStagePayload) -> bool {
    is_source_stage(stage) || stage.name.ends_with("Hydrator")
}

fn health_stage_kind(stage: &RecommendationStagePayload) -> String {
    if is_source_stage(stage) {
        "Source".to_string()
    } else if stage.name.ends_with("Hydrator") {
        "Hydrator".to_string()
    } else {
        "Component".to_string()
    }
}

fn stage_disabled_reason(stage: &RecommendationStagePayload) -> Option<String> {
    let detail = stage.detail.as_ref()?;
    detail
        .get("disabledByCircuit")
        .or_else(|| detail.get("disabledByPolicy"))
        .or_else(|| detail.get("disabledByConfig"))
        .or_else(|| detail.get("disabled"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
}

fn component_circuit_open(
    component: &str,
    stage: &str,
    enabled_count: usize,
    timeout_count: usize,
    error_count: usize,
) -> bool {
    if !circuit_skip_allowed(component, stage) || enabled_count < CIRCUIT_MIN_EVENTS {
        return false;
    }
    let failures = timeout_count.saturating_add(error_count);
    failures >= CIRCUIT_MIN_EVENTS && failures as f64 / enabled_count as f64 >= CIRCUIT_FAILURE_RATE
}

fn circuit_skip_allowed(component: &str, stage: &str) -> bool {
    match stage {
        "Source" => !matches!(component, "FollowingSource" | "ColdStartSource"),
        "Hydrator" => !matches!(
            component,
            "UserStateQueryHydrator" | "ExperimentQueryHydrator"
        ),
        _ => false,
    }
}

fn readiness_impact(component: &str, stage: &str, circuit_open: bool) -> String {
    if circuit_open {
        return "degraded_skip".to_string();
    }
    if circuit_skip_allowed(component, stage) {
        "observable".to_string()
    } else {
        "critical_observe_only".to_string()
    }
}

fn rescue_hit_rate(attempts: u64, hits: u64) -> Option<f64> {
    (attempts > 0).then_some(hits as f64 / attempts as f64)
}

fn ratio(numerator: u64, denominator: u64) -> Option<f64> {
    (denominator > 0).then_some(numerator as f64 / denominator as f64)
}

fn accumulate_count_map(target: &mut HashMap<String, u64>, source: &HashMap<String, usize>) {
    for (key, count) in source {
        *target.entry(key.clone()).or_insert(0) += *count as u64;
    }
}

fn slowest_provider(provider_latency_ms: &HashMap<String, u64>) -> Option<(String, u64)> {
    provider_latency_ms
        .iter()
        .max_by(|left, right| left.1.cmp(right.1).then_with(|| right.0.cmp(left.0)))
        .map(|(provider, latency_ms)| (provider.clone(), *latency_ms))
}

fn timed_out_source_names(stages: &[crate::contracts::RecommendationStagePayload]) -> Vec<String> {
    let mut sources = stages
        .iter()
        .filter(|stage| stage_timed_out(stage))
        .map(|stage| stage.name.clone())
        .collect::<Vec<_>>();
    sources.sort();
    sources.dedup();
    sources
}

fn stage_timed_out(stage: &crate::contracts::RecommendationStagePayload) -> bool {
    let Some(detail) = stage.detail.as_ref() else {
        return false;
    };

    let timed_out = detail
        .get("timedOut")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let error_is_timeout = detail
        .get("error")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error| error.starts_with("source_timeout"));
    let error_class_is_timeout = detail
        .get("errorClass")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error_class| error_class == "source_timeout");

    timed_out || error_is_timeout || error_class_is_timeout
}

fn extract_source_health(
    stages: &[RecommendationStagePayload],
) -> Vec<RecommendationSourceHealthEntry> {
    stages
        .iter()
        .filter(|stage| is_source_stage(stage))
        .map(|stage| {
            let detail = stage.detail.as_ref();
            RecommendationSourceHealthEntry {
                source: stage.name.clone(),
                enabled: stage.enabled,
                output_count: stage.output_count,
                duration_ms: stage.duration_ms,
                timed_out: stage_timed_out(stage),
                degraded: detail
                    .and_then(|detail| detail.get("error"))
                    .and_then(serde_json::Value::as_str)
                    .is_some()
                    || stage_timed_out(stage),
                error_class: detail
                    .and_then(|detail| detail.get("errorClass"))
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned),
                disabled_reason: detail
                    .and_then(|detail| detail.get("disabledByPolicy"))
                    .or_else(|| detail.and_then(|detail| detail.get("disabledByConfig")))
                    .or_else(|| detail.and_then(|detail| detail.get("disabled")))
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned),
                source_budget: detail
                    .and_then(|detail| detail.get("sourceBudget"))
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as usize),
                pre_policy_count: detail
                    .and_then(|detail| detail.get("prePolicyCount"))
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as usize),
            }
        })
        .collect()
}

fn build_guardrails(
    degraded_reasons: &[String],
    provider_latency_ms: &HashMap<String, u64>,
    source_health: &[RecommendationSourceHealthEntry],
    page_underfilled: bool,
) -> RecommendationGuardrailStatus {
    let empty_retrieval = degraded_reasons
        .iter()
        .any(|reason| reason == "empty_retrieval");
    let empty_selection = degraded_reasons
        .iter()
        .any(|reason| reason == "empty_selection");
    let underfilled_selection = page_underfilled
        || degraded_reasons
            .iter()
            .any(|reason| reason == "underfilled_selection");
    let ml_ranking_empty = degraded_reasons
        .iter()
        .any(|reason| reason == "ranking:PhoenixScorer:empty_ml_ranking");
    let provider_budget_exceeded = provider_latency_ms
        .values()
        .any(|latency_ms| *latency_ms > PROVIDER_LATENCY_BUDGET_MS);
    let source_timeout_count = source_health.iter().filter(|entry| entry.timed_out).count();
    let source_error_count = source_health.iter().filter(|entry| entry.degraded).count();
    let status = if empty_selection || provider_budget_exceeded || source_timeout_count > 0 {
        "tripped"
    } else if empty_retrieval
        || underfilled_selection
        || ml_ranking_empty
        || !degraded_reasons.is_empty()
    {
        "degraded"
    } else {
        "ok"
    };

    RecommendationGuardrailStatus {
        status: status.to_string(),
        empty_retrieval,
        empty_selection,
        underfilled_selection,
        ml_ranking_empty,
        provider_budget_exceeded,
        source_timeout_count,
        source_error_count,
        degraded_reason_count: degraded_reasons.len(),
    }
}

fn is_source_stage(stage: &RecommendationStagePayload) -> bool {
    stage.name.ends_with("Source")
        && stage.name != "RecentStoreSideEffect"
        && stage.name != "ServeCacheWriteSideEffect"
}

#[cfg(test)]
mod component_health_tests {
    use super::*;

    #[test]
    fn component_health_window_opens_circuit_for_repeat_source_failures() {
        let now = Utc::now();
        let events = VecDeque::from(vec![
            ComponentHealthEvent {
                recorded_at: now,
                component: "NewsAnnSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_200,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
            ComponentHealthEvent {
                recorded_at: now,
                component: "NewsAnnSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_180,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
        ]);

        let summary = summarize_component_health_events(&events, now).expect("summary");

        assert!(summary.circuit_open);
        assert_eq!(summary.readiness_impact, "degraded_skip");
        assert_eq!(summary.timeout_count, 2);
    }

    #[test]
    fn component_health_window_keeps_critical_sources_observe_only() {
        let now = Utc::now();
        let events = VecDeque::from(vec![
            ComponentHealthEvent {
                recorded_at: now,
                component: "FollowingSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_200,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
            ComponentHealthEvent {
                recorded_at: now,
                component: "FollowingSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_180,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
        ]);

        let summary = summarize_component_health_events(&events, now).expect("summary");

        assert!(!summary.circuit_open);
        assert_eq!(summary.readiness_impact, "critical_observe_only");
    }
}

#[cfg(test)]
mod tests {
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
                    kernel_source_counts: HashMap::from([(
                        "cpp_graph_social_neighbor".to_string(),
                        2,
                    )]),
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
}
