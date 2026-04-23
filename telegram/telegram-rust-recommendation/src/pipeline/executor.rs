use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPatchPayload, RecommendationQueryPayload,
    RecommendationRankingSummaryPayload, RecommendationResultPayload,
    RecommendationSelectorPayload, RecommendationServingSummaryPayload, RecommendationStagePayload,
    RecommendationSummaryPayload, RecommendationTraceCandidatePayload,
    RecommendationTraceFreshnessPayload, RecommendationTracePayload,
    RecommendationTraceReplayPoolPayload, RecommendationTraceSourceCountPayload,
};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::pipeline::local::filters::{run_post_selection_filters, run_pre_score_filters};
use crate::pipeline::local::scorers::run_local_scorers;
use crate::serving::cache::ServeCache;
use crate::serving::cursor::{
    CURSOR_MODE, SERVED_STATE_VERSION, SERVING_VERSION, build_next_cursor,
};
use crate::serving::dedup::dedup_for_serving;
use crate::serving::policy::{
    CACHE_KEY_MODE, CACHE_POLICY_MODE, build_query_fingerprint, evaluate_store_policy,
};
use crate::serving::stable_order::{build_stable_order_key, sort_candidates_stably};
use crate::side_effects::runtime::dispatch_post_response_side_effects;
use crate::sources::orchestrator::RecommendationSourceOrchestrator;
use crate::state::recent_store::RecentHotStore;
use crate::top_k::{select_candidates, selector_target_size};

use super::utils::{
    accumulate_stage, append_stages, dedup_strings, merge_drop_counts, merge_provider_calls,
    merge_provider_latency, record_provider_call, record_provider_latency,
};

const SELF_POST_RESCUE_STAGE_NAME: &str = "SelfPostRescueSource";
const SELF_POST_RESCUE_LOOKBACK_DAYS: usize = 180;
const ML_BASE_SCORER_COMPONENTS: &[&str] = &["PhoenixScorer", "EngagementScorer"];
const TRACE_VERSION: &str = "rust_candidate_trace_v1";
const TRACE_SELECTED_CANDIDATE_LIMIT: usize = 60;
const TRACE_REPLAY_POOL_LIMIT: usize = 60;

