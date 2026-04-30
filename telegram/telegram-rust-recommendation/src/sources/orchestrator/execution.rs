use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::context::source_plan;
use crate::sources::contracts::{
    GraphRetrievalBreakdown, build_disabled_source_stage, build_failed_graph_breakdown,
    build_failed_source_stage, normalize_source_candidates,
};

use super::policy::apply_source_policy;
use super::stage_detail::source_batch_stage;
use super::{GRAPH_SOURCE_NAME, RecommendationSourceOrchestrator};

#[derive(Debug, Clone)]
pub(super) struct SourceExecution {
    pub(super) source_name: String,
    pub(super) stage: RecommendationStagePayload,
    pub(super) candidates: Vec<RecommendationCandidatePayload>,
    pub(super) provider_calls: HashMap<String, usize>,
    pub(super) provider_latency_ms: HashMap<String, u64>,
    pub(super) breakdown: GraphRetrievalBreakdown,
}

impl RecommendationSourceOrchestrator {
    pub(super) async fn retrieve_source_results(
        &self,
        query: &RecommendationQueryPayload,
        circuit_open_sources: &[String],
    ) -> Result<(Vec<SourceExecution>, HashMap<String, u64>)> {
        let mut ordered_results = vec![None; self.source_order.len()];
        let mut provider_latency_ms = HashMap::new();
        let circuit_open_sources = circuit_open_sources
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();

        let (graph_result, node_result) = tokio::join!(
            self.retrieve_graph_source_result(query, &circuit_open_sources),
            self.retrieve_node_source_results(query, &circuit_open_sources)
        );

        if let Some((index, source_execution)) = graph_result? {
            ordered_results[index] = Some(source_execution);
        }

        let (node_results, node_provider_latency_ms) = node_result?;
        for (provider_key, latency_ms) in node_provider_latency_ms {
            *provider_latency_ms.entry(provider_key).or_insert(0) += latency_ms;
        }
        for (index, source_execution) in node_results {
            ordered_results[index] = Some(source_execution);
        }

        Ok((
            ordered_results
                .into_iter()
                .flatten()
                .collect::<Vec<SourceExecution>>(),
            provider_latency_ms,
        ))
    }

    async fn retrieve_graph_source_result(
        &self,
        query: &RecommendationQueryPayload,
        circuit_open_sources: &HashSet<&str>,
    ) -> Result<Option<(usize, SourceExecution)>> {
        let Some((index, source_name)) = self
            .source_order
            .iter()
            .enumerate()
            .find(|(_, source_name)| source_name.as_str() == GRAPH_SOURCE_NAME)
            .map(|(index, source_name)| (index, source_name.clone()))
        else {
            return Ok(None);
        };

        let plan = source_plan(query, &source_name, usize::MAX);
        if !plan.enabled {
            return Ok(Some((
                index,
                build_disabled_source_execution(
                    &source_name,
                    plan.disabled_reason.unwrap_or("disabledByPolicy"),
                    "user_state_source_policy",
                ),
            )));
        }

        if !self.graph_source_enabled {
            return Ok(Some((
                index,
                build_disabled_source_execution(
                    &source_name,
                    "disabledByConfig",
                    "graph_source_disabled",
                ),
            )));
        }

        if circuit_open_sources.contains(source_name.as_str()) {
            return Ok(Some((
                index,
                build_circuit_disabled_source_execution(&source_name),
            )));
        }

        let started_at = Instant::now();
        let response = self.graph_source_runtime.retrieve(query).await;
        let source_execution = match response {
            Ok(response) => SourceExecution {
                source_name: source_name.clone(),
                stage: response.stage,
                candidates: normalize_source_candidates(&source_name, response.candidates),
                provider_calls: response.provider_calls,
                provider_latency_ms: response.provider_latency_ms,
                breakdown: response.breakdown,
            },
            Err(error) => build_failed_source_execution(
                &source_name,
                &error.to_string(),
                started_at.elapsed().as_millis() as u64,
            ),
        };

        Ok(Some((index, source_execution)))
    }

