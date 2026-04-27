use std::collections::{HashMap, HashSet};
use std::future::Future;

use anyhow::Result;

use crate::clients::graph_kernel_client::{GraphKernelClient, GraphKernelQueryResult};
use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::sources::contracts::GraphKernelTelemetry;

use super::authors::{
    GraphKernelAuthorAggregate, aggregate_graph_kernel_authors, apply_graph_metadata,
};
use super::materialization::{MaterializerRetryDetail, MaterializerTelemetry};
use super::{
    DEFAULT_BRIDGE_LIMIT, DEFAULT_BRIDGE_MAX_DEPTH, DEFAULT_DIRECT_LIMIT, GraphSourceRuntime,
};

#[derive(Debug, Clone)]
pub(super) struct DirectGraphCandidatesResult {
    pub(super) candidates: Vec<RecommendationCandidatePayload>,
    pub(super) provider_calls: HashMap<String, usize>,
    pub(super) provider_latency_ms: HashMap<String, u64>,
    pub(super) query_errors: Vec<String>,
    pub(super) fallback_reason: Option<String>,
    pub(super) telemetry: GraphKernelTelemetry,
    pub(super) materializer_retry: MaterializerRetryDetail,
    pub(super) materializer_telemetry: MaterializerTelemetry,
}

#[derive(Debug, Clone)]
struct GraphKernelQueryOutcome<T> {
    label: &'static str,
    result: Option<GraphKernelQueryResult<T>>,
    error: Option<String>,
}

struct GraphAuthorQueryResult {
    author_aggregates: Vec<GraphKernelAuthorAggregate>,
    provider_calls: HashMap<String, usize>,
    query_errors: Vec<String>,
    telemetry: GraphKernelTelemetry,
}

impl GraphSourceRuntime {
    pub(super) async fn retrieve_direct_candidates(
        &self,
        graph_kernel_client: GraphKernelClient,
        query: &RecommendationQueryPayload,
    ) -> Result<DirectGraphCandidatesResult> {
        let mut graph_queries = query_graph_kernel_authors(graph_kernel_client, query).await;
        if graph_queries.author_aggregates.is_empty() {
            return Ok(DirectGraphCandidatesResult {
                candidates: Vec::new(),
                provider_calls: graph_queries.provider_calls,
                provider_latency_ms: HashMap::new(),
                query_errors: graph_queries.query_errors,
                fallback_reason: Some(classify_empty_kernel_reason(&graph_queries.telemetry)),
                telemetry: graph_queries.telemetry,
                materializer_retry: MaterializerRetryDetail::default(),
                materializer_telemetry: MaterializerTelemetry::default(),
            });
        }

        let author_ids = graph_queries
            .author_aggregates
            .iter()
            .map(|aggregate| aggregate.user_id.clone())
            .collect::<Vec<_>>();
        let author_lookup = graph_queries
            .author_aggregates
            .iter()
            .enumerate()
            .map(|(index, aggregate)| (aggregate.user_id.clone(), (index, aggregate.clone())))
            .collect::<HashMap<_, _>>();
        let materialized = self.materialize_graph_author_candidates(&author_ids).await;
        merge_provider_maps(
            &mut graph_queries.provider_calls,
            materialized.provider_calls,
        );

        let provider_latency_ms = materialized.provider_latency_ms;
        if let Some(fallback_reason) = materialized.fallback_reason {
            return Ok(DirectGraphCandidatesResult {
                candidates: Vec::new(),
                provider_calls: graph_queries.provider_calls,
                provider_latency_ms,
                query_errors: graph_queries.query_errors,
                fallback_reason: Some(fallback_reason),
                telemetry: graph_queries.telemetry,
                materializer_retry: materialized.retry,
                materializer_telemetry: materialized.telemetry,
            });
        }

        let mut candidates = materialized
            .candidates
            .into_iter()
            .filter_map(|candidate| {
                let (rank, aggregate) = author_lookup.get(&candidate.author_id)?.clone();
                Some(apply_graph_metadata(candidate, &aggregate, rank))
            })
            .collect::<Vec<_>>();
        sort_graph_candidates(&mut candidates);

        if candidates.is_empty() {
            return Ok(DirectGraphCandidatesResult {
                candidates,
                provider_calls: graph_queries.provider_calls,
                provider_latency_ms,
                query_errors: graph_queries.query_errors,
                fallback_reason: Some(if materialized.retry.applied {
                    "authors_materialized_empty_after_retry".to_string()
                } else {
                    "authors_materialized_empty".to_string()
                }),
                telemetry: graph_queries.telemetry,
                materializer_retry: materialized.retry,
                materializer_telemetry: materialized.telemetry,
            });
        }

        Ok(DirectGraphCandidatesResult {
            candidates,
            provider_calls: graph_queries.provider_calls,
            provider_latency_ms,
            query_errors: graph_queries.query_errors,
            fallback_reason: None,
            telemetry: graph_queries.telemetry,
            materializer_retry: materialized.retry,
            materializer_telemetry: materialized.telemetry,
        })
    }
}