#[derive(Clone)]
pub struct RecommendationPipeline {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    definition: RecommendationPipelineDefinition,
    recent_store: Arc<Mutex<RecentHotStore>>,
    metrics: Arc<Mutex<RecommendationMetrics>>,
    source_orchestrator: RecommendationSourceOrchestrator,
    serve_cache: ServeCache,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
        metrics: Arc<Mutex<RecommendationMetrics>>,
        definition: RecommendationPipelineDefinition,
        source_orchestrator: RecommendationSourceOrchestrator,
    ) -> Self {
        Self {
            serve_cache: ServeCache::from_config(&config),
            backend_client,
            config,
            definition,
            recent_store,
            metrics,
            source_orchestrator,
        }
    }

    pub fn definition(&self) -> &RecommendationPipelineDefinition {
        &self.definition
    }

    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        let request_start = Instant::now();
        let query_fingerprint = build_query_fingerprint(&query);
        let serve_cache_start = Instant::now();
        let serve_cache_lookup = self.serve_cache.get(&query_fingerprint).await;
        let serve_cache_duration_ms = serve_cache_start.elapsed().as_millis() as u64;
        if let Some(cached_result) = serve_cache_lookup.result {
            return Ok(self.rebuild_cached_result(
                cached_result,
                &query,
                &query_fingerprint,
                serve_cache_duration_ms,
                request_start.elapsed().as_millis() as u64,
            ));
        }

        let mut stage_timings = HashMap::new();
        let mut stage_latency_ms = HashMap::new();
        let mut stages = Vec::new();
        let mut filter_drop_counts = HashMap::new();
        let mut degraded_reasons = Vec::new();
        let mut provider_calls = HashMap::new();
        let mut provider_latency_ms = HashMap::new();
        accumulate_stage(
            &mut stages,
            &mut stage_timings,
            build_serve_cache_stage(
                false,
                serve_cache_duration_ms,
                0,
                self.serve_cache.enabled(),
                &query_fingerprint,
            ),
        );
        stage_latency_ms.insert("serveCache".to_string(), serve_cache_duration_ms);

        let query_start = Instant::now();
        let (
            hydrated_query,
            mut query_stages,
            query_provider_calls,
            query_provider_latency_ms,
            query_degraded_reasons,
        ) = self.hydrate_query_parallel_bounded(&query).await;
        stage_latency_ms.insert(
            "queryHydrators".to_string(),
            query_start.elapsed().as_millis() as u64,
        );
        merge_provider_calls(&mut provider_calls, &query_provider_calls);
        merge_provider_latency(&mut provider_latency_ms, &query_provider_latency_ms);
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut query_stages),
        );
        degraded_reasons.extend(query_degraded_reasons);

        let retrieval_start = Instant::now();
        let mut retrieval_response = if self.config.retrieval_mode == "source_orchestrated_graph_v2"
        {
            self.source_orchestrator
                .retrieve_candidates(&hydrated_query)
                .await?
        } else {
            let response = self
                .backend_client
                .retrieve_candidates(&hydrated_query)
                .await?;
            record_provider_call(&mut provider_calls, "retrieval");
            record_provider_latency(&mut provider_latency_ms, "retrieval", response.latency_ms);
            response.payload
        };
        let mut retrieved = retrieval_response.candidates;
        let mut retrieval_summary = retrieval_response.summary;
        merge_provider_calls(&mut provider_calls, &retrieval_response.provider_calls);
        merge_provider_latency(
            &mut provider_latency_ms,
            &retrieval_response.provider_latency_ms,
        );
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut retrieval_response.stages),
        );
        degraded_reasons.extend(retrieval_summary.degraded_reasons.iter().cloned());

        if self.config.recent_source_enabled && !hydrated_query.in_network_only {
            let recent_start = Instant::now();
            let recent_candidates = {
                let store = self.recent_store.lock().await;
                let existing_ids: HashSet<String> = retrieved
                    .iter()
                    .map(|candidate| candidate.post_id.clone())
                    .collect();
                store.recent_hot_candidates(&hydrated_query, &existing_ids)
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
                let recent_stage = RecommendationStagePayload {
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
                };
                accumulate_stage(&mut stages, &mut stage_timings, recent_stage);
                retrieved.extend(recent_candidates);
            }
        }
        stage_latency_ms.insert(
            "sources".to_string(),
            retrieval_start.elapsed().as_millis() as u64,
        );

        let retrieved_count = retrieved.len();
        if retrieved_count == 0 {
            degraded_reasons.push("empty_retrieval".to_string());
        }
        retrieval_summary.total_candidates = retrieved_count;

        let hydrate_start = Instant::now();
        let mut hydrate_response = self
            .backend_client
            .hydrate_candidates(&hydrated_query, &retrieved)
            .await?;
        record_provider_call(&mut provider_calls, "hydrate");
        record_provider_latency(
            &mut provider_latency_ms,
            "hydrate",
            hydrate_response.latency_ms,
        );
        merge_provider_calls(
            &mut provider_calls,
            &hydrate_response.payload.provider_calls,
        );
        let hydrate_stages = hydrate_response.payload.stages.clone();
        let hydrated_candidates = hydrate_response.payload.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut hydrate_response.payload.stages),
        );
        stage_latency_ms.insert(
            "hydrate".to_string(),
            hydrate_start.elapsed().as_millis() as u64,
        );

        let filter_start = Instant::now();
        let filter_execution = run_pre_score_filters(&hydrated_query, hydrated_candidates.clone());
        merge_drop_counts(
            &mut filter_drop_counts,
            filter_execution.drop_counts.clone(),
        );
        let filter_stages = filter_execution.stages.clone();
        let filtered_candidates = filter_execution.candidates.clone();
        let ranking_drop_counts = filter_execution.drop_counts.clone();
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            filter_execution.stages,
        );
        stage_latency_ms.insert(
            "filter".to_string(),
            filter_start.elapsed().as_millis() as u64,
        );

        let score_start = Instant::now();
        let mut score_response = self
            .backend_client
            .score_candidates_with_components(
                &hydrated_query,
                &filtered_candidates,
                Some(
                    ML_BASE_SCORER_COMPONENTS
                        .iter()
                        .map(|name| (*name).to_string())
                        .collect(),
                ),
            )
            .await?;
        record_provider_call(&mut provider_calls, "score");
        record_provider_latency(&mut provider_latency_ms, "score", score_response.latency_ms);
        merge_provider_calls(&mut provider_calls, &score_response.payload.provider_calls);
        let mut score_stages = score_response.payload.stages.clone();
        let provider_scored_candidates = score_response.payload.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut score_response.payload.stages),
        );
        let local_scoring = run_local_scorers(&hydrated_query, provider_scored_candidates);
        let scored_candidates = local_scoring.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            local_scoring.stages.clone(),
        );
        score_stages.extend(local_scoring.stages);
        stage_latency_ms.insert(
            "score".to_string(),
            score_start.elapsed().as_millis() as u64,
        );
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
        degraded_reasons.extend(ranking_summary.degraded_reasons.iter().cloned());

        let selector_start = Instant::now();
        let oversampled = select_candidates(
            &hydrated_query,
            &scored_candidates,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
        );
        let oversample_target = selector_target_size(
            hydrated_query.limit,
            self.config.selector_oversample_factor,
            self.config.selector_max_size,
        );
        let selector_stage = RecommendationStagePayload {
            name: "RustTopKSelector".to_string(),
            enabled: true,
            duration_ms: selector_start.elapsed().as_millis() as u64,
            input_count: scored_candidates.len(),
            output_count: oversampled.len(),
            removed_count: Some(scored_candidates.len().saturating_sub(oversampled.len())),
            detail: Some(HashMap::from([
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
            ])),
        };
        accumulate_stage(&mut stages, &mut stage_timings, selector_stage);
        stage_latency_ms.insert(
            "selector".to_string(),
            selector_start.elapsed().as_millis() as u64,
        );

        let post_hydrate_start = Instant::now();
        let mut post_hydrate_response = self
            .backend_client
            .hydrate_post_selection_candidates(&hydrated_query, &oversampled)
            .await?;
        record_provider_call(&mut provider_calls, "post_selection_hydrate");
        record_provider_latency(
            &mut provider_latency_ms,
            "post_selection_hydrate",
            post_hydrate_response.latency_ms,
        );
        merge_provider_calls(
            &mut provider_calls,
            &post_hydrate_response.payload.provider_calls,
        );
        let post_hydrated_candidates = post_hydrate_response.payload.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut post_hydrate_response.payload.stages),
        );
        stage_latency_ms.insert(
            "postSelectionHydrate".to_string(),
            post_hydrate_start.elapsed().as_millis() as u64,
        );

        let post_filter_start = Instant::now();
        let post_filter_execution =
            run_post_selection_filters(&hydrated_query, post_hydrated_candidates);
        merge_drop_counts(
            &mut filter_drop_counts,
            post_filter_execution.drop_counts.clone(),
        );
        let mut final_candidates = post_filter_execution.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            post_filter_execution.stages,
        );
        stage_latency_ms.insert(
            "postSelectionFilter".to_string(),
            post_filter_start.elapsed().as_millis() as u64,
        );

        if final_candidates.is_empty() && !hydrated_query.in_network_only {
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
                    record_provider_call(&mut provider_calls, "providers/self-posts");
                    record_provider_latency(
                        &mut provider_latency_ms,
                        "providers/self-posts",
                        response.latency_ms,
                    );
                    let output_count = response.payload.candidates.len();
                    accumulate_stage(
                        &mut stages,
                        &mut stage_timings,
                        build_self_post_rescue_stage(
                            rescue_start.elapsed().as_millis() as u64,
                            output_count,
                            None,
                            hydrated_query.limit,
                        ),
                    );
                    stage_latency_ms.insert(
                        "selfPostRescue".to_string(),
                        rescue_start.elapsed().as_millis() as u64,
                    );
                    if output_count > 0 {
                        final_candidates = response.payload.candidates;
                        degraded_reasons.push("selection:self_post_rescue_applied".to_string());
                    }
                }
                Err(error) => {
                    accumulate_stage(
                        &mut stages,
                        &mut stage_timings,
                        build_self_post_rescue_stage(
                            rescue_start.elapsed().as_millis() as u64,
                            0,
                            Some(&error.to_string()),
                            hydrated_query.limit,
                        ),
                    );
                    stage_latency_ms.insert(
                        "selfPostRescue".to_string(),
                        rescue_start.elapsed().as_millis() as u64,
                    );
                    degraded_reasons.push("selection:self_post_rescue_failed".to_string());
                }
            }
        }

        let serving_start = Instant::now();
        sort_candidates_stably(&mut final_candidates, hydrated_query.in_network_only);
        let serving_result = dedup_for_serving(
            &hydrated_query,
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
        accumulate_stage(
            &mut stages,
            &mut stage_timings,
            build_serving_stage(
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
            ),
        );
        stage_latency_ms.insert(
            "serving".to_string(),
            serving_start.elapsed().as_millis() as u64,
        );

        if final_candidates.is_empty() {
            degraded_reasons.push("empty_selection".to_string());
        } else if final_candidates.len() < hydrated_query.limit {
            degraded_reasons.push("underfilled_selection".to_string());
        }

        dedup_strings(&mut degraded_reasons);

        stage_latency_ms.insert(
            "pageBuild".to_string(),
            request_start.elapsed().as_millis() as u64,
        );

        let trace = build_recommendation_trace(
            &hydrated_query,
            &final_candidates,
            &scored_candidates,
            &self.definition.pipeline_version,
            &self.definition.owner,
            &self.definition.fallback_mode,
            false,
        );

        let summary = RecommendationSummaryPayload {
            request_id: hydrated_query.request_id.clone(),
            stage: self.config.stage.clone(),
            pipeline_version: self.definition.pipeline_version.clone(),
            owner: self.definition.owner.clone(),
            fallback_mode: self.definition.fallback_mode.clone(),
            provider_calls,
            provider_latency_ms,
            retrieved_count,
            selected_count: final_candidates.len(),
            source_counts: retrieval_summary.source_counts.clone(),
            filter_drop_counts,
            stage_timings,
            stage_latency_ms,
            degraded_reasons,
            recent_hot_applied: self.config.recent_source_enabled
                && !hydrated_query.in_network_only,
            selector: RecommendationSelectorPayload {
                oversample_factor: self.config.selector_oversample_factor,
                max_size: self.config.selector_max_size,
                final_limit: hydrated_query.limit,
                truncated,
            },
            serving: RecommendationServingSummaryPayload {
                serving_version: SERVING_VERSION.to_string(),
                cursor_mode: CURSOR_MODE.to_string(),
                cursor: hydrated_query.cursor,
                next_cursor: next_cursor.clone(),
                has_more,
                served_state_version: SERVED_STATE_VERSION.to_string(),
                stable_order_key: stable_order_key.clone(),
                duplicate_suppressed_count,
                cross_page_duplicate_count,
                suppression_reasons,
                serve_cache_hit: false,
                stable_order_drifted: false,
                cache_key_mode: CACHE_KEY_MODE.to_string(),
                cache_policy: CACHE_POLICY_MODE.to_string(),
                cache_policy_reason: "pending_evaluation".to_string(),
                page_remaining_count,
                page_underfilled,
                page_underfill_reason,
            },
            retrieval: retrieval_summary,
            ranking: ranking_summary,
            stages,
            trace: Some(trace),
        };

        let mut result = RecommendationResultPayload {
            request_id: hydrated_query.request_id.clone(),
            serving_version: SERVING_VERSION.to_string(),
            cursor: hydrated_query.cursor,
            next_cursor,
            has_more,
            served_state_version: SERVED_STATE_VERSION.to_string(),
            stable_order_key,
            candidates: final_candidates,
            summary,
        };

        let cache_store_policy =
            evaluate_store_policy(&hydrated_query, &result, self.serve_cache.enabled());
        result.summary.serving.cache_policy_reason = cache_store_policy.reason.clone();
        dispatch_post_response_side_effects(
            Arc::clone(&self.metrics),
            Arc::clone(&self.recent_store),
            self.serve_cache.clone(),
            hydrated_query.user_id.clone(),
            query_fingerprint,
            result.clone(),
            cache_store_policy.cacheable,
        );

        Ok(result)
    }

    async fn hydrate_query_parallel_bounded(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        HashMap<String, u64>,
        Vec<String>,
    ) {
        match self
            .backend_client
            .hydrate_query_patches_batch(&self.definition.query_hydrators, query)
            .await
        {
            Ok(response) => {
                let mut items_by_name = response
                    .payload
                    .items
                    .into_iter()
                    .map(|item| {
                        (
                            item.hydrator_name.clone(),
                            (
                                item.stage,
                                item.query_patch,
                                item.provider_calls,
                                item.error_class,
                            ),
                        )
                    })
                    .collect::<HashMap<_, _>>();
                let ordered_results = self
                    .definition
                    .query_hydrators
                    .iter()
                    .map(|hydrator_name| items_by_name.remove(hydrator_name))
                    .collect::<Vec<_>>();
                let mut provider_calls = response.payload.provider_calls;
                let mut provider_latency_ms = HashMap::new();
                record_provider_call(&mut provider_calls, "query_hydrators/batch");
                record_provider_latency(
                    &mut provider_latency_ms,
                    "query_hydrators/batch",
                    response.latency_ms,
                );

                let (hydrated_query, stages, provider_calls, degraded_reasons) =
                    self.merge_query_hydrator_results(query, ordered_results, provider_calls);

                (
                    hydrated_query,
                    stages,
                    provider_calls,
                    provider_latency_ms,
                    degraded_reasons,
                )
            }
            Err(error) => {
                let (
                    hydrated_query,
                    stages,
                    mut provider_calls,
                    mut provider_latency_ms,
                    mut degraded_reasons,
                ) = self.hydrate_query_parallel_bounded_fallback(query).await;
                degraded_reasons.push(format!("query:query_hydrators_batch_failed:{}", error));
                record_provider_call(&mut provider_calls, "query_hydrators/fallback");
                record_provider_latency(&mut provider_latency_ms, "query_hydrators/fallback", 0);
                dedup_strings(&mut degraded_reasons);
                (
                    hydrated_query,
                    stages,
                    provider_calls,
                    provider_latency_ms,
                    degraded_reasons,
                )
            }
        }
    }

    async fn hydrate_query_parallel_bounded_fallback(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        HashMap<String, u64>,
        Vec<String>,
    ) {
        let concurrency = self.definition.query_hydrator_concurrency.max(1);
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let mut join_set = JoinSet::new();

        for (index, hydrator_name) in self.definition.query_hydrators.iter().enumerate() {
            let backend_client = self.backend_client.clone();
            let hydrator_name = hydrator_name.clone();
            let query = query.clone();
            let semaphore = semaphore.clone();
            join_set.spawn(async move {
                let _permit = semaphore
                    .acquire_owned()
                    .await
                    .expect("query hydrator semaphore");
                (
                    index,
                    backend_client
                        .hydrate_query_patch(&hydrator_name, &query)
                        .await
                        .map_err(|error| error.to_string()),
                )
            });
        }

        let mut ordered_results = vec![
            None::<(
                RecommendationStagePayload,
                RecommendationQueryPatchPayload,
                HashMap<String, usize>,
                Option<String>,
            )>;
            self.definition.query_hydrators.len()
        ];
        let mut provider_latency_ms = HashMap::new();

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((index, Ok(response))) => {
                    record_provider_latency(
                        &mut provider_latency_ms,
                        format!("query_hydrators/{}", self.definition.query_hydrators[index]),
                        response.latency_ms,
                    );
                    ordered_results[index] = Some((
                        response.payload.stage,
                        response.payload.query_patch,
                        response.payload.provider_calls,
                        response.payload.error_class,
                    ));
                }
                Ok((index, Err(error))) => {
                    let hydrator_name = self.definition.query_hydrators[index].clone();
                    ordered_results[index] = Some((
                        build_query_error_stage(&hydrator_name, &error),
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
                        Some("query_hydrator_failed".to_string()),
                    ));
                }
                Err(error) => {
                    let stage = build_query_error_stage("query_hydrator_join", &error.to_string());
                    let index = ordered_results
                        .iter()
                        .position(Option::is_none)
                        .unwrap_or_default();
                    ordered_results[index] = Some((
                        stage,
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
                        Some("query_hydrator_join_failed".to_string()),
                    ));
                }
            }
        }

        let (hydrated_query, stages, provider_calls, degraded_reasons) =
            self.merge_query_hydrator_results(query, ordered_results, HashMap::new());
        (
            hydrated_query,
            stages,
            provider_calls,
            provider_latency_ms,
            degraded_reasons,
        )
    }

    fn merge_query_hydrator_results(
        &self,
        query: &RecommendationQueryPayload,
        ordered_results: Vec<
            Option<(
                RecommendationStagePayload,
                RecommendationQueryPatchPayload,
                HashMap<String, usize>,
                Option<String>,
            )>,
        >,
        mut provider_calls: HashMap<String, usize>,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        Vec<String>,
    ) {
        let mut hydrated_query = query.clone();
        let mut seen_fields = HashSet::new();
        let mut stages = Vec::with_capacity(ordered_results.len());
        let mut degraded_reasons = Vec::new();

        for (index, result) in ordered_results.into_iter().enumerate() {
            let Some((mut stage, patch, patch_provider_calls, error_class)) = result else {
                let hydrator_name = self.definition.query_hydrators[index].clone();
                stages.push(build_query_error_stage(
                    &hydrator_name,
                    "query_hydrator_missing_result",
                ));
                degraded_reasons.push(format!(
                    "query:{}:query_hydrator_missing_result",
                    hydrator_name
                ));
                continue;
            };

            merge_provider_calls(&mut provider_calls, &patch_provider_calls);
            if let Some(error_class) = error_class {
                stage.detail.get_or_insert_with(HashMap::new).insert(
                    "errorClass".to_string(),
                    serde_json::Value::String(error_class),
                );
            }
            record_provider_call(
                &mut provider_calls,
                &format!("query_hydrators/{}", self.definition.query_hydrators[index]),
            );
            if let Some(error) = stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("error"))
                .and_then(serde_json::Value::as_str)
            {
                degraded_reasons.push(format!("query:{}:{error}", stage.name));
            }
            if let Err(error) = apply_query_patch(&mut hydrated_query, &patch, &mut seen_fields) {
                let detail = stage.detail.get_or_insert_with(HashMap::new);
                detail.insert(
                    "error".to_string(),
                    serde_json::Value::String(error.clone()),
                );
                degraded_reasons.push(format!("query:{}:{error}", stage.name));
            }
            stages.push(stage);
        }

        dedup_strings(&mut degraded_reasons);
        (hydrated_query, stages, provider_calls, degraded_reasons)
    }
}

