use anyhow::Result;
use telegram_pipeline_primitives::{
    EXECUTOR_LATENCY_POST_SELECTION_FILTER, EXECUTOR_LATENCY_POST_SELECTION_HYDRATE,
    PROVIDER_KEY_POST_SELECTION_HYDRATE,
};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::filters::run_post_selection_filters;

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::stages::active_component_names;
use super::telemetry::RunTelemetry;

impl RecommendationPipeline {
    pub(super) async fn execute_post_selection_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        oversampled: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<Vec<RecommendationCandidatePayload>> {
        let post_hydrated_candidates = self
            .execute_post_selection_hydration_stage(
                hydrated_query,
                oversampled,
                circuit_open_hydrators,
                telemetry,
            )
            .await?;
        Ok(self.execute_post_selection_filter_stage(
            hydrated_query,
            post_hydrated_candidates,
            telemetry,
        ))
    }

    async fn execute_post_selection_hydration_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        oversampled: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<Vec<RecommendationCandidatePayload>> {
        let post_hydrate_timer = StageTimer::start();
        let (post_hydrator_components, mut skipped_post_hydrator_stages) = active_component_names(
            &self.definition.post_selection_hydrators,
            circuit_open_hydrators,
            oversampled.len(),
        );
        telemetry.append_stages(std::mem::take(&mut skipped_post_hydrator_stages));
        let mut post_hydrate_response = self
            .backend_client
            .hydrate_post_selection_candidates_with_components(
                hydrated_query,
                oversampled,
                post_hydrator_components,
            )
            .await?;
        telemetry.record_provider_call(PROVIDER_KEY_POST_SELECTION_HYDRATE);
        telemetry.record_provider_latency(
            PROVIDER_KEY_POST_SELECTION_HYDRATE,
            post_hydrate_response.latency_ms,
        );
        telemetry.merge_provider_calls(&post_hydrate_response.payload.provider_calls);
        let post_hydrated_candidates = post_hydrate_response.payload.candidates;
        telemetry.append_stages(std::mem::take(&mut post_hydrate_response.payload.stages));
        telemetry.record_latency(
            EXECUTOR_LATENCY_POST_SELECTION_HYDRATE,
            post_hydrate_timer.elapsed_ms(),
        );
        Ok(post_hydrated_candidates)
    }

    fn execute_post_selection_filter_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        post_hydrated_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        let post_filter_timer = StageTimer::start();
        let post_filter_execution =
            run_post_selection_filters(hydrated_query, post_hydrated_candidates);
        telemetry.merge_drop_counts(&post_filter_execution.drop_counts);
        let final_candidates = post_filter_execution.candidates;
        telemetry.append_stages(post_filter_execution.stages);
        telemetry.record_latency(
            EXECUTOR_LATENCY_POST_SELECTION_FILTER,
            post_filter_timer.elapsed_ms(),
        );
        final_candidates
    }
}
