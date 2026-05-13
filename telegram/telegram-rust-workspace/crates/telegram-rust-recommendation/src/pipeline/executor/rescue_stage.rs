use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::serving::stage_payload::build_self_post_rescue_stage;
use telegram_serving_primitives::{
    SELF_POST_RESCUE_APPLIED_DEGRADED_REASON, SELF_POST_RESCUE_FAILED_DEGRADED_REASON,
    SELF_POST_RESCUE_LATENCY_KEY, SELF_POST_RESCUE_PROVIDER_KEY,
};

use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;
use super::{RecommendationPipeline, SELF_POST_RESCUE_LOOKBACK_DAYS};

impl RecommendationPipeline {
    pub(super) async fn rescue_empty_selection(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        mut final_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        if !final_candidates.is_empty() || hydrated_query.in_network_only {
            return final_candidates;
        }

        let rescue_timer = StageTimer::start();
        match self
            .backend_client
            .self_post_rescue_candidates(
                &hydrated_query.user_id,
                hydrated_query.limit,
                SELF_POST_RESCUE_LOOKBACK_DAYS,
            )
            .await
        {
            Ok(response) => {
                telemetry.record_provider_call(SELF_POST_RESCUE_PROVIDER_KEY);
                telemetry
                    .record_provider_latency(SELF_POST_RESCUE_PROVIDER_KEY, response.latency_ms);
                let output_count = response.payload.candidates.len();
                telemetry.add_stage(build_self_post_rescue_stage(
                    rescue_timer.elapsed_ms(),
                    output_count,
                    None,
                    hydrated_query.limit,
                    SELF_POST_RESCUE_LOOKBACK_DAYS,
                ));
                telemetry.record_latency(SELF_POST_RESCUE_LATENCY_KEY, rescue_timer.elapsed_ms());
                if output_count > 0 {
                    final_candidates = response.payload.candidates;
                    telemetry
                        .degraded_reasons
                        .push(SELF_POST_RESCUE_APPLIED_DEGRADED_REASON.to_string());
                }
            }
            Err(error) => {
                telemetry.add_stage(build_self_post_rescue_stage(
                    rescue_timer.elapsed_ms(),
                    0,
                    Some(&error.to_string()),
                    hydrated_query.limit,
                    SELF_POST_RESCUE_LOOKBACK_DAYS,
                ));
                telemetry.record_latency(SELF_POST_RESCUE_LATENCY_KEY, rescue_timer.elapsed_ms());
                telemetry
                    .degraded_reasons
                    .push(SELF_POST_RESCUE_FAILED_DEGRADED_REASON.to_string());
            }
        }
        final_candidates
    }
}