impl RecommendationPipeline {
    fn rebuild_cached_result(
        &self,
        mut cached_result: RecommendationResultPayload,
        query: &RecommendationQueryPayload,
        query_fingerprint: &str,
        serve_cache_duration_ms: u64,
        page_build_duration_ms: u64,
    ) -> RecommendationResultPayload {
        cached_result.request_id = query.request_id.clone();
        cached_result.cursor = query.cursor;
        cached_result.summary.request_id = query.request_id.clone();
        cached_result.summary.serving.cursor = query.cursor;
        cached_result.summary.serving.serve_cache_hit = true;
        if let Some(trace) = cached_result.summary.trace.as_mut() {
            trace.request_id = query.request_id.clone();
            trace.serve_cache_hit = true;
        }
        cached_result.summary.stages.insert(
            0,
            build_serve_cache_stage(
                true,
                serve_cache_duration_ms,
                cached_result.candidates.len(),
                self.serve_cache.enabled(),
                query_fingerprint,
            ),
        );
        cached_result
            .summary
            .stage_timings
            .insert("RustServeCache".to_string(), serve_cache_duration_ms);
        cached_result
            .summary
            .stage_latency_ms
            .insert("serveCache".to_string(), serve_cache_duration_ms);
        cached_result
            .summary
            .stage_latency_ms
            .insert("pageBuild".to_string(), page_build_duration_ms);
        cached_result
    }
}

