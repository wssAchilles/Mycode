use std::collections::HashMap;

use serde_json::Value;

use crate::contracts::RecommendationStagePayload;
use telegram_filter_primitives::FILTER_DROP_REASON_COUNTS_FIELD;
use telegram_pipeline_primitives::{
    PIPELINE_LOCAL_FILTER_EXECUTION_MODE, PIPELINE_STAGE_KIND_FILTER,
    annotate_rust_owned_stage_detail, annotate_stage_contract_detail,
};

use super::super::filter_decision::{annotate_filter_stage_detail, drop_reason_counts};

pub(super) fn build_disabled_stage(name: &str, input_count: usize) -> RecommendationStagePayload {
    let mut detail = HashMap::new();
    annotate_stage_contract_detail(&mut detail, name, PIPELINE_STAGE_KIND_FILTER);
    annotate_rust_owned_stage_detail(&mut detail, PIPELINE_LOCAL_FILTER_EXECUTION_MODE);
    annotate_filter_stage_detail(&mut detail, 0);

    RecommendationStagePayload {
        name: name.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: Some(0),
        detail: Some(detail),
    }
}

pub(super) fn build_stage(
    name: &str,
    input_count: usize,
    removed_count: usize,
    detail: Option<HashMap<String, Value>>,
    drop_reason: Option<&str>,
) -> RecommendationStagePayload {
    let mut detail = detail.unwrap_or_default();
    annotate_stage_contract_detail(&mut detail, name, PIPELINE_STAGE_KIND_FILTER);
    annotate_rust_owned_stage_detail(&mut detail, PIPELINE_LOCAL_FILTER_EXECUTION_MODE);
    if let Some(drop_reason) = drop_reason {
        detail
            .entry(FILTER_DROP_REASON_COUNTS_FIELD.to_string())
            .or_insert_with(|| drop_reason_counts(&[(drop_reason, removed_count)]));
    }
    annotate_filter_stage_detail(&mut detail, removed_count);

    RecommendationStagePayload {
        name: name.to_string(),
        enabled: true,
        duration_ms: 0,
        input_count,
        output_count: input_count.saturating_sub(removed_count),
        removed_count: Some(removed_count),
        detail: Some(detail),
    }
}
