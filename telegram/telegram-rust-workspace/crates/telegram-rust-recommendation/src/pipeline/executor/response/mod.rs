use std::collections::HashMap;

use serde_json::Value;
use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;
use telegram_serving_primitives::PAGE_BUILD_LATENCY_KEY;

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationGraphRetrievalPayload, RecommendationQueryPayload,
    RecommendationRankingSummaryPayload, RecommendationResultPayload,
    RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
    RecommendationSummaryPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::serving::cursor::{
    CURSOR_MODE, RANKED_CURSOR_ABSTENTION_MODE, SERVED_STATE_VERSION, SERVING_VERSION,
};
use crate::serving::stable_order::build_stable_order_key;

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
    let ranked_cursor_abstained = !input.hydrated_query.in_network_only;
    if ranked_cursor_abstained && has_more {
        telemetry
            .degraded_reasons
            .push("ranked_cursor_abstention".to_string());
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

    let cursor_mode = if ranked_cursor_abstained {
        RANKED_CURSOR_ABSTENTION_MODE
    } else {
        CURSOR_MODE
    };
    let public_next_cursor = if ranked_cursor_abstained {
        None
    } else {
        next_cursor
    };
    let public_has_more = has_more && !ranked_cursor_abstained;
    let serving_summary = build_live_serving_summary(LiveServingSummaryInput {
        cursor_mode,
        cursor: input.hydrated_query.cursor,
        next_cursor: public_next_cursor,
        has_more: public_has_more,
        stable_order_key: stable_order_key.clone(),
        duplicate_suppressed_count,
        cross_page_duplicate_count,
        suppression_reasons,
        page_remaining_count,
        page_underfilled,
        page_underfill_reason,
    });
    let selector_report_contract = selector_report_contract(&telemetry.stages);

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
            selector_report: selector_report_contract.report,
            selector_report_unavailable_reason: selector_report_contract.unavailable_reason,
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
        has_more: public_has_more,
        served_state_version: SERVED_STATE_VERSION.to_string(),
        stable_order_key,
        candidates: final_candidates,
        summary,
    }
}

pub(super) const SAFETY_CONTEXT_ABSTENTION_MODE: &str = "safety_context_abstention_v1";
pub(super) const SAFETY_CONTEXT_UNAVAILABLE_REASON: &str = "safety_context_unavailable";

struct TerminalAbstentionInput<'a> {
    config: &'a RecommendationConfig,
    definition: &'a RecommendationPipelineDefinition,
    query: &'a RecommendationQueryPayload,
    telemetry: RunTelemetry,
    reason: &'static str,
    cursor_mode: &'static str,
    page_build_duration_ms: u64,
}

pub(super) fn build_ranked_cursor_abstention_result(
    config: &RecommendationConfig,
    definition: &RecommendationPipelineDefinition,
    query: &RecommendationQueryPayload,
    page_build_duration_ms: u64,
) -> RecommendationResultPayload {
    build_terminal_abstention_result(TerminalAbstentionInput {
        config,
        definition,
        query,
        telemetry: RunTelemetry::default(),
        reason: "ranked_cursor_abstention",
        cursor_mode: RANKED_CURSOR_ABSTENTION_MODE,
        page_build_duration_ms,
    })
}

pub(super) fn build_safety_context_abstention_result(
    config: &RecommendationConfig,
    definition: &RecommendationPipelineDefinition,
    query: &RecommendationQueryPayload,
    telemetry: RunTelemetry,
    page_build_duration_ms: u64,
) -> RecommendationResultPayload {
    build_terminal_abstention_result(TerminalAbstentionInput {
        config,
        definition,
        query,
        telemetry,
        reason: SAFETY_CONTEXT_UNAVAILABLE_REASON,
        cursor_mode: SAFETY_CONTEXT_ABSTENTION_MODE,
        page_build_duration_ms,
    })
}

