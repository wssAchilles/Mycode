use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::contracts::{
    RecommendationGraphRetrievalPayload, RecommendationQueryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationStagePayload, RetrievalResponse,
};

use super::contracts::{
    build_disabled_source_stage, classify_graph_retrieval, normalize_source_candidates,
};
use super::graph_source::GraphSourceRuntime;

const GRAPH_SOURCE_NAME: &str = "GraphSource";
const ML_RETRIEVAL_SOURCE_NAMES: &[&str] = &["NewsAnnSource", "TwoTowerSource"];

#[derive(Clone)]
pub struct RecommendationSourceOrchestrator {
    backend_client: BackendRecommendationClient,
    graph_source_runtime: GraphSourceRuntime,
    source_order: Vec<String>,
    graph_source_enabled: bool,
    source_concurrency: usize,
}

#[derive(Debug, Clone)]
struct SourceExecution {
    source_name: String,
    stage: RecommendationStagePayload,
    candidates: Vec<crate::contracts::RecommendationCandidatePayload>,
    provider_calls: HashMap<String, usize>,
}

impl RecommendationSourceOrchestrator {
    pub fn new(
        backend_client: BackendRecommendationClient,
        graph_source_runtime: GraphSourceRuntime,
        source_order: Vec<String>,
        graph_source_enabled: bool,
        source_concurrency: usize,
    ) -> Self {
        Self {
            backend_client,
            graph_source_runtime,
            source_order,
            graph_source_enabled,
            source_concurrency,
        }
    }

