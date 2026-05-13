use telegram_serving_primitives::PAGE_BUILD_LATENCY_KEY;

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationQueryPayload, RecommendationResultPayload, RecommendationSelectorPayload,
    RecommendationSummaryPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::serving::cursor::{SERVED_STATE_VERSION, SERVING_VERSION};

use super::super::utils::dedup_strings;
use super::ranking_stage::RankingStageOutput;
use super::retrieval_stage::RetrievalStageOutput;
use super::serving_stage::ServingStageOutput;
use super::summary::build_online_eval;
use super::telemetry::RunTelemetry;
use super::trace::build_recommendation_trace;

mod serving_summary;
use serving_summary::{LiveServingSummaryInput, build_live_serving_summary};

pub(super) struct LiveRecommendationResultInput<'a> {
    pub(super) config: &'a RecommendationConfig,
    pub(super) definition: &'a RecommendationPipelineDefinition,
    pub(super) hydrated_query: &'a RecommendationQueryPayload,
    pub(super) retrieval: RetrievalStageOutput,
    pub(super) ranking: RankingStageOutput,
    pub(super) serving: ServingStageOutput,
    pub(super) telemetry: RunTelemetry,
    pub(super) page_build_duration_ms: u64,
}

pub(super) fn build_live_recommendation_result(
    input: LiveRecommendationResultInput<'_>,
) -> RecommendationResultPayload {
    let mut telemetry = input.telemetry;
    let RetrievalStageOutput {
        retrieved_count,
        retrieval_summary,
        ..
    } = input.retrieval;
    let RankingStageOutput {
        scored_candidates,
        ranking_summary,
    } = input.ranking;
    let ServingStageOutput {
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
    } = input.serving;

    if final_candidates.is_empty() {
        telemetry
            .degraded_reasons
            .push("empty_selection".to_string());
    } else if final_candidates.len() < input.hydrated_query.limit {
        telemetry
            .degraded_reasons
            .push("underfilled_selection".to_string());
    }
    dedup_strings(&mut telemetry.degraded_reasons);
    telemetry.stage_latency_ms.insert(
        PAGE_BUILD_LATENCY_KEY.to_string(),
        input.page_build_duration_ms,
    );

    let trace = build_recommendation_trace(
        input.hydrated_query,
        &final_candidates,
        &scored_candidates,
        &input.definition.pipeline_version,
        &input.definition.owner,
        &input.definition.fallback_mode,
        false,
    );

    let serving_summary = build_live_serving_summary(LiveServingSummaryInput {
        cursor: input.hydrated_query.cursor,
        next_cursor,
        has_more,
        stable_order_key: stable_order_key.clone(),
        duplicate_suppressed_count,
        cross_page_duplicate_count,
        suppression_reasons,
        page_remaining_count,
        page_underfilled,
        page_underfill_reason,
    });

    let summary = RecommendationSummaryPayload {
        request_id: input.hydrated_query.request_id.clone(),
        stage: input.config.stage.clone(),
        pipeline_version: input.definition.pipeline_version.clone(),
        owner: input.definition.owner.clone(),
        fallback_mode: input.definition.fallback_mode.clone(),
        provider_calls: telemetry.provider_calls,
        provider_latency_ms: telemetry.provider_latency_ms,
        retrieved_count,
        selected_count: final_candidates.len(),
        source_counts: retrieval_summary.source_counts.clone(),
        filter_drop_counts: telemetry.filter_drop_counts,
        stage_timings: telemetry.stage_timings,
        stage_latency_ms: telemetry.stage_latency_ms,
        degraded_reasons: telemetry.degraded_reasons,
        recent_hot_applied: input.config.recent_source_enabled
            && !input.hydrated_query.in_network_only,
        online_eval: build_online_eval(&final_candidates),
        selector: RecommendationSelectorPayload {
            oversample_factor: input.config.selector_oversample_factor,
            max_size: input.config.selector_max_size,
            final_limit: input.hydrated_query.limit,
            truncated,
        },
        serving: serving_summary,
        retrieval: retrieval_summary,
        ranking: ranking_summary,
        stages: telemetry.stages,
        trace: Some(trace),
    };

    RecommendationResultPayload {
        request_id: input.hydrated_query.request_id.clone(),
        serving_version: SERVING_VERSION.to_string(),
        cursor: input.hydrated_query.cursor,
        next_cursor: summary.serving.next_cursor,
        has_more: summary.serving.has_more,
        served_state_version: SERVED_STATE_VERSION.to_string(),
        stable_order_key,
        candidates: final_candidates,
        summary,
    }
}

#[cfg(test)]
mod tests;
