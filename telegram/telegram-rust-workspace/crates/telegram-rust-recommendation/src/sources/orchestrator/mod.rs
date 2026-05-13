use std::collections::HashMap;
use std::time::Instant;

use anyhow::Result;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload, RetrievalResponse};
use crate::sources::{GRAPH_SOURCE, source_descriptor};
use telegram_source_primitives::{
    SOURCE_LANE_MERGE_STAGE_NAME, SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD,
};

use super::graph_source::GraphSourceRuntime;

mod evidence;
mod execution;
mod graph_summary;
mod merge;
mod policy;
mod stage_detail;
mod summary;

use execution::SourceExecution;
use graph_summary::{apply_graph_breakdown, empty_graph_summary};
use merge::merge_source_candidates;
use stage_detail::{dedup_reasons, record_stage};
use summary::{RetrievalSummaryInput, build_retrieval_summary};

#[cfg(test)]
use execution::build_failed_source_execution;

const GRAPH_SOURCE_NAME: &str = GRAPH_SOURCE;

#[derive(Clone)]
pub struct RecommendationSourceOrchestrator {
    pub(super) backend_client: BackendRecommendationClient,
    pub(super) graph_source_runtime: GraphSourceRuntime,
    pub(super) source_order: Vec<String>,
    pub(super) graph_source_enabled: bool,
    pub(super) source_concurrency: usize,
}

impl RecommendationSourceOrchestrator {
    pub fn new(
        backend_client: BackendRecommendationClient,
        graph_source_runtime: GraphSourceRuntime,
        source_order: Vec<String>,
        graph_source_enabled: bool,
        source_concurrency: usize,
    ) -> Self {
        Self {
            backend_client,
            graph_source_runtime,
            source_order,
            graph_source_enabled,
            source_concurrency,
        }
    }

    pub async fn retrieve_candidates(
        &self,
        query: &RecommendationQueryPayload,
        circuit_open_sources: &[String],
    ) -> Result<RetrievalResponse> {
        let mut stages = Vec::new();
        let mut source_counts = HashMap::new();
        let mut ml_source_counts = HashMap::new();
        let mut stage_timings = HashMap::new();
        let mut degraded_reasons = Vec::new();
        let mut provider_calls = HashMap::new();
        let mut provider_latency_ms = HashMap::new();
        let mut retrieval_candidates = Vec::new();
        let mut graph_summary = empty_graph_summary();

        let (source_results, source_transport_latency_ms) = self
            .retrieve_source_results(query, circuit_open_sources)
            .await?;
        for (provider_key, latency_ms) in source_transport_latency_ms {
            *provider_latency_ms.entry(provider_key).or_insert(0) += latency_ms;
        }

        for source_result in source_results {
            let SourceExecution {
                source_name,
                stage,
                candidates: source_candidates,
                provider_calls: source_provider_calls,
                provider_latency_ms: source_provider_latency_ms,
                breakdown,
            } = source_result;
            for (provider_key, count) in source_provider_calls {
                *provider_calls.entry(provider_key).or_insert(0) += count;
            }
            for (provider_key, latency_ms) in source_provider_latency_ms {
                *provider_latency_ms.entry(provider_key).or_insert(0) += latency_ms;
            }
            record_stage(
                &mut stages,
                &mut stage_timings,
                &mut degraded_reasons,
                &stage,
            );
            source_counts.insert(source_name.clone(), source_candidates.len());

            if source_descriptor(&source_name).is_some_and(|descriptor| descriptor.is_ml_backed) {
                ml_source_counts.insert(source_name.clone(), source_candidates.len());
            }

            if source_name == GRAPH_SOURCE_NAME && self.graph_source_enabled {
                apply_graph_breakdown(&mut graph_summary, breakdown, &mut degraded_reasons);
            }

            retrieval_candidates.push((source_name, source_candidates));
        }

        let lane_merge_started_at = Instant::now();
        let (candidates, lane_counts, lane_merge_detail) =
            merge_source_candidates(query, retrieval_candidates, &self.source_order);

        let lane_merge_stage = RecommendationStagePayload {
            name: SOURCE_LANE_MERGE_STAGE_NAME.to_string(),
            enabled: true,
            duration_ms: lane_merge_started_at.elapsed().as_millis() as u64,
            input_count: source_counts.values().copied().sum(),
            output_count: candidates.len(),
            removed_count: lane_merge_detail
                .get(SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD)
                .and_then(|value| value.as_u64())
                .map(|value| value as usize),
            detail: Some(lane_merge_detail),
        };
        record_stage(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            &lane_merge_stage,
        );

        dedup_reasons(&mut degraded_reasons);

        let summary = build_retrieval_summary(RetrievalSummaryInput {
            candidates: &candidates,
            source_counts,
            lane_counts,
            ml_source_counts,
            stage_timings,
            degraded_reasons,
            graph_summary,
        });

        Ok(RetrievalResponse {
            summary,
            provider_calls,
            provider_latency_ms,
            candidates,
            stages,
        })
    }
}

#[cfg(test)]
mod tests;
