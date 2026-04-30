use std::collections::{HashMap, HashSet};
use std::time::Instant;

use anyhow::Result;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationRankingSummaryPayload, RecommendationRetrievalSummaryPayload,
    RecommendationStagePayload,
};
use crate::pipeline::local::filters::{run_post_selection_filters, run_pre_score_filters};
use crate::pipeline::local::scorers::run_local_scorers;
use crate::serving::cursor::build_next_cursor;
use crate::serving::dedup::dedup_for_serving;
use crate::serving::stable_order::{build_stable_order_key, sort_candidates_stably};
use crate::top_k::{build_selector_audit, select_candidates_with_report, selector_target_size};

use super::super::utils::{
    accumulate_stage, append_stages, merge_drop_counts, merge_provider_calls,
    merge_provider_latency, record_provider_call, record_provider_latency,
};
use super::stages::{
    active_component_names, build_self_post_rescue_stage, build_serving_stage, count_map_json,
};
use super::summary::build_ranking_summary;
use super::{ML_BASE_SCORER_COMPONENTS, RecommendationPipeline, SELF_POST_RESCUE_LOOKBACK_DAYS};

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

    fn append_stages(&mut self, stages: Vec<RecommendationStagePayload>) {
        append_stages(
            &mut self.stages,
            &mut self.stage_timings,
            &mut self.degraded_reasons,
            stages,
        );
    }

    fn record_latency(&mut self, stage_name: &str, duration_ms: u64) {
        self.stage_latency_ms
            .insert(stage_name.to_string(), duration_ms);
    }

    fn merge_provider_calls(&mut self, calls: &HashMap<String, usize>) {
        merge_provider_calls(&mut self.provider_calls, calls);
    }

    fn merge_provider_latency(&mut self, latency: &HashMap<String, u64>) {
        merge_provider_latency(&mut self.provider_latency_ms, latency);
    }

    fn record_provider_call(&mut self, provider_key: impl AsRef<str>) {
        record_provider_call(&mut self.provider_calls, provider_key.as_ref());
    }

    fn record_provider_latency(&mut self, provider_key: impl Into<String>, duration_ms: u64) {
        record_provider_latency(&mut self.provider_latency_ms, provider_key, duration_ms);
    }

    fn merge_drop_counts(&mut self, counts: HashMap<String, usize>) {
        merge_drop_counts(&mut self.filter_drop_counts, counts);
    }
}

pub(super) struct QueryStageOutput {
    pub(super) hydrated_query: RecommendationQueryPayload,
    pub(super) circuit_open_sources: Vec<String>,
    pub(super) circuit_open_hydrators: Vec<String>,
}

pub(super) struct RetrievalStageOutput {
    pub(super) retrieved: Vec<RecommendationCandidatePayload>,
    pub(super) retrieved_count: usize,
    pub(super) retrieval_summary: RecommendationRetrievalSummaryPayload,
}

pub(super) struct RankingStageOutput {
    pub(super) scored_candidates: Vec<RecommendationCandidatePayload>,
    pub(super) ranking_summary: RecommendationRankingSummaryPayload,
}

pub(super) struct ServingStageOutput {
    pub(super) final_candidates: Vec<RecommendationCandidatePayload>,
    pub(super) duplicate_suppressed_count: usize,
    pub(super) cross_page_duplicate_count: usize,
    pub(super) has_more: bool,
    pub(super) page_remaining_count: usize,
    pub(super) page_underfilled: bool,
    pub(super) page_underfill_reason: Option<String>,
    pub(super) suppression_reasons: HashMap<String, usize>,
    pub(super) truncated: bool,
    pub(super) next_cursor: Option<chrono::DateTime<chrono::Utc>>,
    pub(super) stable_order_key: String,
}

