use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Mutex;

use crate::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationQueryPayload, RecommendationResultPayload, RecommendationSelectorPayload,
    RecommendationStagePayload, RecommendationSummaryPayload,
};
use crate::recent_store::RecentHotStore;
use crate::sources::orchestrator::RecommendationSourceOrchestrator;
use crate::top_k::{select_candidates, selector_target_size, sort_candidates};

use super::stage_aggregation::{accumulate_stage, append_stages, dedup_strings, merge_drop_counts};

#[derive(Clone)]
pub struct RecommendationPipeline {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    recent_store: Arc<Mutex<RecentHotStore>>,
    source_orchestrator: RecommendationSourceOrchestrator,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
    ) -> Self {
        let source_orchestrator =
            RecommendationSourceOrchestrator::new(backend_client.clone(), &config);
        Self {
            backend_client,
            config,
            recent_store,
            source_orchestrator,
        }
    }

    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        let mut stage_timings = HashMap::new();
        let mut stages = Vec::new();
        let mut filter_drop_counts = HashMap::new();
        let mut degraded_reasons = Vec::new();

        let query_response = self.backend_client.hydrate_query(&query).await?;
        let hydrated_query = query_response.query;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            query_response.stages,
        );

        let retrieval_response = if self.config.retrieval_mode == "source_orchestrated_graph_v2" {
            self.source_orchestrator
                .retrieve_candidates(&hydrated_query)
                .await?
        } else {
            self.backend_client
                .retrieve_candidates(&hydrated_query)
                .await?
        };
        let mut retrieved = retrieval_response.candidates;
        let mut retrieval_summary = retrieval_response.summary;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            retrieval_response.stages,
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

        let retrieved_count = retrieved.len();
        if retrieved_count == 0 {
            degraded_reasons.push("empty_retrieval".to_string());
        }
        retrieval_summary.total_candidates = retrieved_count;

        let ranking_response = self
            .backend_client
            .rank_candidates(&hydrated_query, &retrieved)
            .await?;
        let scored_candidates = ranking_response.candidates;
        let ranking_summary = ranking_response.summary;
        merge_drop_counts(&mut filter_drop_counts, ranking_response.drop_counts);
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            ranking_response.stages,
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

        let post_hydrate_response = self
            .backend_client
            .hydrate_post_selection_candidates(&hydrated_query, &oversampled)
            .await?;
        let post_hydrated_candidates = post_hydrate_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            post_hydrate_response.stages,
        );

        let post_filter_response = self
            .backend_client
            .filter_post_selection_candidates(&hydrated_query, &post_hydrated_candidates)
            .await?;
        merge_drop_counts(&mut filter_drop_counts, post_filter_response.drop_counts);
        let mut final_candidates = post_filter_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            post_filter_response.stages,
        );

        sort_candidates(&mut final_candidates, hydrated_query.in_network_only);
        let truncated = final_candidates.len() > hydrated_query.limit;
        if truncated {
            final_candidates.truncate(hydrated_query.limit);
        }

        if final_candidates.is_empty() {
            degraded_reasons.push("empty_selection".to_string());
        } else if final_candidates.len() < hydrated_query.limit {
            degraded_reasons.push("underfilled_selection".to_string());
        }

        dedup_strings(&mut degraded_reasons);

        {
            let mut store = self.recent_store.lock().await;
            store.record(&hydrated_query.user_id, &final_candidates);
        }

        let summary = RecommendationSummaryPayload {
            request_id: hydrated_query.request_id.clone(),
            stage: self.config.stage.clone(),
            retrieved_count,
            selected_count: final_candidates.len(),
            source_counts: retrieval_summary.source_counts.clone(),
            filter_drop_counts,
            stage_timings,
            degraded_reasons,
            recent_hot_applied: self.config.recent_source_enabled
                && !hydrated_query.in_network_only,
            selector: RecommendationSelectorPayload {
                oversample_factor: self.config.selector_oversample_factor,
                max_size: self.config.selector_max_size,
                final_limit: hydrated_query.limit,
                truncated,
            },
            retrieval: retrieval_summary,
            ranking: ranking_summary,
            stages,
        };

        Ok(RecommendationResultPayload {
            request_id: hydrated_query.request_id,
            candidates: final_candidates,
            summary,
        })
    }
}
