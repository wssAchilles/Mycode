use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::query_hydrators::stage_payload::query_stage_error;
use telegram_component_primitives::query_hydrators::USER_FEATURES_QUERY_HYDRATOR;
use telegram_pipeline_primitives::EXECUTOR_LATENCY_QUERY_HYDRATORS;

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;

pub(super) struct QueryStageOutput {
    pub(super) hydrated_query: RecommendationQueryPayload,
    pub(super) circuit_open_sources: Vec<String>,
    pub(super) circuit_open_hydrators: Vec<String>,
    pub(super) safety_context_unavailable: bool,
}

fn safety_context_unavailable(stages: &[RecommendationStagePayload]) -> bool {
    stages.iter().any(|stage| {
        stage.name == USER_FEATURES_QUERY_HYDRATOR && query_stage_error(stage).is_some()
    })
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
        let safety_context_unavailable = safety_context_unavailable(&query_stages);
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
            safety_context_unavailable,
        }
    }
}

#[cfg(test)]
mod tests {
    use telegram_component_primitives::query_hydrators::USER_FEATURES_QUERY_HYDRATOR;

    use super::safety_context_unavailable;
    use crate::query_hydrators::stage_payload::build_query_error_stage;

    #[test]
    fn user_features_error_marks_safety_context_unavailable() {
        let failed = build_query_error_stage(
            USER_FEATURES_QUERY_HYDRATOR,
            "recommendation_safety_context_unavailable",
        );
        let unrelated = build_query_error_stage("EmbeddingQueryHydrator", "provider_timeout");
        let mut healthy = failed.clone();
        healthy.detail = None;

        assert!(safety_context_unavailable(&[failed]));
        assert!(!safety_context_unavailable(&[unrelated]));
        assert!(!safety_context_unavailable(&[healthy]));
    }
}
