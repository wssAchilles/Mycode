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
    RecommendationSummaryPayload,
};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::definition::RecommendationPipelineDefinition;
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
    record_provider_call,
};

const SELF_POST_RESCUE_STAGE_NAME: &str = "SelfPostRescueSource";
const SELF_POST_RESCUE_LOOKBACK_DAYS: usize = 180;

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
        let (hydrated_query, mut query_stages, query_provider_calls, query_degraded_reasons) =
            self.hydrate_query_parallel_bounded(&query).await;
        stage_latency_ms.insert(
            "queryHydrators".to_string(),
            query_start.elapsed().as_millis() as u64,
        );
        merge_provider_calls(&mut provider_calls, &query_provider_calls);
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
            response
        };
        let mut retrieved = retrieval_response.candidates;
        let mut retrieval_summary = retrieval_response.summary;
        merge_provider_calls(&mut provider_calls, &retrieval_response.provider_calls);
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
        merge_provider_calls(&mut provider_calls, &hydrate_response.provider_calls);
        let hydrate_stages = hydrate_response.stages.clone();
        let hydrated_candidates = hydrate_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut hydrate_response.stages),
        );
        stage_latency_ms.insert(
            "hydrate".to_string(),
            hydrate_start.elapsed().as_millis() as u64,
        );

        let filter_start = Instant::now();
        let mut filter_response = self
            .backend_client
            .filter_candidates(&hydrated_query, &hydrated_candidates)
            .await?;
        record_provider_call(&mut provider_calls, "filter");
        merge_provider_calls(&mut provider_calls, &filter_response.provider_calls);
        merge_drop_counts(&mut filter_drop_counts, filter_response.drop_counts.clone());
        let filter_stages = filter_response.stages.clone();
        let filtered_candidates = filter_response.candidates;
        let ranking_drop_counts = filter_response.drop_counts;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut filter_response.stages),
        );
        stage_latency_ms.insert(
            "filter".to_string(),
            filter_start.elapsed().as_millis() as u64,
        );

        let score_start = Instant::now();
        let mut score_response = self
            .backend_client
            .score_candidates(&hydrated_query, &filtered_candidates)
            .await?;
        record_provider_call(&mut provider_calls, "score");
        merge_provider_calls(&mut provider_calls, &score_response.provider_calls);
        let score_stages = score_response.stages.clone();
        let scored_candidates = score_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut score_response.stages),
        );
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
        merge_provider_calls(&mut provider_calls, &post_hydrate_response.provider_calls);
        let post_hydrated_candidates = post_hydrate_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut post_hydrate_response.stages),
        );
        stage_latency_ms.insert(
            "postSelectionHydrate".to_string(),
            post_hydrate_start.elapsed().as_millis() as u64,
        );

        let post_filter_start = Instant::now();
        let mut post_filter_response = self
            .backend_client
            .filter_post_selection_candidates(&hydrated_query, &post_hydrated_candidates)
            .await?;
        record_provider_call(&mut provider_calls, "post_selection_filter");
        merge_provider_calls(&mut provider_calls, &post_filter_response.provider_calls);
        merge_drop_counts(&mut filter_drop_counts, post_filter_response.drop_counts);
        let mut final_candidates = post_filter_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut post_filter_response.stages),
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
                Ok(rescue_candidates) => {
                    record_provider_call(&mut provider_calls, "providers/self-posts");
                    let output_count = rescue_candidates.len();
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
                        final_candidates = rescue_candidates;
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

        let summary = RecommendationSummaryPayload {
            request_id: hydrated_query.request_id.clone(),
            stage: self.config.stage.clone(),
            pipeline_version: self.definition.pipeline_version.clone(),
            owner: self.definition.owner.clone(),
            fallback_mode: self.definition.fallback_mode.clone(),
            provider_calls,
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
                HashMap<String, usize>
            )>;
            self.definition.query_hydrators.len()
        ];

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((index, Ok(response))) => {
                    ordered_results[index] = Some((
                        response.stage,
                        response.query_patch,
                        response.provider_calls,
                    ));
                }
                Ok((index, Err(error))) => {
                    let hydrator_name = self.definition.query_hydrators[index].clone();
                    ordered_results[index] = Some((
                        build_query_error_stage(&hydrator_name, &error),
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
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
                    ));
                }
            }
        }

        let mut hydrated_query = query.clone();
        let mut seen_fields = HashSet::new();
        let mut stages = Vec::with_capacity(ordered_results.len());
        let mut provider_calls = HashMap::new();
        let mut degraded_reasons = Vec::new();

        for (index, result) in ordered_results.into_iter().enumerate() {
            let Some((mut stage, patch, patch_provider_calls)) = result else {
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
            record_provider_call(
                &mut provider_calls,
                &format!("query_hydrators/{}", self.definition.query_hydrators[index]),
            );
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

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use chrono::Utc;
    use serde_json::json;

    use crate::contracts::{
        CandidateNewsMetadataPayload, RecommendationCandidatePayload,
        RecommendationQueryPatchPayload, RecommendationQueryPayload, RecommendationStagePayload,
    };

    use super::{apply_query_patch, build_ranking_summary};

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