    pub async fn retrieve_candidates(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<RetrievalResponse> {
        let mut stages = Vec::new();
        let mut candidates = Vec::new();
        let mut source_counts = HashMap::new();
        let mut ml_source_counts = HashMap::new();
        let mut stage_timings = HashMap::new();
        let mut degraded_reasons = Vec::new();
        let mut provider_calls = HashMap::new();
        let mut graph_summary = RecommendationGraphRetrievalPayload {
            total_candidates: 0,
            kernel_candidates: 0,
            legacy_candidates: 0,
            fallback_used: false,
            empty_result: false,
            kernel_source_counts: HashMap::new(),
            dominant_kernel_source: None,
            empty_reason: None,
        };

        let source_results = self.retrieve_source_results(query).await?;

        for source_result in source_results {
            let SourceExecution {
                source_name,
                stage,
                candidates: source_candidates,
                provider_calls: source_provider_calls,
            } = source_result;
            for (provider_key, count) in source_provider_calls {
                *provider_calls.entry(provider_key).or_insert(0) += count;
            }
            record_stage(
                &mut stages,
                &mut stage_timings,
                &mut degraded_reasons,
                &stage,
            );
            source_counts.insert(source_name.clone(), source_candidates.len());

            if ML_RETRIEVAL_SOURCE_NAMES.contains(&source_name.as_str()) {
                ml_source_counts.insert(source_name.clone(), source_candidates.len());
            }

            if source_name == GRAPH_SOURCE_NAME && self.graph_source_enabled {
                let breakdown = classify_graph_retrieval(&source_candidates);
                graph_summary.total_candidates = breakdown.total_candidates;
                graph_summary.kernel_candidates = breakdown.kernel_candidates;
                graph_summary.legacy_candidates = breakdown.legacy_candidates;
                graph_summary.fallback_used = breakdown.fallback_used;
                graph_summary.empty_result = breakdown.empty_result;
                graph_summary.kernel_source_counts = breakdown.kernel_source_counts;
                graph_summary.dominant_kernel_source = breakdown.dominant_kernel_source;
                graph_summary.empty_reason = breakdown.empty_reason;

                if breakdown.fallback_used {
                    degraded_reasons.push("graph_source:legacy_fallback".to_string());
                }
                if breakdown.empty_result {
                    degraded_reasons.push("graph_source:empty_result".to_string());
                }
            }

            candidates.extend(source_candidates);
        }

        dedup_reasons(&mut degraded_reasons);

        Ok(RetrievalResponse {
            summary: RecommendationRetrievalSummaryPayload {
                stage: "source_parallel_graph_v3".to_string(),
                total_candidates: candidates.len(),
                in_network_candidates: candidates
                    .iter()
                    .filter(|candidate| candidate.in_network.unwrap_or(false))
                    .count(),
                out_of_network_candidates: candidates
                    .iter()
                    .filter(|candidate| !candidate.in_network.unwrap_or(false))
                    .count(),
                ml_retrieved_candidates: ml_source_counts.values().copied().sum(),
                recent_hot_candidates: 0,
                source_counts,
                ml_source_counts,
                stage_timings,
                degraded_reasons,
                graph: graph_summary,
            },
            provider_calls,
            candidates,
            stages,
        })
    }

    async fn retrieve_source_results(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<Vec<SourceExecution>> {
        let mut ordered_results = vec![None; self.source_order.len()];
        let semaphore = Arc::new(Semaphore::new(self.source_concurrency.max(1)));
        let mut join_set = JoinSet::new();

        for (index, source_name) in self.source_order.iter().enumerate() {
            if source_name == GRAPH_SOURCE_NAME {
                if !self.graph_source_enabled {
                    ordered_results[index] = Some(SourceExecution {
                        source_name: source_name.clone(),
                        stage: build_disabled_source_stage(
                            source_name,
                            "disabledByConfig",
                            "graph_source_disabled",
                        ),
                        candidates: Vec::new(),
                        provider_calls: HashMap::new(),
                    });
                    continue;
                }

                let graph_source_runtime = self.graph_source_runtime.clone();
                let query = query.clone();
                let source_name = source_name.clone();
                join_set.spawn(async move {
                    let response = graph_source_runtime.retrieve(&query).await?;
                    Ok::<_, anyhow::Error>((
                        index,
                        SourceExecution {
                            source_name: source_name.clone(),
                            stage: response.stage,
                            candidates: normalize_source_candidates(
                                &source_name,
                                response.candidates,
                            ),
                            provider_calls: response.provider_calls,
                        },
                    ))
                });
                continue;
            }

            let backend_client = self.backend_client.clone();
            let query = query.clone();
            let source_name = source_name.clone();
            let semaphore = semaphore.clone();
            join_set.spawn(async move {
                let _permit = semaphore.acquire_owned().await.expect("source semaphore");
                let response = backend_client
                    .source_candidates(&source_name, &query)
                    .await?;
                Ok::<_, anyhow::Error>((
                    index,
                    SourceExecution {
                        source_name: source_name.clone(),
                        stage: response.stage,
                        candidates: normalize_source_candidates(&source_name, response.candidates),
                        provider_calls: HashMap::from([(format!("sources/{source_name}"), 1)]),
                    },
                ))
            });
        }

        while let Some(joined) = join_set.join_next().await {
            let (index, source_execution) = joined
                .expect("source join task")
                .map_err(|error| anyhow::anyhow!("retrieve source execution failed: {error}"))?;
            ordered_results[index] = Some(source_execution);
        }

        Ok(ordered_results
            .into_iter()
            .flatten()
            .collect::<Vec<SourceExecution>>())
    }
}

fn record_stage(
    stages: &mut Vec<RecommendationStagePayload>,
    stage_timings: &mut HashMap<String, u64>,
    degraded_reasons: &mut Vec<String>,
    stage: &RecommendationStagePayload,
) {
    *stage_timings.entry(stage.name.clone()).or_insert(0) += stage.duration_ms;
    if let Some(error) = stage
        .detail
        .as_ref()
        .and_then(|detail| detail.get("error"))
        .and_then(|value| value.as_str())
    {
        degraded_reasons.push(format!("retrieval:{}:{error}", stage.name));
    }
    stages.push(stage.clone());
}

fn dedup_reasons(items: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.clone()));
}
