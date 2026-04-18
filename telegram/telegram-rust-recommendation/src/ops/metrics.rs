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
    last_ml_retrieved_count: Option<usize>,
    last_ml_ranked_count: Option<usize>,
    last_graph_retrieved_count: Option<usize>,
    last_graph_kernel_candidates: Option<usize>,
    last_graph_legacy_candidates: Option<usize>,
    last_graph_fallback_used: Option<bool>,
    last_graph_kernel_source_counts: HashMap<String, usize>,
    last_graph_dominant_source: Option<String>,
    last_provider_calls: HashMap<String, usize>,
    stage_latency_samples: HashMap<String, VecDeque<u64>>,
    last_stage_latency: HashMap<String, u64>,
    partial_degrade_count: u64,
    timeout_count: u64,
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
        self.last_ml_retrieved_count = Some(summary.retrieval.ml_retrieved_candidates);
        self.last_ml_ranked_count = Some(summary.ranking.ml_ranked_candidates);
        self.last_graph_retrieved_count = Some(summary.retrieval.graph.total_candidates);
        self.last_graph_kernel_candidates = Some(summary.retrieval.graph.kernel_candidates);
        self.last_graph_legacy_candidates = Some(summary.retrieval.graph.legacy_candidates);
        self.last_graph_fallback_used = Some(summary.retrieval.graph.fallback_used);
        self.last_graph_kernel_source_counts = summary.retrieval.graph.kernel_source_counts.clone();
        self.last_graph_dominant_source = summary.retrieval.graph.dominant_kernel_source.clone();
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
            last_ml_retrieved_count: self.last_ml_retrieved_count,
            last_ml_ranked_count: self.last_ml_ranked_count,
            last_graph_retrieved_count: self.last_graph_retrieved_count,
            last_graph_kernel_candidates: self.last_graph_kernel_candidates,
            last_graph_legacy_candidates: self.last_graph_legacy_candidates,
            last_graph_fallback_used: self.last_graph_fallback_used,
            last_graph_kernel_source_counts: self.last_graph_kernel_source_counts.clone(),
            last_graph_dominant_source: self.last_graph_dominant_source.clone(),
            last_provider_calls: self.last_provider_calls.clone(),
            stage_latency: self.build_stage_latency_summary(),
            partial_degrade_count: self.partial_degrade_count,
            timeout_count: self.timeout_count,
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::contracts::{
        RecommendationGraphRetrievalPayload, RecommendationRankingSummaryPayload,
        RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
        RecommendationSummaryPayload,
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
            pipeline_version: "xalgo_candidate_pipeline_v4".to_string(),
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
            retrieval: RecommendationRetrievalSummaryPayload {
                stage: "source_parallel_graph_v3".to_string(),
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
                    dominant_kernel_source: Some("cpp_graph_social_neighbor".to_string()),
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
}
