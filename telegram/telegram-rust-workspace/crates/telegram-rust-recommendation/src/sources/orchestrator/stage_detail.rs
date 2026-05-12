use std::collections::{HashMap, HashSet};

use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{
    SOURCE_LANE_MERGE_STAGE_NAME, SOURCE_STAGE_ERROR_FIELD, annotate_source_batch_stage_detail,
    annotate_source_stage_detail,
};

use crate::contracts::RecommendationStagePayload;

pub(super) fn record_stage(
    stages: &mut Vec<RecommendationStagePayload>,
    stage_timings: &mut HashMap<String, u64>,
    degraded_reasons: &mut Vec<String>,
    stage: &RecommendationStagePayload,
) {
    let mut stage = stage.clone();
    if stage.name != SOURCE_LANE_MERGE_STAGE_NAME {
        let detail = stage.detail.get_or_insert_with(HashMap::new);
        annotate_stage_contract_detail(detail, &stage.name, PIPELINE_STAGE_KIND_SOURCE);
        annotate_source_stage_detail(detail, &stage.name, stage.enabled, stage.output_count);
    }

    *stage_timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
    if let Some(error) = stage
        .detail
        .as_ref()
        .and_then(|detail| detail.get(SOURCE_STAGE_ERROR_FIELD))
        .and_then(|value| value.as_str())
    {
        degraded_reasons.push(format!("retrieval:{}:{error}", stage.name));
    }
    stages.push(stage);
}

pub(super) fn source_batch_stage(
    mut stage: RecommendationStagePayload,
    timed_out: bool,
    timeout_ms: Option<u64>,
    error_class: Option<String>,
) -> RecommendationStagePayload {
    if !timed_out && timeout_ms.is_none() && error_class.is_none() {
        return stage;
    }

    let detail = stage.detail.get_or_insert_with(HashMap::new);
    annotate_source_batch_stage_detail(detail, timed_out, timeout_ms, error_class.as_deref());

    stage
}

pub(super) fn dedup_reasons(items: &mut Vec<String>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.clone()));
}