async fn query_graph_kernel_authors(
    graph_kernel_client: GraphKernelClient,
    query: &RecommendationQueryPayload,
) -> GraphAuthorQueryResult {
    let excluded_user_ids = collect_excluded_user_ids(query);
    let user_id = query.user_id.clone();

    let social_future = capture_query(
        "social-neighbors",
        graph_kernel_client.social_neighbors(&user_id, DEFAULT_DIRECT_LIMIT, &excluded_user_ids),
    );
    let recent_future = capture_query(
        "recent-engagers",
        graph_kernel_client.recent_engagers(&user_id, DEFAULT_DIRECT_LIMIT, &excluded_user_ids),
    );
    let bridge_future = capture_query(
        "bridge-users",
        graph_kernel_client.bridge_users(
            &user_id,
            DEFAULT_BRIDGE_LIMIT,
            DEFAULT_BRIDGE_MAX_DEPTH,
            &excluded_user_ids,
        ),
    );
    let co_future = capture_query(
        "co-engagers",
        graph_kernel_client.co_engagers(&user_id, DEFAULT_DIRECT_LIMIT, &excluded_user_ids),
    );
    let content_future = capture_query(
        "content-affinity-neighbors",
        graph_kernel_client.content_affinity_neighbors(
            &user_id,
            DEFAULT_DIRECT_LIMIT,
            &excluded_user_ids,
        ),
    );

    let (social, recent, bridge, co, content) = tokio::join!(
        social_future,
        recent_future,
        bridge_future,
        co_future,
        content_future
    );

    let mut provider_calls = HashMap::new();
    let mut query_errors = Vec::new();
    let mut telemetry = GraphKernelTelemetry::default();
    let social = record_graph_query(
        social,
        &mut provider_calls,
        &mut query_errors,
        &mut telemetry,
    );
    let recent = record_graph_query(
        recent,
        &mut provider_calls,
        &mut query_errors,
        &mut telemetry,
    );
    let bridge = record_graph_query(
        bridge,
        &mut provider_calls,
        &mut query_errors,
        &mut telemetry,
    );
    let co = record_graph_query(co, &mut provider_calls, &mut query_errors, &mut telemetry);
    let content = record_graph_query(
        content,
        &mut provider_calls,
        &mut query_errors,
        &mut telemetry,
    );

    GraphAuthorQueryResult {
        author_aggregates: aggregate_graph_kernel_authors(&social, &recent, &bridge, &co, &content),
        provider_calls,
        query_errors,
        telemetry,
    }
}

fn merge_provider_maps(target: &mut HashMap<String, usize>, source: HashMap<String, usize>) {
    for (provider, count) in source {
        *target.entry(provider).or_insert(0) += count;
    }
}

fn sort_graph_candidates(candidates: &mut [RecommendationCandidatePayload]) {
    candidates.sort_by(|left, right| {
        let left_rank = left
            .score_breakdown
            .as_ref()
            .and_then(|item| item.get("graphKernelRank"))
            .copied()
            .unwrap_or(f64::MAX);
        let right_rank = right
            .score_breakdown
            .as_ref()
            .and_then(|item| item.get("graphKernelRank"))
            .copied()
            .unwrap_or(f64::MAX);

        left_rank
            .partial_cmp(&right_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.created_at.cmp(&left.created_at))
    });
}

