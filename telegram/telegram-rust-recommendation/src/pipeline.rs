use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Mutex;

use crate::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationResultPayload,
    RecommendationSelectorPayload, RecommendationStagePayload, RecommendationSummaryPayload,
};
use crate::recent_store::RecentHotStore;

const SOURCE_ORDER: [&str; 6] = [
    "FollowingSource",
    "GraphSource",
    "NewsAnnSource",
    "PopularSource",
    "TwoTowerSource",
    "ColdStartSource",
];

#[derive(Clone)]
pub struct RecommendationPipeline {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    recent_store: Arc<Mutex<RecentHotStore>>,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
    ) -> Self {
        Self {
            backend_client,
            config,
            recent_store,
        }
    }

    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        let mut stage_timings = HashMap::new();
        let mut stages = Vec::new();
        let mut source_counts = HashMap::new();
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

        let mut retrieved = Vec::<RecommendationCandidatePayload>::new();

        for source_name in SOURCE_ORDER {
            let source_response = self
                .backend_client
                .get_source_candidates(source_name, &hydrated_query)
                .await?;
            source_counts.insert(source_name.to_string(), source_response.candidates.len());
            accumulate_degraded_reasons(&source_response.stage, &mut degraded_reasons);
            accumulate_stage(&mut stages, &mut stage_timings, source_response.stage);
            retrieved.extend(source_response.candidates);
        }

        if self.config.recent_source_enabled && !hydrated_query.in_network_only {
            let recent_candidates = {
                let store = self.recent_store.lock().await;
                let existing_ids: HashSet<String> =
                    retrieved.iter().map(|candidate| candidate.post_id.clone()).collect();
                store.recent_hot_candidates(&hydrated_query, &existing_ids)
            };

            source_counts.insert("RecentHotStore".to_string(), recent_candidates.len());
            if !recent_candidates.is_empty() {
                let recent_stage = RecommendationStagePayload {
                    name: "RecentHotStore".to_string(),
                    enabled: true,
                    duration_ms: 0,
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

        let hydrate_response = self
            .backend_client
            .hydrate_candidates(&hydrated_query, &retrieved)
            .await?;
        let hydrated_candidates = hydrate_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            hydrate_response.stages,
        );

        let filter_response = self
            .backend_client
            .filter_candidates(&hydrated_query, &hydrated_candidates)
            .await?;
        merge_drop_counts(&mut filter_drop_counts, filter_response.drop_counts);
        let filtered_candidates = filter_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            filter_response.stages,
        );

        let score_response = self
            .backend_client
            .score_candidates(&hydrated_query, &filtered_candidates)
            .await?;
        let scored_candidates = score_response.candidates;
        append_stages(
            &mut stages,
            &mut stage_timings,
            &mut degraded_reasons,
            score_response.stages,
        );

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
            source_counts,
            filter_drop_counts,
            stage_timings,
            degraded_reasons,
            recent_hot_applied: self.config.recent_source_enabled && !hydrated_query.in_network_only,
            selector: RecommendationSelectorPayload {
                oversample_factor: self.config.selector_oversample_factor,
                max_size: self.config.selector_max_size,
                final_limit: hydrated_query.limit,
                truncated,
            },
            stages,
        };

        Ok(RecommendationResultPayload {
            request_id: hydrated_query.request_id,
            candidates: final_candidates,
            summary,
        })
    }
}

fn candidate_score(candidate: &RecommendationCandidatePayload) -> f64 {
    candidate
        .score
        .or(candidate.weighted_score)
        .or(candidate.pipeline_score)
        .unwrap_or_default()
}

fn selector_target_size(limit: usize, oversample_factor: usize, max_size: usize) -> usize {
    let base = limit.max(1);
    let oversampled = base.saturating_mul(oversample_factor.max(1));
    oversampled.min(max_size.max(1))
}

fn select_candidates(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    oversample_factor: usize,
    max_size: usize,
) -> Vec<RecommendationCandidatePayload> {
    let mut selected = candidates.to_vec();
    sort_candidates(&mut selected, query.in_network_only);
    selected.truncate(selector_target_size(query.limit, oversample_factor, max_size));
    selected
}

fn sort_candidates(candidates: &mut [RecommendationCandidatePayload], in_network_only: bool) {
    candidates.sort_by(|left, right| {
        if in_network_only {
            right.created_at.cmp(&left.created_at)
        } else {
            candidate_score(right)
                .partial_cmp(&candidate_score(left))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.created_at.cmp(&left.created_at))
        }
    });
}

fn merge_drop_counts(target: &mut HashMap<String, usize>, incoming: HashMap<String, usize>) {
    for (name, count) in incoming {
        *target.entry(name).or_insert(0) += count;
    }
}

fn append_stages(
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

fn accumulate_stage(
    target: &mut Vec<RecommendationStagePayload>,
    timings: &mut HashMap<String, u64>,
    stage: RecommendationStagePayload,
) {
    *timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
    target.push(stage);
}

fn accumulate_degraded_reasons(stage: &RecommendationStagePayload, degraded_reasons: &mut Vec<String>) {
    if let Some(detail) = stage.detail.as_ref() {
        if let Some(error) = detail.get("error").and_then(|value| value.as_str()) {
            degraded_reasons.push(format!("{}:{error}", stage.name));
        }
    }
}

fn dedup_strings(items: &mut Vec<String>) {
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.clone()));
}
