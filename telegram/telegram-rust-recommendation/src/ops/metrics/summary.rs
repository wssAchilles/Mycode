use super::*;

impl RecommendationMetrics {
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
            last_graph_materializer_requested_author_count: self
                .last_graph_materializer_requested_author_count,
            last_graph_materializer_unique_author_count: self
                .last_graph_materializer_unique_author_count,
            last_graph_materializer_returned_post_count: self
                .last_graph_materializer_returned_post_count,
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

    pub(super) fn record_component_health_events(&mut self, stages: &[RecommendationStagePayload]) {
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
