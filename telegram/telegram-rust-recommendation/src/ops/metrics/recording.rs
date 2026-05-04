use super::*;

impl RecommendationMetrics {
    pub fn record_success(&mut self, summary: &RecommendationSummaryPayload) {
        self.total_requests = self.total_requests.saturating_add(1);
        self.last_request_id = Some(summary.request_id.clone());
        self.last_selected_count = Some(summary.selected_count);
        self.last_retrieved_count = Some(summary.retrieved_count);
        self.record_serving_snapshot(summary);
        self.record_rescue_snapshot(summary);
        self.record_retrieval_snapshot(summary);
        self.record_provider_snapshot(summary);
        self.record_degrade_counters(summary);
        self.record_online_eval(summary);
        self.record_stage_latency(summary);
        self.record_completion_state(summary);
    }

    fn record_serving_snapshot(&mut self, summary: &RecommendationSummaryPayload) {
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
    }

    fn record_rescue_snapshot(&mut self, summary: &RecommendationSummaryPayload) {
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
    }

    fn record_retrieval_snapshot(&mut self, summary: &RecommendationSummaryPayload) {
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
        self.last_graph_materializer_requested_author_count =
            summary.retrieval.graph.materializer_requested_author_count;
        self.last_graph_materializer_unique_author_count =
            summary.retrieval.graph.materializer_unique_author_count;
        self.last_graph_materializer_returned_post_count =
            summary.retrieval.graph.materializer_returned_post_count;
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
    }

    fn record_provider_snapshot(&mut self, summary: &RecommendationSummaryPayload) {
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
    }

    fn record_degrade_counters(&mut self, summary: &RecommendationSummaryPayload) {
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
    }

    fn record_online_eval(&mut self, summary: &RecommendationSummaryPayload) {
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
    }

    fn record_stage_latency(&mut self, summary: &RecommendationSummaryPayload) {
        self.last_stage_latency = summary.stage_latency_ms.clone();
        for (key, value) in &summary.stage_latency_ms {
            let samples = self.stage_latency_samples.entry(key.clone()).or_default();
            samples.push_back(*value);
            while samples.len() > 128 {
                samples.pop_front();
            }
        }
    }

    fn record_completion_state(&mut self, summary: &RecommendationSummaryPayload) {
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
}