    async fn retrieve_node_source_results(
        &self,
        query: &RecommendationQueryPayload,
        circuit_open_sources: &HashSet<&str>,
    ) -> Result<(Vec<(usize, SourceExecution)>, HashMap<String, u64>)> {
        let source_entries = self
            .source_order
            .iter()
            .enumerate()
            .filter(|(_, source_name)| source_name.as_str() != GRAPH_SOURCE_NAME)
            .map(|(index, source_name)| (index, source_name.clone()))
            .collect::<Vec<_>>();

        if source_entries.is_empty() {
            return Ok((Vec::new(), HashMap::new()));
        }

        let (source_entries, circuit_disabled_entries): (Vec<_>, Vec<_>) = source_entries
            .into_iter()
            .partition(|(_, source_name)| !circuit_open_sources.contains(source_name.as_str()));
        let mut circuit_disabled_results = circuit_disabled_entries
            .into_iter()
            .map(|(index, source_name)| {
                (index, build_circuit_disabled_source_execution(&source_name))
            })
            .collect::<Vec<_>>();

        let mut enabled_entries = Vec::new();
        let mut disabled_results = Vec::new();
        for (index, source_name) in source_entries {
            let plan = source_plan(query, &source_name, usize::MAX);
            if plan.enabled {
                enabled_entries.push((index, source_name));
            } else {
                disabled_results.push((
                    index,
                    build_disabled_source_execution(
                        &source_name,
                        plan.disabled_reason.unwrap_or("disabledByPolicy"),
                        "user_state_source_policy",
                    ),
                ));
            }
        }
        let mut disabled_results = disabled_results;
        disabled_results.append(&mut circuit_disabled_results);

        if enabled_entries.is_empty() {
            return Ok((disabled_results, HashMap::new()));
        }

        let source_names = enabled_entries
            .iter()
            .map(|(_, source_name)| source_name.clone())
            .collect::<Vec<_>>();

        match self
            .backend_client
            .source_candidates_batch(&source_names, query)
            .await
        {
            Ok(response) => {
                let mut items_by_name = response
                    .payload
                    .items
                    .into_iter()
                    .map(|item| {
                        let provider_calls = response
                            .payload
                            .provider_calls
                            .get(&format!("sources/{}", item.source_name))
                            .copied()
                            .unwrap_or(1);
                        (
                            item.source_name.clone(),
                            SourceExecution {
                                source_name: item.source_name.clone(),
                                stage: source_batch_stage(
                                    item.stage,
                                    item.timed_out,
                                    item.timeout_ms,
                                    item.error_class,
                                ),
                                candidates: normalize_source_candidates(
                                    &item.source_name,
                                    item.candidates,
                                ),
                                provider_calls: HashMap::from([(
                                    format!("sources/{}", item.source_name),
                                    provider_calls,
                                )]),
                                provider_latency_ms: HashMap::new(),
                                breakdown: GraphRetrievalBreakdown::default(),
                            },
                        )
                    })
                    .collect::<HashMap<_, _>>();

                let mut ordered_results =
                    Vec::with_capacity(enabled_entries.len() + disabled_results.len());
                for (index, source_name) in enabled_entries {
                    let mut execution = items_by_name.remove(&source_name).unwrap_or_else(|| {
                        build_failed_source_execution(&source_name, "source_batch_missing_item", 0)
                    });
                    apply_source_policy(
                        query,
                        &source_name,
                        &mut execution.stage,
                        &mut execution.candidates,
                    );
                    ordered_results.push((index, execution));
                }
                ordered_results.extend(disabled_results);
                ordered_results.sort_by_key(|(index, _)| *index);

                Ok((
                    ordered_results,
                    HashMap::from([("sources/batch".to_string(), response.latency_ms)]),
                ))
            }
            Err(_) => {
                self.retrieve_node_source_results_individual(
                    query,
                    enabled_entries,
                    disabled_results,
                )
                .await
            }
        }
    }

    async fn retrieve_node_source_results_individual(
        &self,
        query: &RecommendationQueryPayload,
        source_entries: Vec<(usize, String)>,
        disabled_results: Vec<(usize, SourceExecution)>,
    ) -> Result<(Vec<(usize, SourceExecution)>, HashMap<String, u64>)> {
        let semaphore = Arc::new(Semaphore::new(self.source_concurrency.max(1)));
        let mut join_set = JoinSet::new();

        for (index, source_name) in source_entries {
            let backend_client = self.backend_client.clone();
            let query = query.clone();
            let semaphore = semaphore.clone();
            join_set.spawn(async move {
                let _permit = semaphore.acquire_owned().await.expect("source semaphore");
                let started_at = Instant::now();
                let response = backend_client.source_candidates(&source_name, &query).await;
                (
                    index,
                    source_name.clone(),
                    started_at.elapsed().as_millis() as u64,
                    response.map(|response| SourceExecution {
                        source_name: source_name.clone(),
                        stage: response.payload.stage,
                        candidates: normalize_source_candidates(
                            &source_name,
                            response.payload.candidates,
                        ),
                        provider_calls: HashMap::from([(format!("sources/{source_name}"), 1)]),
                        provider_latency_ms: HashMap::from([(
                            format!("sources/{source_name}"),
                            response.latency_ms,
                        )]),
                        breakdown: GraphRetrievalBreakdown::default(),
                    }),
                )
            });
        }

        let mut ordered_results = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            let (index, source_name, duration_ms, result) = joined.expect("source join task");
            let mut execution = match result {
                Ok(source_execution) => source_execution,
                Err(error) => {
                    build_failed_source_execution(&source_name, &error.to_string(), duration_ms)
                }
            };
            apply_source_policy(
                query,
                &source_name,
                &mut execution.stage,
                &mut execution.candidates,
            );
            ordered_results.push((index, execution));
        }

        ordered_results.extend(disabled_results);
        ordered_results.sort_by_key(|(index, _)| *index);
        Ok((ordered_results, HashMap::new()))
    }
}

pub(super) fn build_failed_source_execution(
    source_name: &str,
    error: &str,
    duration_ms: u64,
) -> SourceExecution {
    SourceExecution {
        source_name: source_name.to_string(),
        stage: build_failed_source_stage(source_name, error, duration_ms),
        candidates: Vec::new(),
        provider_calls: if source_name == GRAPH_SOURCE_NAME {
            HashMap::new()
        } else {
            HashMap::from([(format!("sources/{source_name}"), 1)])
        },
        provider_latency_ms: HashMap::new(),
        breakdown: if source_name == GRAPH_SOURCE_NAME {
            build_failed_graph_breakdown()
        } else {
            GraphRetrievalBreakdown::default()
        },
    }
}

fn build_disabled_source_execution(
    source_name: &str,
    reason: &str,
    policy: &str,
) -> SourceExecution {
    SourceExecution {
        source_name: source_name.to_string(),
        stage: build_disabled_source_stage(source_name, reason, policy),
        candidates: Vec::new(),
        provider_calls: HashMap::new(),
        provider_latency_ms: HashMap::new(),
        breakdown: GraphRetrievalBreakdown::default(),
    }
}

fn build_circuit_disabled_source_execution(source_name: &str) -> SourceExecution {
    build_disabled_source_execution(source_name, "disabledByCircuit", "rolling_component_health")
}
