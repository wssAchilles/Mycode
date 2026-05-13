use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::top_k::{SelectorStageInput, build_selector_stage, select_candidates_with_report};
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
        let selector_duration_ms = selector_timer.elapsed_ms();
        telemetry.add_stage(build_selector_stage(SelectorStageInput {
            duration_ms: selector_duration_ms,
            input_count: scored_candidates.len(),
            selected: &oversampled,
            report: &selector_output.report,
            oversample_factor: self.config.selector_oversample_factor,
            max_selector_size: self.config.selector_max_size,
            author_soft_cap: self.config.serving_author_soft_cap,
        }));
        telemetry.record_latency(EXECUTOR_LATENCY_SELECTOR, selector_duration_ms);
        oversampled
    }
}
