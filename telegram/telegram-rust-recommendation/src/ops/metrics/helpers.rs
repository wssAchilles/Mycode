use std::collections::HashMap;

use crate::candidate_pipeline::definition::PROVIDER_LATENCY_BUDGET_MS;
use crate::contracts::{
    RecommendationGuardrailStatus, RecommendationSourceHealthEntry, RecommendationStagePayload,
};

use super::component_health::{is_source_stage, stage_timed_out};

pub(super) fn percentile(values: &[u64], percentile: usize) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let percentile = percentile.clamp(0, 100);
    let index = ((sorted.len() - 1) * percentile) / 100;
    sorted[index]
}

pub(super) fn rescue_hit_rate(attempts: u64, hits: u64) -> Option<f64> {
    (attempts > 0).then_some(hits as f64 / attempts as f64)
}

pub(super) fn ratio(numerator: u64, denominator: u64) -> Option<f64> {
    (denominator > 0).then_some(numerator as f64 / denominator as f64)
}

pub(super) fn accumulate_count_map(
    target: &mut HashMap<String, u64>,
    source: &HashMap<String, usize>,
) {
    for (key, count) in source {
        *target.entry(key.clone()).or_insert(0) += *count as u64;
    }
}

pub(super) fn slowest_provider(
    provider_latency_ms: &HashMap<String, u64>,
) -> Option<(String, u64)> {
    provider_latency_ms
        .iter()
        .max_by(|left, right| left.1.cmp(right.1).then_with(|| right.0.cmp(left.0)))
        .map(|(provider, latency_ms)| (provider.clone(), *latency_ms))
}

pub(super) fn timed_out_source_names(
    stages: &[crate::contracts::RecommendationStagePayload],
) -> Vec<String> {
    let mut sources = stages
        .iter()
        .filter(|stage| stage_timed_out(stage))
        .map(|stage| stage.name.clone())
        .collect::<Vec<_>>();
    sources.sort();
    sources.dedup();
    sources
}

pub(super) fn extract_source_health(
    stages: &[RecommendationStagePayload],
) -> Vec<RecommendationSourceHealthEntry> {
    stages
        .iter()
        .filter(|stage| is_source_stage(stage))
        .map(|stage| {
            let detail = stage.detail.as_ref();
            RecommendationSourceHealthEntry {
                source: stage.name.clone(),
                enabled: stage.enabled,
                output_count: stage.output_count,
                duration_ms: stage.duration_ms,
                timed_out: stage_timed_out(stage),
                degraded: detail
                    .and_then(|detail| detail.get("error"))
                    .and_then(serde_json::Value::as_str)
                    .is_some()
                    || stage_timed_out(stage),
                error_class: detail
                    .and_then(|detail| detail.get("errorClass"))
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned),
                disabled_reason: detail
                    .and_then(|detail| detail.get("disabledByPolicy"))
                    .or_else(|| detail.and_then(|detail| detail.get("disabledByConfig")))
                    .or_else(|| detail.and_then(|detail| detail.get("disabled")))
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned),
                source_budget: detail
                    .and_then(|detail| detail.get("sourceBudget"))
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as usize),
                pre_policy_count: detail
                    .and_then(|detail| detail.get("prePolicyCount"))
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as usize),
            }
        })
        .collect()
}

pub(super) fn build_guardrails(
    degraded_reasons: &[String],
    provider_latency_ms: &HashMap<String, u64>,
    source_health: &[RecommendationSourceHealthEntry],
    page_underfilled: bool,
) -> RecommendationGuardrailStatus {
    let empty_retrieval = degraded_reasons
        .iter()
        .any(|reason| reason == "empty_retrieval");
    let empty_selection = degraded_reasons
        .iter()
        .any(|reason| reason == "empty_selection");
    let underfilled_selection = page_underfilled
        || degraded_reasons
            .iter()
            .any(|reason| reason == "underfilled_selection");
    let ml_ranking_empty = degraded_reasons
        .iter()
        .any(|reason| reason == "ranking:PhoenixScorer:empty_ml_ranking");
    let provider_budget_exceeded = provider_latency_ms
        .values()
        .any(|latency_ms| *latency_ms > PROVIDER_LATENCY_BUDGET_MS);
    let source_timeout_count = source_health.iter().filter(|entry| entry.timed_out).count();
    let source_error_count = source_health.iter().filter(|entry| entry.degraded).count();
    let status = if empty_selection || provider_budget_exceeded || source_timeout_count > 0 {
        "tripped"
    } else if empty_retrieval
        || underfilled_selection
        || ml_ranking_empty
        || !degraded_reasons.is_empty()
    {
        "degraded"
    } else {
        "ok"
    };

    RecommendationGuardrailStatus {
        status: status.to_string(),
        empty_retrieval,
        empty_selection,
        underfilled_selection,
        ml_ranking_empty,
        provider_budget_exceeded,
        source_timeout_count,
        source_error_count,
        degraded_reason_count: degraded_reasons.len(),
    }
}
