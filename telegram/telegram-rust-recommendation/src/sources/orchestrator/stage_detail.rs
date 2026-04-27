use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::contracts::RecommendationStagePayload;

pub(super) fn record_stage(
    stages: &mut Vec<RecommendationStagePayload>,
    stage_timings: &mut HashMap<String, u64>,
    degraded_reasons: &mut Vec<String>,
    stage: &RecommendationStagePayload,
) {
    *stage_timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
    if let Some(error) = stage
        .detail
        .as_ref()
        .and_then(|detail| detail.get("error"))
        .and_then(|value| value.as_str())
    {
        degraded_reasons.push(format!("retrieval:{}:{error}", stage.name));
    }
    stages.push(stage.clone());
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
    if timed_out {
        detail.insert("timedOut".to_string(), Value::Bool(true));
    }
    if let Some(timeout_ms) = timeout_ms {
        detail.insert("timeoutMs".to_string(), Value::from(timeout_ms));
    }
    if let Some(error_class) = error_class {
        detail.insert("errorClass".to_string(), Value::String(error_class.clone()));
        detail
            .entry("error".to_string())
            .or_insert_with(|| Value::String(error_class));
    }

    stage
}

pub(super) fn dedup_reasons(items: &mut Vec<String>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.clone()));
}
