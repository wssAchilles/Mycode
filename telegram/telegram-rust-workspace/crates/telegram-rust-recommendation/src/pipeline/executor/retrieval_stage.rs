use anyhow::Result;
use telegram_pipeline_primitives::{
    EXECUTOR_LATENCY_SOURCES, PROVIDER_KEY_RETRIEVAL, RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationRetrievalSummaryPayload,
};

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;

pub(super) struct RetrievalStageOutput {
    pub(super) retrieved: Vec<RecommendationCandidatePayload>,
    pub(super) retrieved_count: usize,
    pub(super) retrieval_summary: RecommendationRetrievalSummaryPayload,
}

impl RecommendationPipeline {
    pub(super) async fn execute_retrieval_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        circuit_open_sources: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<RetrievalStageOutput> {
        let retrieval_timer = StageTimer::start();
        let mut retrieval_response =
            if self.config.retrieval_mode == RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2 {
                self.source_orchestrator
                    .retrieve_candidates(hydrated_query, circuit_open_sources)
                    .await?
            } else {
                let response = self
                    .backend_client
                    .retrieve_candidates(hydrated_query)
                    .await?;
                telemetry.record_provider_call(PROVIDER_KEY_RETRIEVAL);
                telemetry.record_provider_latency(PROVIDER_KEY_RETRIEVAL, response.latency_ms);
                response.payload
            };
        let mut retrieved = retrieval_response.candidates;
        let mut retrieval_summary = retrieval_response.summary;
        telemetry.merge_provider_calls(&retrieval_response.provider_calls);
        telemetry.merge_provider_latency(&retrieval_response.provider_latency_ms);
        telemetry.append_stages(std::mem::take(&mut retrieval_response.stages));
        telemetry
            .degraded_reasons
            .extend(retrieval_summary.degraded_reasons.iter().cloned());

        if self.config.recent_source_enabled && !hydrated_query.in_network_only {
            self.append_recent_hot_candidates(
                hydrated_query,
                &mut retrieved,
                &mut retrieval_summary,
                telemetry,
            )
            .await;
        }
        telemetry.record_latency(EXECUTOR_LATENCY_SOURCES, retrieval_timer.elapsed_ms());

        let retrieved_count = retrieved.len();
        if retrieved_count == 0 {
            telemetry
                .degraded_reasons
                .push("empty_retrieval".to_string());
        }
        retrieval_summary.total_candidates = retrieved_count;

        Ok(RetrievalStageOutput {
            retrieved,
            retrieved_count,
            retrieval_summary,
        })
    }
}
