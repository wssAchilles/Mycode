use std::collections::HashMap;

use anyhow::Result;

use crate::adapters::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationGraphRetrievalPayload, RecommendationQueryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationStagePayload, RetrievalResponse,
};

use super::contracts::{
    build_disabled_source_stage, classify_graph_retrieval, normalize_source_candidates,
};

const GRAPH_SOURCE_NAME: &str = "GraphSource";
const ML_RETRIEVAL_SOURCE_NAMES: &[&str] = &["NewsAnnSource", "TwoTowerSource"];

#[derive(Clone)]
pub struct RecommendationSourceOrchestrator {
    backend_client: BackendRecommendationClient,
    source_order: Vec<String>,
    graph_source_enabled: bool,
}

impl RecommendationSourceOrchestrator {
    pub fn new(backend_client: BackendRecommendationClient, config: &RecommendationConfig) -> Self {
        Self {
            backend_client,
            source_order: config.source_order.clone(),
            graph_source_enabled: config.graph_source_enabled,
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
        let mut graph_summary = RecommendationGraphRetrievalPayload {
            total_candidates: 0,
            kernel_candidates: 0,
            legacy_candidates: 0,
            fallback_used: false,
            empty_result: false,
        };

        for source_name in &self.source_order {
            let stage_and_candidates =
                if source_name == GRAPH_SOURCE_NAME && !self.graph_source_enabled {
                    (
                        build_disabled_source_stage(
                            source_name,
                            "disabledByConfig",
                            "graph_source_disabled",
                        ),
                        Vec::new(),
                    )
                } else {
                    let response = self
                        .backend_client
                        .source_candidates(source_name, query)
                        .await?;
                    (
                        response.stage,
                        normalize_source_candidates(source_name, response.candidates),
                    )
                };

            let (stage, source_candidates) = stage_and_candidates;
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
                stage: "source_orchestrated_graph_v1".to_string(),
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
            candidates,
            stages,
        })
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