impl RecommendationPipeline {
    pub(super) async fn execute_query_stage(
        &self,
        query: &RecommendationQueryPayload,
        telemetry: &mut RunTelemetry,
    ) -> QueryStageOutput {
        let query_start = Instant::now();
        let (
            hydrated_query,
            mut query_stages,
            query_provider_calls,
            query_provider_latency_ms,
            query_degraded_reasons,
        ) = self.hydrate_query_parallel_bounded(query).await;
        telemetry.record_latency("queryHydrators", query_start.elapsed().as_millis() as u64);
        telemetry.merge_provider_calls(&query_provider_calls);
        telemetry.merge_provider_latency(&query_provider_latency_ms);
        telemetry.append_stages(std::mem::take(&mut query_stages));
        telemetry.degraded_reasons.extend(query_degraded_reasons);
        let (circuit_open_sources, circuit_open_hydrators) = {
            let metrics = self.metrics.lock().await;
            (
                metrics.circuit_open_sources(),
                metrics.circuit_open_hydrators(),
            )
        };

        QueryStageOutput {
            hydrated_query,
            circuit_open_sources,
            circuit_open_hydrators,
        }
    }

    pub(super) async fn execute_retrieval_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        circuit_open_sources: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<RetrievalStageOutput> {
        let retrieval_start = Instant::now();
        let mut retrieval_response = if self.config.retrieval_mode == "source_orchestrated_graph_v2"
        {
            self.source_orchestrator
                .retrieve_candidates(hydrated_query, circuit_open_sources)
                .await?
        } else {
            let response = self
                .backend_client
                .retrieve_candidates(hydrated_query)
                .await?;
            telemetry.record_provider_call("retrieval");
            telemetry.record_provider_latency("retrieval", response.latency_ms);
            response.payload
        };
        let mut retrieved = retrieval_response.candidates;
        let mut retrieval_summary = retrieval_response.summary;
        telemetry.merge_provider_calls(&retrieval_response.provider_calls);
        telemetry.merge_provider_latency(&retrieval_response.provider_latency_ms);
        telemetry.append_stages(std::mem::take(&mut retrieval_response.stages));
        telemetry
            .degraded_reasons
            .extend(retrieval_summary.degraded_reasons.iter().cloned());

        if self.config.recent_source_enabled && !hydrated_query.in_network_only {
            self.append_recent_hot_candidates(
                hydrated_query,
                &mut retrieved,
                &mut retrieval_summary,
                telemetry,
            )
            .await;
        }
        telemetry.record_latency("sources", retrieval_start.elapsed().as_millis() as u64);

        let retrieved_count = retrieved.len();
        if retrieved_count == 0 {
            telemetry
                .degraded_reasons
                .push("empty_retrieval".to_string());
        }
        retrieval_summary.total_candidates = retrieved_count;

        Ok(RetrievalStageOutput {
            retrieved,
            retrieved_count,
            retrieval_summary,
        })
    }

    pub(super) async fn execute_ranking_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        retrieved: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<RankingStageOutput> {
        let (hydrated_candidates, hydrate_stages) = self
            .execute_candidate_hydration_stage(
                hydrated_query,
                retrieved,
                circuit_open_hydrators,
                telemetry,
            )
            .await?;
        let (filtered_candidates, filter_stages, ranking_drop_counts) = self
            .execute_pre_score_filter_stage(hydrated_query, hydrated_candidates.clone(), telemetry);
        let (scored_candidates, score_stages) = self
            .execute_score_stage(hydrated_query, &filtered_candidates, telemetry)
            .await?;
        let ranking_summary = build_ranking_summary(
            retrieved.len(),
            &hydrated_candidates,
            &filtered_candidates,
            &scored_candidates,
            &ranking_drop_counts,
            &hydrate_stages,
            &filter_stages,
            &score_stages,
        );
        telemetry
            .degraded_reasons
            .extend(ranking_summary.degraded_reasons.iter().cloned());

        Ok(RankingStageOutput {
            scored_candidates,
            ranking_summary,
        })
    }