fn build_terminal_abstention_result(
    input: TerminalAbstentionInput<'_>,
) -> RecommendationResultPayload {
    let mut telemetry = input.telemetry;
    telemetry.degraded_reasons.push(input.reason.to_string());
    dedup_strings(&mut telemetry.degraded_reasons);
    telemetry.stage_latency_ms.insert(
        PAGE_BUILD_LATENCY_KEY.to_string(),
        input.page_build_duration_ms,
    );

    let stable_order_key = build_stable_order_key(&[], input.query.in_network_only);
    let serving = build_live_serving_summary(LiveServingSummaryInput {
        cursor_mode: input.cursor_mode,
        cursor: input.query.cursor,
        next_cursor: None,
        has_more: false,
        stable_order_key: stable_order_key.clone(),
        duplicate_suppressed_count: 0,
        cross_page_duplicate_count: 0,
        suppression_reasons: HashMap::new(),
        page_remaining_count: 0,
        page_underfilled: true,
        page_underfill_reason: Some(input.reason.to_string()),
    });
    let trace = build_recommendation_trace(
        input.query,
        &[],
        &[],
        &input.definition.pipeline_version,
        &input.definition.owner,
        &input.definition.fallback_mode,
        false,
    );
    let summary = RecommendationSummaryPayload {
        request_id: input.query.request_id.clone(),
        stage: input.config.stage.clone(),
        pipeline_version: input.definition.pipeline_version.clone(),
        owner: input.definition.owner.clone(),
        fallback_mode: input.definition.fallback_mode.clone(),
        provider_calls: telemetry.provider_calls,
        provider_latency_ms: telemetry.provider_latency_ms,
        retrieved_count: 0,
        selected_count: 0,
        source_counts: HashMap::new(),
        filter_drop_counts: telemetry.filter_drop_counts,
        stage_timings: telemetry.stage_timings,
        stage_latency_ms: telemetry.stage_latency_ms,
        degraded_reasons: telemetry.degraded_reasons,
        recent_hot_applied: false,
        online_eval: build_online_eval(&[]),
        selector: RecommendationSelectorPayload {
            oversample_factor: input.config.selector_oversample_factor,
            max_size: input.config.selector_max_size,
            final_limit: input.query.limit,
            truncated: false,
            selector_report: None,
            selector_report_unavailable_reason: Some(input.reason.to_string()),
        },
        serving,
        retrieval: RecommendationRetrievalSummaryPayload {
            stage: input.reason.to_string(),
            total_candidates: 0,
            in_network_candidates: 0,
            out_of_network_candidates: 0,
            ml_retrieved_candidates: 0,
            recent_hot_candidates: 0,
            source_counts: HashMap::new(),
            source_outcome_counts: HashMap::new(),
            source_failure_counts: HashMap::new(),
            source_disabled_counts: HashMap::new(),
            lane_counts: HashMap::new(),
            ml_source_counts: HashMap::new(),
            stage_timings: HashMap::new(),
            degraded_reasons: Vec::new(),
            graph: RecommendationGraphRetrievalPayload::default(),
        },
        ranking: RecommendationRankingSummaryPayload {
            stage: input.reason.to_string(),
            input_candidates: 0,
            hydrated_candidates: 0,
            filtered_candidates: 0,
            scored_candidates: 0,
            ml_eligible_candidates: 0,
            ml_ranked_candidates: 0,
            weighted_candidates: 0,
            stage_timings: HashMap::new(),
            filter_drop_counts: HashMap::new(),
            degraded_reasons: Vec::new(),
        },
        stages: telemetry.stages,
        trace: Some(trace),
    };

    RecommendationResultPayload {
        request_id: input.query.request_id.clone(),
        serving_version: SERVING_VERSION.to_string(),
        cursor: input.query.cursor,
        next_cursor: None,
        has_more: false,
        served_state_version: SERVED_STATE_VERSION.to_string(),
        stable_order_key,
        candidates: Vec::new(),
        summary,
    }
}

struct SelectorReportContract {
    report: Option<HashMap<String, Value>>,
    unavailable_reason: Option<String>,
}

fn selector_report_contract(
    stages: &[crate::contracts::RecommendationStagePayload],
) -> SelectorReportContract {
    let Some(selector_stage) = stages
        .iter()
        .find(|stage| stage.name == RUST_TOP_K_SELECTOR && stage.enabled)
    else {
        return SelectorReportContract {
            report: None,
            unavailable_reason: Some("selector_stage_missing".to_string()),
        };
    };

    let Some(detail) = selector_stage.detail.as_ref() else {
        return SelectorReportContract {
            report: None,
            unavailable_reason: Some("selector_stage_detail_missing".to_string()),
        };
    };

    SelectorReportContract {
        report: Some(detail.clone()),
        unavailable_reason: None,
    }
}

#[cfg(test)]
mod tests;
