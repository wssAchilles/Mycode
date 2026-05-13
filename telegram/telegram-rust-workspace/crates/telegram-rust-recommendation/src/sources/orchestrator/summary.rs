use std::collections::HashMap;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationGraphRetrievalPayload,
    RecommendationRetrievalSummaryPayload,
};
use telegram_source_primitives::{
    SOURCE_ORCHESTRATION_STAGE, SourceSummaryContractInput, source_summary_contract_violations,
};

pub(super) struct RetrievalSummaryInput<'a> {
    pub(super) candidates: &'a [RecommendationCandidatePayload],
    pub(super) source_counts: HashMap<String, usize>,
    pub(super) source_outcome_counts: HashMap<String, usize>,
    pub(super) source_failure_counts: HashMap<String, usize>,
    pub(super) source_disabled_counts: HashMap<String, usize>,
    pub(super) lane_counts: HashMap<String, usize>,
    pub(super) ml_source_counts: HashMap<String, usize>,
    pub(super) stage_timings: HashMap<String, u64>,
    pub(super) degraded_reasons: Vec<String>,
    pub(super) graph_summary: RecommendationGraphRetrievalPayload,
}

pub(super) fn build_retrieval_summary(
    input: RetrievalSummaryInput<'_>,
) -> RecommendationRetrievalSummaryPayload {
    let in_network_candidates = input
        .candidates
        .iter()
        .filter(|candidate| candidate.in_network.unwrap_or(false))
        .count();
    let out_of_network_candidates = input.candidates.len().saturating_sub(in_network_candidates);
    let mut degraded_reasons = input.degraded_reasons;
    degraded_reasons.extend(
        source_summary_contract_violations(SourceSummaryContractInput {
            total_candidates: input.candidates.len(),
            source_counts: &input.source_counts,
            source_outcome_counts: &input.source_outcome_counts,
            source_failure_counts: &input.source_failure_counts,
            source_disabled_counts: &input.source_disabled_counts,
            lane_counts: &input.lane_counts,
        })
        .into_iter()
        .map(|violation| format!("retrieval:summary:{violation}")),
    );

    RecommendationRetrievalSummaryPayload {
        stage: SOURCE_ORCHESTRATION_STAGE.to_string(),
        total_candidates: input.candidates.len(),
        in_network_candidates,
        out_of_network_candidates,
        ml_retrieved_candidates: input.ml_source_counts.values().copied().sum(),
        recent_hot_candidates: 0,
        source_counts: input.source_counts,
        source_outcome_counts: input.source_outcome_counts,
        source_failure_counts: input.source_failure_counts,
        source_disabled_counts: input.source_disabled_counts,
        lane_counts: input.lane_counts,
        ml_source_counts: input.ml_source_counts,
        stage_timings: input.stage_timings,
        degraded_reasons,
        graph: input.graph_summary,
    }
}
