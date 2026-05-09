use std::collections::HashMap;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::top_k::{
    SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_SCORE_SOURCE_VERSION,
    build_selector_audit, select_candidates_with_report, selector_target_size,
};
use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;
use telegram_pipeline_primitives::EXECUTOR_LATENCY_SELECTOR;
use telegram_selector_primitives::{
    SELECTOR_DETAIL_AUDIT_VERSION_FIELD, SELECTOR_DETAIL_AUTHOR_SOFT_CAP_FIELD,
    SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD, SELECTOR_DETAIL_DEFERRED_REASON_COUNTS_FIELD,
    SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD, SELECTOR_DETAIL_MAX_SIZE_FIELD,
    SELECTOR_DETAIL_OVERSAMPLE_FACTOR_FIELD, SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD,
    SELECTOR_DETAIL_RELAXED_PHASES_FIELD, SELECTOR_DETAIL_REQUIRED_PHASES_FIELD,
    SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD, SELECTOR_DETAIL_SELECTED_COUNT_FIELD,
    SELECTOR_DETAIL_SELECTED_EXPLORATION_COUNT_FIELD, SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD,
    SELECTOR_DETAIL_SELECTED_NEWS_COUNT_FIELD, SELECTOR_DETAIL_SELECTED_POOL_COUNTS_FIELD,
    SELECTOR_DETAIL_SELECTED_SOURCE_COUNTS_FIELD, SELECTOR_DETAIL_SELECTED_TREND_COUNT_FIELD,
    SELECTOR_DETAIL_TARGET_SIZE_FIELD, SELECTOR_PHASE_PLAN_VERSION, selector_count_map_json,
    selector_string_array_json,
};

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
        let oversample_target = selector_target_size(
            hydrated_query.limit,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
        );
        let selector_audit = build_selector_audit(&oversampled);
        let mut selector_detail = HashMap::from([
            (
                SELECTOR_DETAIL_OVERSAMPLE_FACTOR_FIELD.to_string(),
                serde_json::Value::from(self.config.selector_oversample_factor as u64),
            ),
            (
                SELECTOR_DETAIL_MAX_SIZE_FIELD.to_string(),
                serde_json::Value::from(self.config.selector_max_size as u64),
            ),
            (
                SELECTOR_DETAIL_TARGET_SIZE_FIELD.to_string(),
                serde_json::Value::from(oversample_target as u64),
            ),
            (
                SELECTOR_DETAIL_AUTHOR_SOFT_CAP_FIELD.to_string(),
                serde_json::Value::from(self.config.serving_author_soft_cap as u64),
            ),
            (
                SELECTOR_DETAIL_AUDIT_VERSION_FIELD.to_string(),
                serde_json::Value::String(SELECTOR_AUDIT_VERSION.to_string()),
            ),
            (
                SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD.to_string(),
                serde_json::Value::String(SELECTOR_CONSTRAINT_VERSION.to_string()),
            ),
            (
                SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD.to_string(),
                serde_json::Value::String(SELECTOR_SCORE_SOURCE_VERSION.to_string()),
            ),
            (
                SELECTOR_DETAIL_SELECTED_COUNT_FIELD.to_string(),
                serde_json::Value::from(selector_audit.selected_count as u64),
            ),
            (
                SELECTOR_DETAIL_SELECTED_TREND_COUNT_FIELD.to_string(),
                serde_json::Value::from(selector_audit.trend_count as u64),
            ),
            (
                SELECTOR_DETAIL_SELECTED_NEWS_COUNT_FIELD.to_string(),
                serde_json::Value::from(selector_audit.news_count as u64),
            ),
            (
                SELECTOR_DETAIL_SELECTED_EXPLORATION_COUNT_FIELD.to_string(),
                serde_json::Value::from(selector_audit.exploration_count as u64),
            ),
        ]);
        selector_detail.insert(
            SELECTOR_DETAIL_SELECTED_LANE_COUNTS_FIELD.to_string(),
            selector_count_map_json(selector_audit.lane_counts),
        );
        selector_detail.insert(
            SELECTOR_DETAIL_SELECTED_SOURCE_COUNTS_FIELD.to_string(),
            selector_count_map_json(selector_audit.source_counts),
        );
        selector_detail.insert(
            SELECTOR_DETAIL_SELECTED_POOL_COUNTS_FIELD.to_string(),
            selector_count_map_json(selector_audit.pool_counts),
        );
        if let Some(reason) = selector_output.report.first_blocking_reason {
            selector_detail.insert(
                SELECTOR_DETAIL_FIRST_BLOCKING_REASON_FIELD.to_string(),
                serde_json::Value::String(reason),
            );
        }
        selector_detail.insert(
            SELECTOR_DETAIL_DEFERRED_REASON_COUNTS_FIELD.to_string(),
            selector_count_map_json(selector_output.report.deferred_reason_counts),
        );
        selector_detail.insert(
            SELECTOR_DETAIL_PHASE_PLAN_VERSION_FIELD.to_string(),
            serde_json::Value::String(SELECTOR_PHASE_PLAN_VERSION.to_string()),
        );
        selector_detail.insert(
            SELECTOR_DETAIL_REQUIRED_PHASES_FIELD.to_string(),
            selector_string_array_json(&selector_output.report.required_phase_names),
        );
        selector_detail.insert(
            SELECTOR_DETAIL_RELAXED_PHASES_FIELD.to_string(),
            selector_string_array_json(&selector_output.report.relaxed_phase_names),
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
