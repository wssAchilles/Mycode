use std::collections::HashMap;

use serde_json::Value;
use telegram_pipeline_primitives::annotate_rust_owned_stage_detail;
use telegram_ranking_primitives::new_score_breakdown_map;

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
    let breakdown = candidate
        .score_breakdown
        .get_or_insert_with(new_score_breakdown_map);
    breakdown.insert(key.to_string(), value);
}

pub(in crate::pipeline::local::scorers) fn finite_score_product(
    score: f64,
    multiplier: f64,
) -> f64 {
    let adjusted = score * multiplier;
    if adjusted.is_finite() { adjusted } else { 0.0 }
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

#[cfg(test)]
mod tests {
    use super::finite_score_product;

    #[test]
    fn finite_score_product_preserves_normal_values_and_drops_overflow() {
        assert_eq!(finite_score_product(2.0, 0.5), 1.0);
        assert_eq!(finite_score_product(f64::MAX, 2.0), 0.0);
        assert_eq!(finite_score_product(f64::NAN, 1.0), 0.0);
        assert_eq!(finite_score_product(1.0, f64::INFINITY), 0.0);
    }
}