fn build_query_error_stage(stage_name: &str, error: &str) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: stage_name.to_string(),
        enabled: true,
        duration_ms: 0,
        input_count: 1,
        output_count: 1,
        removed_count: None,
        detail: Some(HashMap::from([(
            "error".to_string(),
            serde_json::Value::String(error.to_string()),
        )])),
    }
}

fn build_self_post_rescue_stage(
    duration_ms: u64,
    output_count: usize,
    error: Option<&str>,
    requested_limit: usize,
) -> RecommendationStagePayload {
    let mut detail = HashMap::from([
        (
            "rescueMode".to_string(),
            serde_json::Value::String("selection_empty_fallback".to_string()),
        ),
        (
            "provider".to_string(),
            serde_json::Value::String("node_self_post_rescue_provider".to_string()),
        ),
        (
            "owner".to_string(),
            serde_json::Value::String("rust".to_string()),
        ),
        (
            "lookbackDays".to_string(),
            serde_json::Value::from(SELF_POST_RESCUE_LOOKBACK_DAYS as u64),
        ),
        (
            "requestedLimit".to_string(),
            serde_json::Value::from(requested_limit as u64),
        ),
    ]);

    if let Some(error) = error {
        detail.insert(
            "error".to_string(),
            serde_json::Value::String(error.to_string()),
        );
    }

    RecommendationStagePayload {
        name: SELF_POST_RESCUE_STAGE_NAME.to_string(),
        enabled: true,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(detail),
    }
}