async fn capture_query<T>(
    label: &'static str,
    future: impl Future<Output = Result<GraphKernelQueryResult<T>>>,
) -> GraphKernelQueryOutcome<T> {
    match future.await {
        Ok(result) => GraphKernelQueryOutcome {
            label,
            result: Some(result),
            error: None,
        },
        Err(error) => GraphKernelQueryOutcome {
            label,
            result: None,
            error: Some(error.to_string()),
        },
    }
}

fn record_graph_query<T>(
    outcome: GraphKernelQueryOutcome<T>,
    provider_calls: &mut HashMap<String, usize>,
    query_errors: &mut Vec<String>,
    telemetry: &mut GraphKernelTelemetry,
) -> Vec<T> {
    let kernel_key = normalize_kernel_key(outcome.label);
    *provider_calls
        .entry(format!("graph_kernel/{kernel_key}"))
        .or_insert(0) += 1;
    if let Some(error) = outcome.error {
        query_errors.push(format!("{kernel_key}:{error}"));
        telemetry
            .per_kernel_errors
            .insert(kernel_key.to_string(), error);
        return Vec::new();
    }

    let Some(result) = outcome.result else {
        return Vec::new();
    };

    if let Some(diagnostics) = result.diagnostics.as_ref() {
        telemetry
            .per_kernel_candidate_counts
            .insert(kernel_key.to_string(), diagnostics.candidate_count);
        telemetry
            .per_kernel_requested_limits
            .insert(kernel_key.to_string(), diagnostics.requested_limit);
        telemetry
            .per_kernel_available_counts
            .insert(kernel_key.to_string(), diagnostics.available_count);
        telemetry
            .per_kernel_returned_counts
            .insert(kernel_key.to_string(), diagnostics.candidate_count);
        telemetry
            .per_kernel_truncated_counts
            .insert(kernel_key.to_string(), diagnostics.truncated_count);
        telemetry
            .per_kernel_latency_ms
            .insert(kernel_key.to_string(), diagnostics.query_duration_ms);
        if diagnostics.budget_exhausted
            && !telemetry
                .budget_exhausted_kernels
                .iter()
                .any(|value| value == kernel_key)
        {
            telemetry
                .budget_exhausted_kernels
                .push(kernel_key.to_string());
        }
        if diagnostics.empty {
            telemetry.per_kernel_empty_reasons.insert(
                kernel_key.to_string(),
                diagnostics
                    .empty_reason
                    .clone()
                    .unwrap_or_else(|| default_empty_reason_for_kernel(kernel_key)),
            );
        }
    }

    result.candidates
}

fn normalize_kernel_key(label: &str) -> &'static str {
    match label {
        "social-neighbors" => "social_neighbors",
        "recent-engagers" => "recent_engagers",
        "bridge-users" => "bridge_users",
        "co-engagers" => "co_engagers",
        "content-affinity-neighbors" => "content_affinity_neighbors",
        _ => "unknown_kernel",
    }
}

fn default_empty_reason_for_kernel(kernel_key: &str) -> String {
    match kernel_key {
        "social_neighbors" => "no_social_neighbors",
        "recent_engagers" => "no_recent_engagers",
        "bridge_users" => "no_bridge_users",
        "co_engagers" => "no_co_engagers",
        "content_affinity_neighbors" => "no_content_affinity_neighbors",
        _ => "no_candidates",
    }
    .to_string()
}

fn classify_empty_kernel_reason(telemetry: &GraphKernelTelemetry) -> String {
    const EXPECTED_KERNELS: usize = 5;
    if telemetry.per_kernel_errors.len() >= EXPECTED_KERNELS {
        return "all_kernels_failed".to_string();
    }
    if !telemetry.per_kernel_errors.is_empty() {
        return "partial_kernel_failure".to_string();
    }
    "all_kernels_empty".to_string()
}

fn collect_excluded_user_ids(query: &RecommendationQueryPayload) -> Vec<String> {
    let mut excluded = HashSet::from([query.user_id.clone()]);
    if let Some(user_features) = query.user_features.as_ref() {
        for blocked_user_id in &user_features.blocked_user_ids {
            let trimmed = blocked_user_id.trim();
            if !trimmed.is_empty() {
                excluded.insert(trimmed.to_string());
            }
        }
    }

    excluded.into_iter().collect()
}
