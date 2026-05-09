use std::collections::HashMap;

use chrono::{DateTime, Utc};
use telegram_pipeline_primitives::EXECUTOR_LATENCY_SERVING;
use telegram_serving_primitives::{ServingPageBuildInput, ServingPageBuildSummary};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::serving::cursor::build_next_cursor;
use crate::serving::dedup::dedup_for_serving;
use crate::serving::stable_order::{build_stable_order_key, sort_candidates_stably};

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::stages::{ServingStageInput, build_serving_stage};
use super::telemetry::RunTelemetry;

pub(super) struct ServingStageOutput {
    pub(super) final_candidates: Vec<RecommendationCandidatePayload>,
    pub(super) duplicate_suppressed_count: usize,
    pub(super) cross_page_duplicate_count: usize,
    pub(super) has_more: bool,
    pub(super) page_remaining_count: usize,
    pub(super) page_underfilled: bool,
    pub(super) page_underfill_reason: Option<String>,
    pub(super) suppression_reasons: HashMap<String, usize>,
    pub(super) truncated: bool,
    pub(super) next_cursor: Option<DateTime<Utc>>,
    pub(super) stable_order_key: String,
}

impl RecommendationPipeline {
    pub(super) fn execute_serving_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        mut final_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> ServingStageOutput {
        let serving_timer = StageTimer::start();
        sort_candidates_stably(&mut final_candidates, hydrated_query.in_network_only);
        let serving_result = dedup_for_serving(
            hydrated_query,
            &final_candidates,
            hydrated_query.limit,
            self.config.serving_author_soft_cap,
        );
        let duplicate_suppressed_count = serving_result.duplicate_suppressed_count;
        let cross_page_duplicate_count = serving_result.cross_page_duplicate_count;
        let has_more = serving_result.has_more;
        let page_remaining_count = serving_result.page_remaining_count;
        let page_underfilled = serving_result.page_underfilled;
        let page_underfill_reason = serving_result.page_underfill_reason.clone();
        let suppression_reasons = serving_result.suppression_reasons.clone();
        let pre_serving_count = final_candidates.len();
        final_candidates = serving_result.candidates;
        let truncated = has_more;
        let next_cursor = build_next_cursor(&final_candidates);
        let stable_order_key =
            build_stable_order_key(&final_candidates, hydrated_query.in_network_only);
        let page_build_summary = ServingPageBuildSummary::from_input(ServingPageBuildInput {
            requested_limit: hydrated_query.limit,
            output_count: final_candidates.len(),
            page_remaining_count,
            duplicate_suppressed_count,
            cross_page_duplicate_count,
            has_more,
            page_underfilled,
            page_underfill_reason: page_underfill_reason.clone(),
            suppression_reasons: suppression_reasons.clone(),
        });
        telemetry.add_stage(build_serving_stage(ServingStageInput {
            duration_ms: serving_timer.elapsed_ms(),
            input_count: pre_serving_count,
            summary: &page_build_summary,
            stable_order_key: &stable_order_key,
        }));
        telemetry.record_latency(EXECUTOR_LATENCY_SERVING, serving_timer.elapsed_ms());

        ServingStageOutput {
            final_candidates,
            duplicate_suppressed_count,
            cross_page_duplicate_count,
            has_more,
            page_remaining_count,
            page_underfilled,
            page_underfill_reason,
            suppression_reasons,
            truncated,
            next_cursor,
            stable_order_key,
        }
    }
}