    pub(super) fn execute_selector_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        scored_candidates: &[RecommendationCandidatePayload],
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        let selector_start = Instant::now();
        let selector_output = select_candidates_with_report(
            hydrated_query,
            scored_candidates,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
            self.config.serving_author_soft_cap,
        );
        let oversampled = selector_output.candidates;
        let oversample_target = selector_target_size(
            hydrated_query.limit,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
        );
        let selector_audit = build_selector_audit(&oversampled);
        let mut selector_detail = HashMap::from([
            (
                "oversampleFactor".to_string(),
                serde_json::Value::from(self.config.selector_oversample_factor as u64),
            ),
            (
                "maxSize".to_string(),
                serde_json::Value::from(self.config.selector_max_size as u64),
            ),
            (
                "targetSize".to_string(),
                serde_json::Value::from(oversample_target as u64),
            ),
            (
                "authorSoftCap".to_string(),
                serde_json::Value::from(self.config.serving_author_soft_cap as u64),
            ),
            (
                "auditVersion".to_string(),
                serde_json::Value::String("selector_lane_source_pool_audit_v1".to_string()),
            ),
            (
                "selectorConstraintVersion".to_string(),
                serde_json::Value::String("constraint_verdict_v1".to_string()),
            ),
            (
                "selectedCount".to_string(),
                serde_json::Value::from(selector_audit.selected_count as u64),
            ),
            (
                "selectedTrendCount".to_string(),
                serde_json::Value::from(selector_audit.trend_count as u64),
            ),
            (
                "selectedNewsCount".to_string(),
                serde_json::Value::from(selector_audit.news_count as u64),
            ),
            (
                "selectedExplorationCount".to_string(),
                serde_json::Value::from(selector_audit.exploration_count as u64),
            ),
        ]);
        selector_detail.insert(
            "selectedLaneCounts".to_string(),
            count_map_json(selector_audit.lane_counts),
        );
        selector_detail.insert(
            "selectedSourceCounts".to_string(),
            count_map_json(selector_audit.source_counts),
        );
        selector_detail.insert(
            "selectedPoolCounts".to_string(),
            count_map_json(selector_audit.pool_counts),
        );
        if let Some(reason) = selector_output.report.first_blocking_reason {
            selector_detail.insert(
                "selectorFirstBlockingReason".to_string(),
                serde_json::Value::String(reason),
            );
        }
        selector_detail.insert(
            "selectorDeferredReasonCounts".to_string(),
            count_map_json(selector_output.report.deferred_reason_counts),
        );
        telemetry.add_stage(RecommendationStagePayload {
            name: "RustTopKSelector".to_string(),
            enabled: true,
            duration_ms: selector_start.elapsed().as_millis() as u64,
            input_count: scored_candidates.len(),
            output_count: oversampled.len(),
            removed_count: Some(scored_candidates.len().saturating_sub(oversampled.len())),
            detail: Some(selector_detail),
        });
        telemetry.record_latency("selector", selector_start.elapsed().as_millis() as u64);
        oversampled
    }

    pub(super) async fn execute_post_selection_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        oversampled: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<Vec<RecommendationCandidatePayload>> {
        let post_hydrated_candidates = self
            .execute_post_selection_hydration_stage(
                hydrated_query,
                oversampled,
                circuit_open_hydrators,
                telemetry,
            )
            .await?;
        Ok(self.execute_post_selection_filter_stage(
            hydrated_query,
            post_hydrated_candidates,
            telemetry,
        ))
    }

    pub(super) async fn rescue_empty_selection(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        mut final_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        if !final_candidates.is_empty() || hydrated_query.in_network_only {
            return final_candidates;
        }

        let rescue_start = Instant::now();
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
                telemetry.record_provider_call("providers/self-posts");
                telemetry.record_provider_latency("providers/self-posts", response.latency_ms);
                let output_count = response.payload.candidates.len();
                telemetry.add_stage(build_self_post_rescue_stage(
                    rescue_start.elapsed().as_millis() as u64,
                    output_count,
                    None,
                    hydrated_query.limit,
                ));
                telemetry
                    .record_latency("selfPostRescue", rescue_start.elapsed().as_millis() as u64);
                if output_count > 0 {
                    final_candidates = response.payload.candidates;
                    telemetry
                        .degraded_reasons
                        .push("selection:self_post_rescue_applied".to_string());
                }
            }
            Err(error) => {
                telemetry.add_stage(build_self_post_rescue_stage(
                    rescue_start.elapsed().as_millis() as u64,
                    0,
                    Some(&error.to_string()),
                    hydrated_query.limit,
                ));
                telemetry
                    .record_latency("selfPostRescue", rescue_start.elapsed().as_millis() as u64);
                telemetry
                    .degraded_reasons
                    .push("selection:self_post_rescue_failed".to_string());
            }
        }
        final_candidates
    }

    pub(super) fn execute_serving_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        mut final_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> ServingStageOutput {
        let serving_start = Instant::now();
        sort_candidates_stably(&mut final_candidates, hydrated_query.in_network_only);
        let serving_result = dedup_for_serving(
            hydrated_query,
            &final_candidates,
            hydrated_query.limit,
            self.config.serving_author_soft_cap,
        );
        let duplicate_suppressed_count = serving_result.duplicate_suppressed_count;
        let cross_page_duplicate_count = serving_result.cross_page_duplicate_count;
        let has_more = serving_result.has_more;
        let page_remaining_count = serving_result.page_remaining_count;
        let page_underfilled = serving_result.page_underfilled;
        let page_underfill_reason = serving_result.page_underfill_reason.clone();
        let suppression_reasons = serving_result.suppression_reasons.clone();
        let pre_serving_count = final_candidates.len();
        final_candidates = serving_result.candidates;
        let truncated = has_more;
        let next_cursor = build_next_cursor(&final_candidates);
        let stable_order_key =
            build_stable_order_key(&final_candidates, hydrated_query.in_network_only);
        telemetry.add_stage(build_serving_stage(
            serving_start.elapsed().as_millis() as u64,
            pre_serving_count,
            hydrated_query.limit,
            final_candidates.len(),
            page_remaining_count,
            duplicate_suppressed_count,
            cross_page_duplicate_count,
            &suppression_reasons,
            &stable_order_key,
            has_more,
            page_underfilled,
            page_underfill_reason.as_deref(),
        ));
        telemetry.record_latency("serving", serving_start.elapsed().as_millis() as u64);

        ServingStageOutput {
            final_candidates,
            duplicate_suppressed_count,
            cross_page_duplicate_count,
            has_more,
            page_remaining_count,
            page_underfilled,
            page_underfill_reason,
            suppression_reasons,
            truncated,
            next_cursor,
            stable_order_key,
        }
    }

    async fn append_recent_hot_candidates(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        retrieved: &mut Vec<RecommendationCandidatePayload>,
        retrieval_summary: &mut RecommendationRetrievalSummaryPayload,
        telemetry: &mut RunTelemetry,
    ) {
        let recent_start = Instant::now();
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
            .insert("RecentHotStore".to_string(), recent_candidates.len());
        retrieval_summary.stage_timings.insert(
            "RecentHotStore".to_string(),
            recent_start.elapsed().as_millis() as u64,
        );
        retrieval_summary.recent_hot_candidates += recent_candidates.len();
        retrieval_summary.total_candidates += recent_candidates.len();
        if !recent_candidates.is_empty() {
            telemetry.add_stage(RecommendationStagePayload {
                name: "RecentHotStore".to_string(),
                enabled: true,
                duration_ms: recent_start.elapsed().as_millis() as u64,
                input_count: 1,
                output_count: recent_candidates.len(),
                removed_count: None,
                detail: Some(HashMap::from([(
                    "recentHot".to_string(),
                    serde_json::Value::Bool(true),
                )])),
            });
            retrieved.extend(recent_candidates);
        }
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
        let hydrate_start = Instant::now();
        let (candidate_hydrator_components, mut skipped_candidate_hydrator_stages) =
            active_component_names(
                &self.definition.candidate_hydrators,
                circuit_open_hydrators,
                retrieved.len(),
            );
        telemetry.append_stages(std::mem::take(&mut skipped_candidate_hydrator_stages));
        let mut hydrate_response = self
            .backend_client
            .hydrate_candidates_with_components(
                hydrated_query,
                retrieved,
                candidate_hydrator_components,
            )
            .await?;
        telemetry.record_provider_call("hydrate");
        telemetry.record_provider_latency("hydrate", hydrate_response.latency_ms);
        telemetry.merge_provider_calls(&hydrate_response.payload.provider_calls);
        let hydrate_stages = hydrate_response.payload.stages.clone();
        let hydrated_candidates = hydrate_response.payload.candidates;
        telemetry.append_stages(std::mem::take(&mut hydrate_response.payload.stages));
        telemetry.record_latency("hydrate", hydrate_start.elapsed().as_millis() as u64);
        Ok((hydrated_candidates, hydrate_stages))
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
        let filter_start = Instant::now();
        let filter_execution = run_pre_score_filters(hydrated_query, hydrated_candidates);
        telemetry.merge_drop_counts(filter_execution.drop_counts.clone());
        let filter_stages = filter_execution.stages.clone();
        let filtered_candidates = filter_execution.candidates.clone();
        let ranking_drop_counts = filter_execution.drop_counts.clone();
        telemetry.append_stages(filter_execution.stages);
        telemetry.record_latency("filter", filter_start.elapsed().as_millis() as u64);
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
        let score_start = Instant::now();
        let mut score_response = self
            .backend_client
            .score_candidates_with_components(
                hydrated_query,
                filtered_candidates,
                Some(
                    ML_BASE_SCORER_COMPONENTS
                        .iter()
                        .map(|name| (*name).to_string())
                        .collect(),
                ),
            )
            .await?;
        telemetry.record_provider_call("score");
        telemetry.record_provider_latency("score", score_response.latency_ms);
        telemetry.merge_provider_calls(&score_response.payload.provider_calls);
        let mut score_stages = score_response.payload.stages.clone();
        let provider_scored_candidates = score_response.payload.candidates;
        telemetry.append_stages(std::mem::take(&mut score_response.payload.stages));
        let local_scoring = run_local_scorers(hydrated_query, provider_scored_candidates);
        let scored_candidates = local_scoring.candidates;
        telemetry.append_stages(local_scoring.stages.clone());
        score_stages.extend(local_scoring.stages);
        telemetry.record_latency("score", score_start.elapsed().as_millis() as u64);
        Ok((scored_candidates, score_stages))
    }

    async fn execute_post_selection_hydration_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        oversampled: &[RecommendationCandidatePayload],
        circuit_open_hydrators: &[String],
        telemetry: &mut RunTelemetry,
    ) -> Result<Vec<RecommendationCandidatePayload>> {
        let post_hydrate_start = Instant::now();
        let (post_hydrator_components, mut skipped_post_hydrator_stages) = active_component_names(
            &self.definition.post_selection_hydrators,
            circuit_open_hydrators,
            oversampled.len(),
        );
        telemetry.append_stages(std::mem::take(&mut skipped_post_hydrator_stages));
        let mut post_hydrate_response = self
            .backend_client
            .hydrate_post_selection_candidates_with_components(
                hydrated_query,
                oversampled,
                post_hydrator_components,
            )
            .await?;
        telemetry.record_provider_call("post_selection_hydrate");
        telemetry
            .record_provider_latency("post_selection_hydrate", post_hydrate_response.latency_ms);
        telemetry.merge_provider_calls(&post_hydrate_response.payload.provider_calls);
        let post_hydrated_candidates = post_hydrate_response.payload.candidates;
        telemetry.append_stages(std::mem::take(&mut post_hydrate_response.payload.stages));
        telemetry.record_latency(
            "postSelectionHydrate",
            post_hydrate_start.elapsed().as_millis() as u64,
        );
        Ok(post_hydrated_candidates)
    }

    fn execute_post_selection_filter_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        post_hydrated_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        let post_filter_start = Instant::now();
        let post_filter_execution =
            run_post_selection_filters(hydrated_query, post_hydrated_candidates);
        telemetry.merge_drop_counts(post_filter_execution.drop_counts.clone());
        let final_candidates = post_filter_execution.candidates;
        telemetry.append_stages(post_filter_execution.stages);
        telemetry.record_latency(
            "postSelectionFilter",
            post_filter_start.elapsed().as_millis() as u64,
        );
        final_candidates
    }
}
