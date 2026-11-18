use std::collections::HashMap;

use anyhow::Result;
use telegram_component_primitives::candidate_hydrators::partition_candidate_hydrators;
use telegram_pipeline_primitives::{
    EXECUTOR_LATENCY_FILTER, EXECUTOR_LATENCY_HYDRATE, EXECUTOR_LATENCY_SCORE,
    PIPELINE_STAGE_KIND_HYDRATOR, PROVIDER_KEY_HYDRATE, PROVIDER_KEY_SCORE,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationRankingSummaryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::filters::run_pre_score_filters;
use crate::pipeline::local::hydrators::run_selected_local_candidate_hydrators;
use crate::pipeline::local::scorers::run_local_scorers;
use crate::scorers::MODEL_PROVIDER_SCORER_NAMES;

use super::RecommendationPipeline;
use super::component_activation::active_component_names;
use super::stage_runner::StageTimer;
use super::summary::{RankingSummaryInput, build_ranking_summary};
use super::telemetry::RunTelemetry;

pub(super) struct RankingStageOutput {
    pub(super) scored_candidates: Vec<RecommendationCandidatePayload>,
    pub(super) ranking_summary: RecommendationRankingSummaryPayload,
}

impl RecommendationPipeline {
    pub(super) async fn execute_ranking_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        retrieved: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<RankingStageOutput> {
        let non_deleted_retrieved = retrieved
            .iter()
            .filter(|candidate| !self.thunder_store.is_deleted(&candidate.post_id))
            .cloned()
            .collect::<Vec<_>>();
        let (hydrated_candidates, hydrate_stages) = self
            .execute_candidate_hydration_stage(
                hydrated_query,
                &non_deleted_retrieved,
                circuit_open_hydrators,
                telemetry,
            )
            .await?;
        let (filtered_candidates, filter_stages, ranking_drop_counts) = self
            .execute_pre_score_filter_stage(hydrated_query, hydrated_candidates.clone(), telemetry);
        let (scored_candidates, score_stages) = self
            .execute_score_stage(hydrated_query, &filtered_candidates, telemetry)
            .await?;
        let ranking_summary = build_ranking_summary(RankingSummaryInput {
            input_candidates: retrieved.len(),
            hydrated_candidates: &hydrated_candidates,
            filtered_candidates: &filtered_candidates,
            scored_candidates: &scored_candidates,
            filter_drop_counts: &ranking_drop_counts,
            hydrate_stages: &hydrate_stages,
            filter_stages: &filter_stages,
            score_stages: &score_stages,
        });
        telemetry
            .degraded_reasons
            .extend(ranking_summary.degraded_reasons.iter().cloned());

        Ok(RankingStageOutput {
            scored_candidates,
            ranking_summary,
        })
    }

    async fn execute_candidate_hydration_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        retrieved: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<(
        Vec<RecommendationCandidatePayload>,
        Vec<RecommendationStagePayload>,
    )> {
        let hydrate_timer = StageTimer::start();
        let (candidate_hydrator_components, mut skipped_candidate_hydrator_stages) =
            active_component_names(
                &self.definition.candidate_hydrators,
                circuit_open_hydrators,
                PIPELINE_STAGE_KIND_HYDRATOR,
                retrieved.len(),
            );
        telemetry.append_stages(std::mem::take(&mut skipped_candidate_hydrator_stages));

        // 将候选水合器拆分为远端 Node 集合与纯 Rust 本地集合，仅向 Node 请求已注册的远端组件
        let (remote_components, local_components) = match candidate_hydrator_components {
            Some(components) => {
                let (remote, local) = partition_candidate_hydrators(&components);
                (Some(remote), Some(local))
            }
            None => (None, None),
        };

        let mut hydrate_stages = Vec::new();
        let mut current_candidates = match remote_components {
            Some(remote) if remote.is_empty() => retrieved.to_vec(),
            other => {
                let mut hydrate_response = self
                    .backend_client
                    .hydrate_candidates_with_components(hydrated_query, retrieved, other)
                    .await?;
                telemetry.record_provider_call(PROVIDER_KEY_HYDRATE);
                telemetry
                    .record_provider_latency(PROVIDER_KEY_HYDRATE, hydrate_response.latency_ms);
                telemetry.merge_provider_calls(&hydrate_response.payload.provider_calls);
                hydrate_stages.extend(hydrate_response.payload.stages.iter().cloned());
                telemetry.append_stages(std::mem::take(&mut hydrate_response.payload.stages));
                hydrate_response.payload.candidates
            }
        };

        let should_run_local = local_components
            .as_ref()
            .is_none_or(|local| !local.is_empty());
        if should_run_local {
            let local_execution = run_selected_local_candidate_hydrators(
                hydrated_query,
                current_candidates,
                local_components.as_deref(),
            );
            current_candidates = local_execution.candidates;
            telemetry.append_stages(local_execution.stages.clone());
            hydrate_stages.extend(local_execution.stages);
        }

        telemetry.record_latency(EXECUTOR_LATENCY_HYDRATE, hydrate_timer.elapsed_ms());
        Ok((current_candidates, hydrate_stages))
    }

    fn execute_pre_score_filter_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        hydrated_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> (
        Vec<RecommendationCandidatePayload>,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
    ) {
        let filter_timer = StageTimer::start();
        let filter_execution = run_pre_score_filters(hydrated_query, hydrated_candidates);
        let filter_stages = filter_execution.stages;
        let filtered_candidates = filter_execution.candidates;
        let ranking_drop_counts = filter_execution.drop_counts;
        telemetry.merge_drop_counts(&ranking_drop_counts);
        telemetry.append_stages(filter_stages.clone());
        telemetry.record_latency(EXECUTOR_LATENCY_FILTER, filter_timer.elapsed_ms());
        (filtered_candidates, filter_stages, ranking_drop_counts)
    }

    async fn execute_score_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        filtered_candidates: &[RecommendationCandidatePayload],
        telemetry: &mut RunTelemetry,
    ) -> Result<(
        Vec<RecommendationCandidatePayload>,
        Vec<RecommendationStagePayload>,
    )> {
        let score_timer = StageTimer::start();
        let mut score_response = self
            .backend_client
            .score_candidates_with_components(
                hydrated_query,
                filtered_candidates,
                Some(
                    MODEL_PROVIDER_SCORER_NAMES
                        .iter()
                        .map(|name| (*name).to_string())
                        .collect(),
                ),
            )
            .await?;
        telemetry.record_provider_call(PROVIDER_KEY_SCORE);
        telemetry.record_provider_latency(PROVIDER_KEY_SCORE, score_response.latency_ms);
        telemetry.merge_provider_calls(&score_response.payload.provider_calls);
        let mut score_stages = score_response.payload.stages.clone();
        let provider_scored_candidates = score_response.payload.candidates;
        telemetry.append_stages(std::mem::take(&mut score_response.payload.stages));
        let local_scoring = run_local_scorers(hydrated_query, provider_scored_candidates);
        let scored_candidates = local_scoring.candidates;
        telemetry.append_stages(local_scoring.stages.clone());
        score_stages.extend(local_scoring.stages);
        telemetry.record_latency(EXECUTOR_LATENCY_SCORE, score_timer.elapsed_ms());
        Ok((scored_candidates, score_stages))
    }
}
