use std::collections::{HashMap, HashSet};

use crate::contracts::RecommendationStagePayload;

pub fn merge_drop_counts(target: &mut HashMap<String, usize>, incoming: HashMap<String, usize>) {
    for (name, count) in incoming {
        *target.entry(name).or_insert(0) += count;
    }
}

pub fn merge_provider_calls(
    target: &mut HashMap<String, usize>,
    incoming: &HashMap<String, usize>,
) {
    for (name, count) in incoming {
        *target.entry(name.clone()).or_insert(0) += count;
    }
}

pub fn record_provider_call(target: &mut HashMap<String, usize>, name: impl Into<String>) {
    *target.entry(name.into()).or_insert(0) += 1;
}

pub fn append_stages(
    target: &mut Vec<RecommendationStagePayload>,
    timings: &mut HashMap<String, u64>,
    degraded_reasons: &mut Vec<String>,
    incoming: Vec<RecommendationStagePayload>,
) {
    for stage in incoming {
        accumulate_degraded_reasons(&stage, degraded_reasons);
        accumulate_stage(target, timings, stage);
    }
}

pub fn accumulate_stage(
    target: &mut Vec<RecommendationStagePayload>,
    timings: &mut HashMap<String, u64>,
    stage: RecommendationStagePayload,
) {
    *timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
    target.push(stage);
}

pub fn dedup_strings(items: &mut Vec<String>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.clone()));
}

fn accumulate_degraded_reasons(
    stage: &RecommendationStagePayload,
    degraded_reasons: &mut Vec<String>,
) {
    if let Some(detail) = stage.detail.as_ref() {
        if let Some(error) = detail.get("error").and_then(|value| value.as_str()) {
            degraded_reasons.push(format!("{}:{error}", stage.name));
        }
    }
}
