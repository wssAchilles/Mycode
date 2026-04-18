use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Mutex;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationRankingSummaryPayload, RecommendationResultPayload,
    RecommendationSelectorPayload, RecommendationStagePayload, RecommendationSummaryPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::sources::orchestrator::RecommendationSourceOrchestrator;
use crate::state::recent_store::RecentHotStore;
use crate::top_k::{select_candidates, selector_target_size, sort_candidates};

use super::utils::{
    accumulate_stage, append_stages, dedup_strings, merge_drop_counts, merge_provider_calls,
    record_provider_call,
};

#[derive(Clone)]
pub struct RecommendationPipeline {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    definition: RecommendationPipelineDefinition,
    recent_store: Arc<Mutex<RecentHotStore>>,
    source_orchestrator: RecommendationSourceOrchestrator,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
        definition: RecommendationPipelineDefinition,
        source_orchestrator: RecommendationSourceOrchestrator,
    ) -> Self {
        Self {
            backend_client,
            config,
            definition,
            recent_store,
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
        let mut stage_timings = HashMap::new();
        let mut stages = Vec::new();
        let mut filter_drop_counts = HashMap::new();
        let mut degraded_reasons = Vec::new();
        let mut provider_calls = HashMap::new();

        let mut query_response = self.backend_client.hydrate_query(&query).await?;
        record_provider_call(&mut provider_calls, "query");
        merge_provider_calls(&mut provider_calls, &query_response.provider_calls);
        let hydrated_query = query_response.query;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            std::mem::take(&mut query_response.stages),
        );

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

        let retrieved_count = retrieved.len();
        if retrieved_count == 0 {
            degraded_reasons.push("empty_retrieval".to_string());
        }
        retrieval_summary.total_candidates = retrieved_count;

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
            pipeline_version: self.definition.pipeline_version.clone(),
            owner: self.definition.owner.clone(),
            fallback_mode: self.definition.fallback_mode.clone(),
            provider_calls,
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
    use std::collections::HashMap;

    use chrono::Utc;
    use serde_json::json;

    use crate::contracts::{
        CandidateNewsMetadataPayload, RecommendationCandidatePayload, RecommendationStagePayload,
    };

    use super::build_ranking_summary;

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
}
