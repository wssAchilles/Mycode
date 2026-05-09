use std::collections::HashMap;

use crate::contracts::RecommendationStagePayload;

use super::super::utils::{
    accumulate_stage, append_stages, merge_drop_counts, merge_provider_calls,
    merge_provider_latency, record_provider_call, record_provider_latency,
};

#[derive(Default)]
pub(super) struct RunTelemetry {
    pub(super) stage_timings: HashMap<String, u64>,
    pub(super) stage_latency_ms: HashMap<String, u64>,
    pub(super) stages: Vec<RecommendationStagePayload>,
    pub(super) filter_drop_counts: HashMap<String, usize>,
    pub(super) degraded_reasons: Vec<String>,
    pub(super) provider_calls: HashMap<String, usize>,
    pub(super) provider_latency_ms: HashMap<String, u64>,
}

impl RunTelemetry {
    pub(super) fn add_stage(&mut self, stage: RecommendationStagePayload) {
        accumulate_stage(&mut self.stages, &mut self.stage_timings, stage);
    }

    pub(super) fn append_stages(&mut self, stages: Vec<RecommendationStagePayload>) {
        append_stages(
            &mut self.stages,
            &mut self.stage_timings,
            &mut self.degraded_reasons,
            stages,
        );
    }

    pub(super) fn record_latency(&mut self, stage_name: &str, duration_ms: u64) {
        self.stage_latency_ms
            .insert(stage_name.to_string(), duration_ms);
    }

    pub(super) fn merge_provider_calls(&mut self, calls: &HashMap<String, usize>) {
        merge_provider_calls(&mut self.provider_calls, calls);
    }

    pub(super) fn merge_provider_latency(&mut self, latency: &HashMap<String, u64>) {
        merge_provider_latency(&mut self.provider_latency_ms, latency);
    }

    pub(super) fn record_provider_call(&mut self, provider_key: impl AsRef<str>) {
        record_provider_call(&mut self.provider_calls, provider_key.as_ref());
    }

    pub(super) fn record_provider_latency(
        &mut self,
        provider_key: impl Into<String>,
        duration_ms: u64,
    ) {
        record_provider_latency(&mut self.provider_latency_ms, provider_key, duration_ms);
    }

    pub(super) fn merge_drop_counts(&mut self, counts: HashMap<String, usize>) {
        merge_drop_counts(&mut self.filter_drop_counts, counts);
    }
}