fn build_serve_cache_stage(
    hit: bool,
    duration_ms: u64,
    output_count: usize,
    enabled: bool,
    query_fingerprint: &str,
) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: "RustServeCache".to_string(),
        enabled,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(HashMap::from([
            ("cacheHit".to_string(), serde_json::Value::Bool(hit)),
            (
                "cacheKeyMode".to_string(),
                serde_json::Value::String(CACHE_KEY_MODE.to_string()),
            ),
            (
                "cachePolicy".to_string(),
                serde_json::Value::String(CACHE_POLICY_MODE.to_string()),
            ),
            (
                "queryFingerprint".to_string(),
                serde_json::Value::String(query_fingerprint.to_string()),
            ),
        ])),
    }
}

fn build_serving_stage(
    duration_ms: u64,
    input_count: usize,
    requested_limit: usize,
    output_count: usize,
    page_remaining_count: usize,
    duplicate_suppressed_count: usize,
    cross_page_duplicate_count: usize,
    suppression_reasons: &HashMap<String, usize>,
    stable_order_key: &str,
    has_more: bool,
    page_underfilled: bool,
    page_underfill_reason: Option<&str>,
) -> RecommendationStagePayload {
    let mut detail = HashMap::from([
        (
            "requestedLimit".to_string(),
            serde_json::Value::from(requested_limit as u64),
        ),
        (
            "duplicateSuppressedCount".to_string(),
            serde_json::Value::from(duplicate_suppressed_count as u64),
        ),
        (
            "crossPageDuplicateCount".to_string(),
            serde_json::Value::from(cross_page_duplicate_count as u64),
        ),
        (
            "pageRemainingCount".to_string(),
            serde_json::Value::from(page_remaining_count as u64),
        ),
        (
            "stableOrderKey".to_string(),
            serde_json::Value::String(stable_order_key.to_string()),
        ),
        ("hasMore".to_string(), serde_json::Value::Bool(has_more)),
        (
            "pageUnderfilled".to_string(),
            serde_json::Value::Bool(page_underfilled),
        ),
    ]);
    if let Some(reason) = page_underfill_reason {
        detail.insert(
            "pageUnderfillReason".to_string(),
            serde_json::Value::String(reason.to_string()),
        );
    }
    detail.insert(
        "suppressionReasons".to_string(),
        serde_json::to_value(suppression_reasons).unwrap_or(serde_json::Value::Null),
    );

    RecommendationStagePayload {
        name: "RustServingLane".to_string(),
        enabled: true,
        duration_ms,
        input_count,
        output_count,
        removed_count: Some(duplicate_suppressed_count),
        detail: Some(detail),
    }
}

fn apply_query_patch(
    query: &mut RecommendationQueryPayload,
    patch: &RecommendationQueryPatchPayload,
    seen_fields: &mut HashSet<&'static str>,
) -> std::result::Result<(), String> {
    if let Some(user_features) = patch.user_features.clone() {
        if !seen_fields.insert("userFeatures") {
            return Err("query_patch_field_conflict:userFeatures".to_string());
        }
        query.user_features = Some(user_features);
    }
    if let Some(embedding_context) = patch.embedding_context.clone() {
        if !seen_fields.insert("embeddingContext") {
            return Err("query_patch_field_conflict:embeddingContext".to_string());
        }
        query.embedding_context = Some(embedding_context);
    }
    if let Some(user_state_context) = patch.user_state_context.clone() {
        if !seen_fields.insert("userStateContext") {
            return Err("query_patch_field_conflict:userStateContext".to_string());
        }
        query.user_state_context = Some(user_state_context);
    }
    if let Some(user_action_sequence) = patch.user_action_sequence.clone() {
        if !seen_fields.insert("userActionSequence") {
            return Err("query_patch_field_conflict:userActionSequence".to_string());
        }
        query.user_action_sequence = Some(user_action_sequence);
    }
    if let Some(news_history_external_ids) = patch.news_history_external_ids.clone() {
        if !seen_fields.insert("newsHistoryExternalIds") {
            return Err("query_patch_field_conflict:newsHistoryExternalIds".to_string());
        }
        query.news_history_external_ids = Some(news_history_external_ids);
    }
    if let Some(model_user_action_sequence) = patch.model_user_action_sequence.clone() {
        if !seen_fields.insert("modelUserActionSequence") {
            return Err("query_patch_field_conflict:modelUserActionSequence".to_string());
        }
        query.model_user_action_sequence = Some(model_user_action_sequence);
    }
    if let Some(experiment_context) = patch.experiment_context.clone() {
        if !seen_fields.insert("experimentContext") {
            return Err("query_patch_field_conflict:experimentContext".to_string());
        }
        query.experiment_context = Some(experiment_context);
    }
    Ok(())
}

