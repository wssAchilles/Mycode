use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::top_k::{build_selector_stage_detail, select_candidates_with_report};
use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;
use telegram_pipeline_primitives::EXECUTOR_LATENCY_SELECTOR;

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;

impl RecommendationPipeline {
    pub(super) fn execute_selector_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        scored_candidates: &[RecommendationCandidatePayload],
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        let selector_timer = StageTimer::start();
        let selector_output = select_candidates_with_report(
            hydrated_query,
            scored_candidates,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
            self.config.serving_author_soft_cap,
        );
        let oversampled = selector_output.candidates;
        let selector_detail = build_selector_stage_detail(
            &selector_output.report,
            &oversampled,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
            self.config.serving_author_soft_cap,
        );
        telemetry.add_stage(RecommendationStagePayload {
            name: RUST_TOP_K_SELECTOR.to_string(),
            enabled: true,
            duration_ms: selector_timer.elapsed_ms(),
            input_count: scored_candidates.len(),
            output_count: oversampled.len(),
            removed_count: Some(scored_candidates.len().saturating_sub(oversampled.len())),
            detail: Some(selector_detail),
        });
        telemetry.record_latency(EXECUTOR_LATENCY_SELECTOR, selector_timer.elapsed_ms());
        oversampled
    }
}
