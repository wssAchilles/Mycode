use std::collections::HashMap;

use serde_json::Value;
use telegram_pipeline_primitives::annotate_rust_owned_stage_detail;

use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};

use super::super::LOCAL_EXECUTION_MODE;

pub(in crate::pipeline::local::scorers) fn merge_breakdown(
    candidate: &mut RecommendationCandidatePayload,
    key: &str,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }
    let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
    breakdown.insert(key.to_string(), value);
}

pub(in crate::pipeline::local::scorers) fn build_stage(
    name: &str,
    input_count: usize,
    enabled: bool,
    detail: Option<HashMap<String, Value>>,
) -> RecommendationStagePayload {
    let mut detail = detail.unwrap_or_default();
    annotate_rust_owned_stage_detail(&mut detail, LOCAL_EXECUTION_MODE);

    RecommendationStagePayload {
        name: name.to_string(),
        enabled,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: Some(0),
        detail: Some(detail),
    }
}
