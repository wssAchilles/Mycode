use chrono::{DateTime, Utc};

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
            degraded_reasons,
            recent_store,
        }
    }
}