fn build_ranking_summary(
    input_candidates: usize,
    hydrated_candidates: &[RecommendationCandidatePayload],
    filtered_candidates: &[RecommendationCandidatePayload],
    scored_candidates: &[RecommendationCandidatePayload],
    filter_drop_counts: &HashMap<String, usize>,
    hydrate_stages: &[RecommendationStagePayload],
    filter_stages: &[RecommendationStagePayload],
    score_stages: &[RecommendationStagePayload],
) -> RecommendationRankingSummaryPayload {
    let mut stage_timings = HashMap::new();
    let mut degraded_reasons = Vec::new();

    for stage in hydrate_stages
        .iter()
        .chain(filter_stages.iter())
        .chain(score_stages.iter())
    {
        *stage_timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
        if let Some(error) = stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get("error"))
            .and_then(|value| value.as_str())
        {
            degraded_reasons.push(format!("ranking:{}:{error}", stage.name));
        }
    }

    let ml_eligible_candidates = filtered_candidates
        .iter()
        .filter(|candidate| {
            candidate.is_news.unwrap_or(false)
                && (candidate.model_post_id.is_some()
                    || candidate
                        .news_metadata
                        .as_ref()
                        .and_then(|metadata| metadata.external_id.as_ref())
                        .is_some())
        })
        .count();
    let ml_ranked_candidates = scored_candidates
        .iter()
        .filter(|candidate| candidate.phoenix_scores.is_some())
        .count();
    let weighted_candidates = scored_candidates
        .iter()
        .filter(|candidate| candidate.weighted_score.is_some())
        .count();

    let phoenix_stage_enabled = score_stages
        .iter()
        .any(|stage| stage.name == "PhoenixScorer" && stage.enabled);
    if phoenix_stage_enabled && ml_eligible_candidates > 0 && ml_ranked_candidates == 0 {
        degraded_reasons.push("ranking:PhoenixScorer:empty_ml_ranking".to_string());
    }

    dedup_strings(&mut degraded_reasons);

    RecommendationRankingSummaryPayload {
        stage: "xalgo_stageful_ranking_v2".to_string(),
        input_candidates,
        hydrated_candidates: hydrated_candidates.len(),
        filtered_candidates: filtered_candidates.len(),
        scored_candidates: scored_candidates.len(),
        ml_eligible_candidates,
        ml_ranked_candidates,
        weighted_candidates,
        stage_timings,
        filter_drop_counts: filter_drop_counts.clone(),
        degraded_reasons,
    }
}

fn build_recommendation_trace(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    replay_candidates: &[RecommendationCandidatePayload],
    pipeline_version: &str,
    owner: &str,
    fallback_mode: &str,
    serve_cache_hit: bool,
) -> RecommendationTracePayload {
    let selected_count = candidates.len();
    let in_network_count = candidates
        .iter()
        .filter(|candidate| candidate.in_network == Some(true))
        .count();
    let reply_count = candidates
        .iter()
        .filter(|candidate| candidate.is_reply)
        .count();
    let unique_authors = candidates
        .iter()
        .map(|candidate| candidate.author_id.clone())
        .collect::<HashSet<_>>();
    let scores = candidates
        .iter()
        .filter_map(trace_score)
        .collect::<Vec<_>>();

    RecommendationTracePayload {
        trace_version: TRACE_VERSION.to_string(),
        request_id: query.request_id.clone(),
        pipeline_version: pipeline_version.to_string(),
        owner: owner.to_string(),
        fallback_mode: fallback_mode.to_string(),
        selected_count,
        in_network_count,
        out_of_network_count: selected_count.saturating_sub(in_network_count),
        source_counts: trace_selected_source_counts(candidates),
        author_diversity: ratio(unique_authors.len(), selected_count),
        reply_ratio: ratio(reply_count, selected_count),
        average_score: average(&scores),
        top_score: scores.iter().copied().reduce(f64::max),
        bottom_score: scores.iter().copied().reduce(f64::min),
        freshness: trace_freshness(candidates),
        candidates: candidates
            .iter()
            .take(TRACE_SELECTED_CANDIDATE_LIMIT)
            .enumerate()
            .map(|(index, candidate)| trace_candidate(candidate, index + 1))
            .collect(),
        experiment_keys: trace_experiment_keys(query),
        user_state: query
            .user_state_context
            .as_ref()
            .map(|context| context.state.clone()),
        embedding_quality_score: query
            .embedding_context
            .as_ref()
            .and_then(|context| finite(context.quality_score)),
        replay_pool: Some(trace_replay_pool(replay_candidates)),
        serve_cache_hit,
    }
}

