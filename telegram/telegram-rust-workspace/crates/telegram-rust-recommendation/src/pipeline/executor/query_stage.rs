use crate::contracts::RecommendationQueryPayload;
use telegram_pipeline_primitives::EXECUTOR_LATENCY_QUERY_HYDRATORS;

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;

pub(super) struct QueryStageOutput {
    pub(super) hydrated_query: RecommendationQueryPayload,
    pub(super) circuit_open_sources: Vec<String>,
    pub(super) circuit_open_hydrators: Vec<String>,
}

impl RecommendationPipeline {
    pub(super) async fn execute_query_stage(
        &self,
        query: &RecommendationQueryPayload,
        telemetry: &mut RunTelemetry,
    ) -> QueryStageOutput {
        let query_timer = StageTimer::start();
        let (
            hydrated_query,
            mut query_stages,
            query_provider_calls,
            query_provider_latency_ms,
            query_degraded_reasons,
        ) = self.hydrate_query_parallel_bounded(query).await;
        telemetry.record_latency(EXECUTOR_LATENCY_QUERY_HYDRATORS, query_timer.elapsed_ms());
        telemetry.merge_provider_calls(&query_provider_calls);
        telemetry.merge_provider_latency(&query_provider_latency_ms);
        telemetry.append_stages(std::mem::take(&mut query_stages));
        telemetry.degraded_reasons.extend(query_degraded_reasons);
        let (circuit_open_sources, circuit_open_hydrators) = {
            let metrics = self.metrics.lock().await;
            (
                metrics.circuit_open_sources(),
                metrics.circuit_open_hydrators(),
            )
        };

        QueryStageOutput {
            hydrated_query,
            circuit_open_sources,
            circuit_open_hydrators,
        }
    }
}
