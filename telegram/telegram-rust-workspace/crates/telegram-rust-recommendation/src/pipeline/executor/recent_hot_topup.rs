use std::collections::{HashMap, HashSet};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationStagePayload,
};
use telegram_source_primitives::{RECENT_HOT_DETAIL_FIELD, RECENT_HOT_STORE_SOURCE};

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;

impl RecommendationPipeline {
    pub(super) async fn append_recent_hot_candidates(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        retrieved: &mut Vec<RecommendationCandidatePayload>,
        retrieval_summary: &mut RecommendationRetrievalSummaryPayload,
        telemetry: &mut RunTelemetry,
    ) {
        let recent_timer = StageTimer::start();
        let recent_candidates = {
            let store = self.recent_store.lock().await;
            let existing_ids: HashSet<String> = retrieved
                .iter()
                .map(|candidate| candidate.post_id.clone())
                .collect();
            store.recent_hot_candidates(hydrated_query, &existing_ids)
        };

        retrieval_summary
            .source_counts
            .insert(RECENT_HOT_STORE_SOURCE.to_string(), recent_candidates.len());
        retrieval_summary.stage_timings.insert(
            RECENT_HOT_STORE_SOURCE.to_string(),
            recent_timer.elapsed_ms(),
        );
        retrieval_summary.recent_hot_candidates += recent_candidates.len();
        retrieval_summary.total_candidates += recent_candidates.len();
        if !recent_candidates.is_empty() {
            telemetry.add_stage(RecommendationStagePayload {
                name: RECENT_HOT_STORE_SOURCE.to_string(),
                enabled: true,
                duration_ms: recent_timer.elapsed_ms(),
                input_count: 1,
                output_count: recent_candidates.len(),
                removed_count: None,
                detail: Some(HashMap::from([(
                    RECENT_HOT_DETAIL_FIELD.to_string(),
                    serde_json::Value::Bool(true),
                )])),
            });
            retrieved.extend(recent_candidates);
        }
    }
}