fn trace_replay_pool(
    replay_candidates: &[RecommendationCandidatePayload],
) -> RecommendationTraceReplayPoolPayload {
    let total_count = replay_candidates.len();
    let mut ordered = replay_candidates.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        let right_score = trace_score(right).unwrap_or(f64::NEG_INFINITY);
        let left_score = trace_score(left).unwrap_or(f64::NEG_INFINITY);
        right_score
            .partial_cmp(&left_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.post_id.cmp(&right.post_id))
    });

    RecommendationTraceReplayPoolPayload {
        pool_kind: "pre_selector_scored_topk_v1".to_string(),
        total_count,
        truncated: total_count > TRACE_REPLAY_POOL_LIMIT,
        candidates: ordered
            .into_iter()
            .take(TRACE_REPLAY_POOL_LIMIT)
            .enumerate()
            .map(|(index, candidate)| trace_candidate(candidate, index + 1))
            .collect(),
    }
}

fn trace_selected_source_counts(
    candidates: &[RecommendationCandidatePayload],
) -> Vec<RecommendationTraceSourceCountPayload> {
    let mut source_counts = HashMap::new();
    for candidate in candidates {
        let source = candidate
            .recall_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        *source_counts.entry(source).or_insert(0) += 1;
    }
    let mut counts = source_counts
        .into_iter()
        .map(|(source, count)| RecommendationTraceSourceCountPayload { source, count })
        .collect::<Vec<_>>();
    counts.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.source.cmp(&right.source))
    });
    counts
}

fn trace_candidate(
    candidate: &RecommendationCandidatePayload,
    rank: usize,
) -> RecommendationTraceCandidatePayload {
    RecommendationTraceCandidatePayload {
        post_id: candidate.post_id.clone(),
        model_post_id: candidate.model_post_id.clone().or_else(|| {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.external_id.clone())
        }),
        author_id: candidate.author_id.clone(),
        rank,
        recall_source: candidate
            .recall_source
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        in_network: candidate.in_network == Some(true),
        is_news: candidate.is_news == Some(true),
        score: trace_score(candidate),
        weighted_score: finite(candidate.weighted_score),
        pipeline_score: finite(candidate.pipeline_score),
        score_breakdown: finite_score_breakdown(&candidate.score_breakdown),
        created_at: candidate.created_at,
    }
}

fn trace_score(candidate: &RecommendationCandidatePayload) -> Option<f64> {
    finite(candidate.score)
        .or_else(|| finite(candidate.weighted_score))
        .or_else(|| finite(candidate.pipeline_score))
}

fn finite_score_breakdown(value: &Option<HashMap<String, f64>>) -> Option<HashMap<String, f64>> {
    let entries = value
        .as_ref()?
        .iter()
        .filter_map(|(key, score)| finite(Some(*score)).map(|score| (key.clone(), score)))
        .collect::<HashMap<_, _>>();
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

fn trace_freshness(
    candidates: &[RecommendationCandidatePayload],
) -> RecommendationTraceFreshnessPayload {
    let Some(newest) = candidates
        .iter()
        .map(|candidate| candidate.created_at)
        .max()
    else {
        return RecommendationTraceFreshnessPayload::default();
    };
    let Some(oldest) = candidates
        .iter()
        .map(|candidate| candidate.created_at)
        .min()
    else {
        return RecommendationTraceFreshnessPayload::default();
    };
    let now = chrono::Utc::now();
    RecommendationTraceFreshnessPayload {
        newest_age_seconds: Some(non_negative_seconds(now - newest)),
        oldest_age_seconds: Some(non_negative_seconds(now - oldest)),
        time_range_seconds: Some(non_negative_seconds(newest - oldest)),
    }
}

fn trace_experiment_keys(query: &RecommendationQueryPayload) -> Vec<String> {
    query
        .experiment_context
        .as_ref()
        .map(|context| {
            context
                .assignments
                .iter()
                .filter(|assignment| assignment.in_experiment)
                .map(|assignment| format!("{}:{}", assignment.experiment_id, assignment.bucket))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|score| score.is_finite())
}

fn average(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        return 0.0;
    }
    numerator as f64 / denominator as f64
}

fn non_negative_seconds(duration: chrono::Duration) -> u64 {
    duration.num_seconds().max(0) as u64
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use chrono::Utc;
    use serde_json::json;

    use crate::contracts::{
        CandidateNewsMetadataPayload, EmbeddingContextPayload, ExperimentAssignmentPayload,
        ExperimentContextPayload, RecommendationCandidatePayload, RecommendationQueryPatchPayload,
        RecommendationQueryPayload, RecommendationStagePayload, UserStateContextPayload,
    };

    use super::{apply_query_patch, build_ranking_summary, build_recommendation_trace};

    fn candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "content".to_string(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("NewsAnnSource".to_string()),
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: Some(true),
            news_metadata: Some(CandidateNewsMetadataPayload {
                external_id: Some(format!("ext-{post_id}")),
                ..CandidateNewsMetadataPayload::default()
            }),
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn builds_stageful_ranking_summary_and_ml_degradation() {
        let hydrated = vec![candidate("1"), candidate("2")];
        let filtered = hydrated.clone();
        let scored = vec![hydrated[0].clone()];
        let drop_counts = HashMap::from([("MutedKeywordFilter".to_string(), 1)]);
        let stages = vec![
            RecommendationStagePayload {
                name: "AuthorInfoHydrator".to_string(),
                enabled: true,
                duration_ms: 5,
                input_count: 2,
                output_count: 2,
                removed_count: None,
                detail: None,
            },
            RecommendationStagePayload {
                name: "PhoenixScorer".to_string(),
                enabled: true,
                duration_ms: 9,
                input_count: 2,
                output_count: 2,
                removed_count: None,
                detail: Some(HashMap::from([(
                    "error".to_string(),
                    json!("remote_timeout"),
                )])),
            },
        ];

        let summary = build_ranking_summary(
            2,
            &hydrated,
            &filtered,
            &scored,
            &drop_counts,
            &stages[..1],
            &[],
            &stages[1..],
        );

        assert_eq!(summary.stage, "xalgo_stageful_ranking_v2");
        assert_eq!(summary.input_candidates, 2);
        assert_eq!(summary.hydrated_candidates, 2);
        assert_eq!(summary.filtered_candidates, 2);
        assert_eq!(summary.scored_candidates, 1);
        assert_eq!(summary.ml_eligible_candidates, 2);
        assert_eq!(summary.ml_ranked_candidates, 0);
        assert_eq!(summary.weighted_candidates, 0);
        assert_eq!(
            summary.filter_drop_counts.get("MutedKeywordFilter"),
            Some(&1)
        );
        assert!(
            summary
                .degraded_reasons
                .contains(&"ranking:PhoenixScorer:remote_timeout".to_string())
        );
        assert!(
            summary
                .degraded_reasons
                .contains(&"ranking:PhoenixScorer:empty_ml_ranking".to_string())
        );
    }

    #[test]
    fn builds_rust_owned_recommendation_trace() {
        let mut first = candidate("507f191e810c19729de8c001");
        first.author_id = "author-a".to_string();
        first.in_network = Some(true);
        first.is_reply = true;
        first.score = Some(0.8);
        first.weighted_score = Some(0.7);
        first.pipeline_score = Some(0.6);
        first.score_breakdown = Some(HashMap::from([
            ("phoenixWeighted".to_string(), 0.8),
            ("ignoredNan".to_string(), f64::NAN),
        ]));

        let mut second = candidate("507f191e810c19729de8c002");
        second.author_id = "author-b".to_string();
        second.weighted_score = Some(0.2);

        let query = RecommendationQueryPayload {
            request_id: "req-trace".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: Some(EmbeddingContextPayload {
                quality_score: Some(0.91),
                usable: true,
                ..EmbeddingContextPayload::default()
            }),
            user_state_context: Some(UserStateContextPayload {
                state: "warm".to_string(),
                reason: "test".to_string(),
                followed_count: 8,
                recent_action_count: 12,
                recent_positive_action_count: 6,
                usable_embedding: true,
                account_age_days: Some(20),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: Some(ExperimentContextPayload {
                user_id: "viewer-1".to_string(),
                assignments: vec![
                    ExperimentAssignmentPayload {
                        experiment_id: "recsys_v2".to_string(),
                        experiment_name: "Recsys V2".to_string(),
                        bucket: "treatment".to_string(),
                        config: HashMap::new(),
                        in_experiment: true,
                    },
                    ExperimentAssignmentPayload {
                        experiment_id: "holdout".to_string(),
                        experiment_name: "Holdout".to_string(),
                        bucket: "control".to_string(),
                        config: HashMap::new(),
                        in_experiment: false,
                    },
                ],
            }),
        };

        let trace = build_recommendation_trace(
            &query,
            &[first.clone(), second.clone()],
            &[first.clone(), second.clone()],
            "xalgo_candidate_pipeline_v6",
            "rust",
            "node_provider_surface",
            false,
        );

        assert_eq!(trace.trace_version, "rust_candidate_trace_v1");
        assert_eq!(trace.selected_count, 2);
        assert_eq!(trace.in_network_count, 1);
        assert_eq!(trace.out_of_network_count, 1);
        assert_eq!(trace.author_diversity, 1.0);
        assert_eq!(trace.reply_ratio, 0.5);
        assert_eq!(trace.average_score, 0.5);
        assert_eq!(trace.experiment_keys, vec!["recsys_v2:treatment"]);
        assert_eq!(trace.user_state.as_deref(), Some("warm"));
        assert_eq!(trace.embedding_quality_score, Some(0.91));
        assert_eq!(trace.candidates[0].score, Some(0.8));
        assert_eq!(
            trace
                .replay_pool
                .as_ref()
                .map(|pool| pool.pool_kind.as_str()),
            Some("pre_selector_scored_topk_v1")
        );
        assert_eq!(
            trace.replay_pool.as_ref().map(|pool| pool.total_count),
            Some(2)
        );
        assert_eq!(
            trace.candidates[0]
                .score_breakdown
                .as_ref()
                .and_then(|breakdown| breakdown.get("phoenixWeighted")),
            Some(&0.8)
        );
        assert!(
            !trace.candidates[0]
                .score_breakdown
                .as_ref()
                .is_some_and(|breakdown| breakdown.contains_key("ignoredNan"))
        );
        assert_eq!(
            trace
                .replay_pool
                .as_ref()
                .and_then(|pool| pool.candidates.first())
                .and_then(|candidate| candidate.score),
            Some(0.8)
        );
    }

    #[test]
    fn applies_disjoint_query_patches_and_rejects_conflicts() {
        let mut query = RecommendationQueryPayload {
            request_id: "req-query-patch".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        };
        let mut seen_fields = HashSet::new();

        let user_features_patch = RecommendationQueryPatchPayload {
            user_features: Some(crate::contracts::UserFeaturesPayload {
                followed_user_ids: vec!["author-1".to_string()],
                blocked_user_ids: Vec::new(),
                muted_keywords: Vec::new(),
                seen_post_ids: Vec::new(),
                follower_count: Some(42),
                account_created_at: None,
            }),
            ..RecommendationQueryPatchPayload::default()
        };
        apply_query_patch(&mut query, &user_features_patch, &mut seen_fields)
            .expect("disjoint user features patch should merge");
        assert_eq!(
            query
                .user_features
                .as_ref()
                .and_then(|value| value.follower_count),
            Some(42)
        );

        let experiment_patch = RecommendationQueryPatchPayload {
            experiment_context: Some(crate::contracts::ExperimentContextPayload {
                user_id: "viewer-1".to_string(),
                assignments: Vec::new(),
            }),
            ..RecommendationQueryPatchPayload::default()
        };
        apply_query_patch(&mut query, &experiment_patch, &mut seen_fields)
            .expect("disjoint experiment patch should merge");
        assert_eq!(
            query
                .experiment_context
                .as_ref()
                .map(|value| value.user_id.as_str()),
            Some("viewer-1")
        );

        let conflict = apply_query_patch(&mut query, &user_features_patch, &mut seen_fields)
            .expect_err("second writer to userFeatures should be rejected");
        assert_eq!(conflict, "query_patch_field_conflict:userFeatures");
    }
}
