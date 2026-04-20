use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::time::Instant;

use anyhow::Result;
use serde_json::Value;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::clients::graph_kernel_client::{
    GraphKernelBridgeCandidate, GraphKernelClient, GraphKernelNeighborCandidate,
    GraphKernelQueryResult,
};
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::contracts::{
    GraphKernelTelemetry, GraphRetrievalBreakdown, classify_graph_retrieval,
    normalize_source_candidates,
};

const GRAPH_SOURCE_NAME: &str = "GraphSource";
const DEFAULT_DIRECT_LIMIT: usize = 48;
const DEFAULT_BRIDGE_LIMIT: usize = 100;
const DEFAULT_BRIDGE_MAX_DEPTH: usize = 3;
const MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS: usize = 180;
const MATERIALIZER_RETRY_MIN_LOOKBACK_DAYS: usize = 30;
const MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR: usize = 8;

#[derive(Debug, Clone)]
pub struct GraphSourceRuntime {
    backend_client: BackendRecommendationClient,
    graph_kernel_client: Option<GraphKernelClient>,
    materializer_limit_per_author: usize,
    materializer_lookback_days: usize,
}

#[derive(Debug, Clone)]
pub struct GraphSourceExecution {
    pub stage: RecommendationStagePayload,
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub provider_calls: HashMap<String, usize>,
    pub breakdown: GraphRetrievalBreakdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum GraphKernelSourceKind {
    SocialNeighbor,
    RecentEngager,
    BridgeUser,
    CoEngager,
    ContentAffinity,
}

#[derive(Debug, Clone)]
struct GraphKernelAuthorAggregate {
    user_id: String,
    total_score: f64,
    dominant_score: f64,
    dominant_kind: GraphKernelSourceKind,
    source_kinds: HashSet<GraphKernelSourceKind>,
    relation_kinds: HashSet<String>,
    via_user_ids: HashSet<String>,
}

#[derive(Debug, Clone)]
struct GraphKernelQueryOutcome<T> {
    label: &'static str,
    result: Option<GraphKernelQueryResult<T>>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct DirectGraphCandidatesResult {
    candidates: Vec<RecommendationCandidatePayload>,
    provider_calls: HashMap<String, usize>,
    query_errors: Vec<String>,
    fallback_reason: Option<String>,
    telemetry: GraphKernelTelemetry,
    materializer_retry: MaterializerRetryDetail,
}

#[derive(Debug, Clone, Default)]
struct MaterializerRetryDetail {
    applied: bool,
    recovered: bool,
    lookback_days: Option<usize>,
    limit_per_author: Option<usize>,
}

impl GraphSourceRuntime {
    pub fn new(
        backend_client: BackendRecommendationClient,
        graph_kernel_client: Option<GraphKernelClient>,
        materializer_limit_per_author: usize,
        materializer_lookback_days: usize,
    ) -> Self {
        Self {
            backend_client,
            graph_kernel_client,
            materializer_limit_per_author,
            materializer_lookback_days,
        }
    }

    pub async fn retrieve(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Result<GraphSourceExecution> {
        let start = Instant::now();
        let Some(graph_kernel_client) = self.graph_kernel_client.clone() else {
            return self
                .fallback_to_backend(
                    query,
                    start,
                    Some("graph_kernel_disabled".to_string()),
                    HashMap::new(),
                    GraphKernelTelemetry::default(),
                    MaterializerRetryDetail::default(),
                )
                .await;
        };

        let direct = self
            .retrieve_direct_candidates(graph_kernel_client, query)
            .await?;

        if direct.candidates.is_empty() {
            return self
                .fallback_to_backend(
                    query,
                    start,
                    direct.fallback_reason,
                    direct.provider_calls,
                    direct.telemetry,
                    direct.materializer_retry,
                )
                .await;
        }

        let breakdown =
            classify_graph_retrieval(&direct.candidates, false, &direct.telemetry, None);
        let mut detail = build_graph_source_detail(
            "cpp_graph_kernel_primary",
            "node_graph_author_provider",
            &direct.telemetry,
            &direct.query_errors,
            None,
            None,
            &breakdown,
        );
        insert_materializer_retry_detail(&mut detail, &direct.materializer_retry);

        if !direct.query_errors.is_empty() {
            detail.insert(
                "error".to_string(),
                Value::String("graph_kernel_partial_failure".to_string()),
            );
            detail.insert(
                "queryErrors".to_string(),
                Value::Array(
                    direct
                        .query_errors
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }

        Ok(GraphSourceExecution {
            stage: RecommendationStagePayload {
                name: GRAPH_SOURCE_NAME.to_string(),
                enabled: true,
                duration_ms: start.elapsed().as_millis() as u64,
                input_count: 1,
                output_count: direct.candidates.len(),
                removed_count: None,
                detail: Some(detail),
            },
            candidates: direct.candidates,
            provider_calls: direct.provider_calls,
            breakdown,
        })
    }

    async fn fallback_to_backend(
        &self,
        query: &RecommendationQueryPayload,
        start: Instant,
        fallback_reason: Option<String>,
        mut provider_calls: HashMap<String, usize>,
        telemetry: GraphKernelTelemetry,
        materializer_retry: MaterializerRetryDetail,
    ) -> Result<GraphSourceExecution> {
        let mut response = self
            .backend_client
            .source_candidates(GRAPH_SOURCE_NAME, query)
            .await?;
        *provider_calls
            .entry("sources/GraphSource".to_string())
            .or_insert(0) += 1;

        let normalized_candidates =
            normalize_source_candidates(GRAPH_SOURCE_NAME, response.candidates);
        let fallback_reason_for_breakdown = fallback_reason.clone();
        let breakdown = classify_graph_retrieval(
            &normalized_candidates,
            true,
            &telemetry,
            fallback_reason_for_breakdown.as_deref(),
        );
        let mut detail = response.stage.detail.take().unwrap_or_default();
        detail.extend(build_graph_source_detail(
            "node_provider_surface",
            "node_graph_author_provider",
            &telemetry,
            &[],
            Some("cpp_graph_kernel_primary"),
            fallback_reason.as_deref(),
            &breakdown,
        ));
        insert_materializer_retry_detail(&mut detail, &materializer_retry);

        Ok(GraphSourceExecution {
            stage: RecommendationStagePayload {
                name: response.stage.name,
                enabled: response.stage.enabled,
                duration_ms: start.elapsed().as_millis() as u64,
                input_count: response.stage.input_count,
                output_count: response.stage.output_count,
                removed_count: response.stage.removed_count,
                detail: Some(detail),
            },
            candidates: normalized_candidates,
            provider_calls,
            breakdown,
        })
    }

    async fn retrieve_direct_candidates(
        &self,
        graph_kernel_client: GraphKernelClient,
        query: &RecommendationQueryPayload,
    ) -> Result<DirectGraphCandidatesResult> {
        let excluded_user_ids = collect_excluded_user_ids(query);
        let user_id = query.user_id.clone();

        let social_future = capture_query(
            "social-neighbors",
            graph_kernel_client.social_neighbors(
                &user_id,
                DEFAULT_DIRECT_LIMIT,
                &excluded_user_ids,
            ),
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

        let author_aggregates =
            aggregate_graph_kernel_authors(&social, &recent, &bridge, &co, &content);
        if author_aggregates.is_empty() {
            return Ok(DirectGraphCandidatesResult {
                candidates: Vec::new(),
                provider_calls,
                query_errors,
                fallback_reason: Some(classify_empty_kernel_reason(&telemetry)),
                telemetry,
                materializer_retry: MaterializerRetryDetail::default(),
            });
        }

        let author_ids = author_aggregates
            .iter()
            .map(|aggregate| aggregate.user_id.clone())
            .collect::<Vec<_>>();
        let author_lookup = author_aggregates
            .iter()
            .enumerate()
            .map(|(index, aggregate)| (aggregate.user_id.clone(), (index, aggregate.clone())))
            .collect::<HashMap<_, _>>();

        let mut materializer_retry = MaterializerRetryDetail::default();
        let mut materialized = match self
            .backend_client
            .graph_author_candidates(
                &author_ids,
                self.materializer_limit_per_author,
                self.materializer_lookback_days,
            )
            .await
        {
            Ok(candidates) => {
                *provider_calls
                    .entry("providers/graph/authors".to_string())
                    .or_insert(0) += 1;
                candidates
            }
            Err(_error) => {
                return Ok(DirectGraphCandidatesResult {
                    candidates: Vec::new(),
                    provider_calls,
                    query_errors,
                    fallback_reason: Some("graph_author_materializer_failed".to_string()),
                    telemetry,
                    materializer_retry,
                });
            }
        };

        if materialized.is_empty() {
            let retry_limit_per_author = (self.materializer_limit_per_author.max(2) * 2)
                .min(MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR);
            let retry_lookback_days = (self.materializer_lookback_days.max(7) * 6)
                .max(MATERIALIZER_RETRY_MIN_LOOKBACK_DAYS)
                .min(MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS);
            materializer_retry.applied = true;
            materializer_retry.lookback_days = Some(retry_lookback_days);
            materializer_retry.limit_per_author = Some(retry_limit_per_author);

            match self
                .backend_client
                .graph_author_candidates(&author_ids, retry_limit_per_author, retry_lookback_days)
                .await
            {
                Ok(retry_candidates) => {
                    *provider_calls
                        .entry("providers/graph/authors_retry".to_string())
                        .or_insert(0) += 1;
                    materializer_retry.recovered = !retry_candidates.is_empty();
                    materialized = retry_candidates;
                }
                Err(_error) => {
                    return Ok(DirectGraphCandidatesResult {
                        candidates: Vec::new(),
                        provider_calls,
                        query_errors,
                        fallback_reason: Some("graph_author_materializer_retry_failed".to_string()),
                        telemetry,
                        materializer_retry,
                    });
                }
            }
        }

        let mut candidates = materialized
            .into_iter()
            .filter_map(|candidate| {
                let (rank, aggregate) = author_lookup.get(&candidate.author_id)?.clone();
                Some(apply_graph_metadata(candidate, &aggregate, rank))
            })
            .collect::<Vec<_>>();

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

        if candidates.is_empty() {
            return Ok(DirectGraphCandidatesResult {
                candidates,
                provider_calls,
                query_errors,
                fallback_reason: Some(if materializer_retry.applied {
                    "authors_materialized_empty_after_retry".to_string()
                } else {
                    "authors_materialized_empty".to_string()
                }),
                telemetry,
                materializer_retry,
            });
        }

        Ok(DirectGraphCandidatesResult {
            candidates,
            provider_calls,
            query_errors,
            fallback_reason: None,
            telemetry,
            materializer_retry,
        })
    }
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

fn build_graph_source_detail(
    provider: &str,
    materializer: &str,
    telemetry: &GraphKernelTelemetry,
    query_errors: &[String],
    fallback_from: Option<&str>,
    fallback_reason: Option<&str>,
    breakdown: &GraphRetrievalBreakdown,
) -> HashMap<String, Value> {
    let mut detail = HashMap::from([
        ("provider".to_string(), Value::String(provider.to_string())),
        (
            "materializer".to_string(),
            Value::String(materializer.to_string()),
        ),
        (
            "perKernelCandidateCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_candidate_counts),
        ),
        (
            "perKernelRequestedLimits".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_requested_limits),
        ),
        (
            "perKernelAvailableCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_available_counts),
        ),
        (
            "perKernelReturnedCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_returned_counts),
        ),
        (
            "perKernelTruncatedCounts".to_string(),
            hash_map_usize_to_json(&telemetry.per_kernel_truncated_counts),
        ),
        (
            "perKernelLatencyMs".to_string(),
            hash_map_u64_to_json(&telemetry.per_kernel_latency_ms),
        ),
        (
            "perKernelEmptyReasons".to_string(),
            hash_map_string_to_json(&telemetry.per_kernel_empty_reasons),
        ),
        (
            "perKernelErrors".to_string(),
            hash_map_string_to_json(&telemetry.per_kernel_errors),
        ),
        (
            "budgetExhaustedKernels".to_string(),
            Value::Array(
                telemetry
                    .budget_exhausted_kernels
                    .iter()
                    .cloned()
                    .map(Value::String)
                    .collect(),
            ),
        ),
    ]);

    if let Some(source) = breakdown.dominant_kernel_source.as_ref() {
        detail.insert(
            "dominantKernelSource".to_string(),
            Value::String(source.clone()),
        );
    }
    if let Some(share) = breakdown.dominance_share {
        detail.insert("dominanceShare".to_string(), Value::from(share));
    }
    if let Some(reason) = breakdown.empty_reason.as_ref() {
        detail.insert("graphReason".to_string(), Value::String(reason.clone()));
    }
    if !query_errors.is_empty() {
        detail.insert(
            "queryErrors".to_string(),
            Value::Array(query_errors.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(fallback_from) = fallback_from {
        detail.insert(
            "fallbackFrom".to_string(),
            Value::String(fallback_from.to_string()),
        );
    }
    if let Some(fallback_reason) = fallback_reason.filter(|value| !value.trim().is_empty()) {
        detail.insert(
            "fallbackReason".to_string(),
            Value::String(fallback_reason.to_string()),
        );
    }

    detail
}

fn insert_materializer_retry_detail(
    detail: &mut HashMap<String, Value>,
    retry: &MaterializerRetryDetail,
) {
    detail.insert(
        "materializerRetryApplied".to_string(),
        Value::Bool(retry.applied),
    );
    detail.insert(
        "materializerRetryRecovered".to_string(),
        Value::Bool(retry.recovered),
    );
    if let Some(lookback_days) = retry.lookback_days {
        detail.insert(
            "materializerRetryLookbackDays".to_string(),
            Value::from(lookback_days as u64),
        );
    }
    if let Some(limit_per_author) = retry.limit_per_author {
        detail.insert(
            "materializerRetryLimitPerAuthor".to_string(),
            Value::from(limit_per_author as u64),
        );
    }
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

fn hash_map_usize_to_json(values: &HashMap<String, usize>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value as u64)))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

fn hash_map_u64_to_json(values: &HashMap<String, u64>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value)))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
}

fn hash_map_string_to_json(values: &HashMap<String, String>) -> Value {
    let object = values
        .iter()
        .map(|(key, value)| (key.clone(), Value::String(value.clone())))
        .collect::<serde_json::Map<String, Value>>();
    Value::Object(object)
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

fn aggregate_graph_kernel_authors(
    social_neighbors: &[GraphKernelNeighborCandidate],
    recent_engagers: &[GraphKernelNeighborCandidate],
    bridge_users: &[GraphKernelBridgeCandidate],
    co_engagers: &[GraphKernelNeighborCandidate],
    content_affinity_neighbors: &[GraphKernelNeighborCandidate],
) -> Vec<GraphKernelAuthorAggregate> {
    let mut author_aggregates = HashMap::new();

    for candidate in social_neighbors {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score
                + candidate.engagement_score.unwrap_or(0.0) * 0.25
                + candidate.recentness_score.unwrap_or(0.0) * 0.05,
            GraphKernelSourceKind::SocialNeighbor,
            &candidate.relation_kinds,
            &[],
        );
    }

    for candidate in recent_engagers {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score * 0.2
                + candidate.engagement_score.unwrap_or(0.0) * 0.45
                + candidate.recentness_score.unwrap_or(0.0) * 0.45,
            GraphKernelSourceKind::RecentEngager,
            &candidate.relation_kinds,
            &[],
        );
    }

    for candidate in bridge_users {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.bridge_strength.unwrap_or(candidate.score),
            GraphKernelSourceKind::BridgeUser,
            &[],
            &candidate.via_user_ids,
        );
    }

    for candidate in co_engagers {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score * 0.65
                + candidate.engagement_score.unwrap_or(0.0) * 0.25
                + candidate.recentness_score.unwrap_or(0.0) * 0.1,
            GraphKernelSourceKind::CoEngager,
            &candidate.relation_kinds,
            &[],
        );
    }

    for candidate in content_affinity_neighbors {
        upsert_graph_kernel_author(
            &mut author_aggregates,
            &candidate.user_id,
            candidate.score * 0.55
                + candidate.engagement_score.unwrap_or(0.0) * 0.15
                + candidate.recentness_score.unwrap_or(0.0) * 0.3,
            GraphKernelSourceKind::ContentAffinity,
            &candidate.relation_kinds,
            &[],
        );
    }

    let mut ranked = author_aggregates.into_values().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .total_score
            .partial_cmp(&left.total_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                right
                    .dominant_score
                    .partial_cmp(&left.dominant_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    ranked.truncate(DEFAULT_BRIDGE_LIMIT.max(32));
    ranked
}

fn upsert_graph_kernel_author(
    target: &mut HashMap<String, GraphKernelAuthorAggregate>,
    user_id: &str,
    score: f64,
    source_kind: GraphKernelSourceKind,
    relation_kinds: &[String],
    via_user_ids: &[String],
) {
    let aggregate =
        target
            .entry(user_id.to_string())
            .or_insert_with(|| GraphKernelAuthorAggregate {
                user_id: user_id.to_string(),
                total_score: 0.0,
                dominant_score: f64::NEG_INFINITY,
                dominant_kind: source_kind.clone(),
                source_kinds: HashSet::new(),
                relation_kinds: HashSet::new(),
                via_user_ids: HashSet::new(),
            });

    aggregate.total_score += score;
    aggregate.source_kinds.insert(source_kind.clone());
    if score > aggregate.dominant_score {
        aggregate.dominant_score = score;
        aggregate.dominant_kind = source_kind;
    }

    for relation_kind in relation_kinds {
        let trimmed = relation_kind.trim();
        if !trimmed.is_empty() {
            aggregate.relation_kinds.insert(trimmed.to_string());
        }
    }

    for via_user_id in via_user_ids {
        let trimmed = via_user_id.trim();
        if !trimmed.is_empty() {
            aggregate.via_user_ids.insert(trimmed.to_string());
        }
    }
}

fn apply_graph_metadata(
    mut candidate: RecommendationCandidatePayload,
    aggregate: &GraphKernelAuthorAggregate,
    rank: usize,
) -> RecommendationCandidatePayload {
    let source_kinds = sorted_source_kinds(&aggregate.source_kinds);
    let relation_kinds = sorted_strings(&aggregate.relation_kinds);
    let via_user_ids = sorted_strings(&aggregate.via_user_ids);
    let graph_recall_type = if source_kinds.len() > 1 {
        "cpp_graph_multi_signal".to_string()
    } else {
        map_graph_kernel_source_kind(&aggregate.dominant_kind).to_string()
    };

    let mut graph_path_parts = vec![
        format!(
            "signals:{}",
            source_kinds
                .iter()
                .map(|kind| map_graph_kernel_source_kind(kind))
                .collect::<Vec<_>>()
                .join("|")
        ),
        format!(
            "dominant:{}",
            map_graph_kernel_source_kind(&aggregate.dominant_kind)
        ),
    ];
    if !relation_kinds.is_empty() {
        graph_path_parts.push(format!("relations:{}", relation_kinds.join("|")));
    }
    if !via_user_ids.is_empty() {
        graph_path_parts.push(format!("via_users:{}", via_user_ids.join("|")));
    }

    candidate.in_network = Some(false);
    candidate.recall_source = Some("GraphKernelSource".to_string());
    candidate.graph_score = Some(aggregate.total_score);
    candidate.graph_path = Some(graph_path_parts.join(";"));
    candidate.graph_recall_type = Some(graph_recall_type);
    candidate.score = Some(aggregate.total_score);
    candidate.pipeline_score = Some(aggregate.total_score);
    candidate.score_breakdown = Some(HashMap::from([
        ("graphKernelRank".to_string(), rank as f64),
        ("graphKernelScore".to_string(), aggregate.total_score),
    ]));
    candidate
}

fn sorted_source_kinds(
    source_kinds: &HashSet<GraphKernelSourceKind>,
) -> Vec<GraphKernelSourceKind> {
    let mut items = source_kinds.iter().cloned().collect::<Vec<_>>();
    items.sort_by_key(|item| map_graph_kernel_source_kind(item));
    items
}

fn sorted_strings(items: &HashSet<String>) -> Vec<String> {
    let mut sorted = items.iter().cloned().collect::<Vec<_>>();
    sorted.sort();
    sorted
}

fn map_graph_kernel_source_kind(source_kind: &GraphKernelSourceKind) -> &'static str {
    match source_kind {
        GraphKernelSourceKind::SocialNeighbor => "cpp_graph_social_neighbor",
        GraphKernelSourceKind::RecentEngager => "cpp_graph_recent_engager",
        GraphKernelSourceKind::BridgeUser => "cpp_graph_bridge_user",
        GraphKernelSourceKind::CoEngager => "cpp_graph_co_engager",
        GraphKernelSourceKind::ContentAffinity => "cpp_graph_content_affinity",
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use chrono::{DateTime, Utc};

    use super::{
        GraphKernelAuthorAggregate, GraphKernelSourceKind, aggregate_graph_kernel_authors,
        apply_graph_metadata, map_graph_kernel_source_kind,
    };
    use crate::clients::graph_kernel_client::{
        GraphKernelBridgeCandidate, GraphKernelNeighborCandidate,
    };
    use crate::contracts::RecommendationCandidatePayload;

    fn candidate(author_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: "content".to_string(),
            created_at: DateTime::parse_from_rfc3339("2026-04-18T00:00:00Z")
                .expect("valid timestamp")
                .with_timezone(&Utc),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
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
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn aggregate_graph_kernel_authors_combines_multi_signal_scores() {
        let ranked = aggregate_graph_kernel_authors(
            &[GraphKernelNeighborCandidate {
                user_id: "author-1".to_string(),
                score: 8.0,
                interaction_probability: None,
                engagement_score: Some(6.0),
                recentness_score: Some(0.4),
                relation_kinds: vec!["follow".to_string(), "reply".to_string()],
            }],
            &[GraphKernelNeighborCandidate {
                user_id: "author-1".to_string(),
                score: 3.0,
                interaction_probability: None,
                engagement_score: Some(7.0),
                recentness_score: Some(0.9),
                relation_kinds: vec!["recent_activity".to_string()],
            }],
            &[GraphKernelBridgeCandidate {
                user_id: "author-2".to_string(),
                score: 4.0,
                depth: 2,
                path_count: 3,
                via_user_ids: vec!["bridge-a".to_string(), "bridge-b".to_string()],
                bridge_strength: Some(6.5),
                via_user_count: Some(2),
            }],
            &[],
            &[],
        );

        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].user_id, "author-1");
        assert!(ranked[0].total_score > ranked[1].total_score);
        assert!(
            ranked[0]
                .source_kinds
                .contains(&GraphKernelSourceKind::SocialNeighbor)
        );
        assert!(
            ranked[0]
                .source_kinds
                .contains(&GraphKernelSourceKind::RecentEngager)
        );
        assert!(ranked[1].via_user_ids.contains("bridge-a"));
    }

    #[test]
    fn apply_graph_metadata_marks_multi_signal_candidates() {
        let aggregate = GraphKernelAuthorAggregate {
            user_id: "author-1".to_string(),
            total_score: 12.4,
            dominant_score: 9.5,
            dominant_kind: GraphKernelSourceKind::SocialNeighbor,
            source_kinds: HashSet::from([
                GraphKernelSourceKind::SocialNeighbor,
                GraphKernelSourceKind::RecentEngager,
            ]),
            relation_kinds: HashSet::from([
                "reply".to_string(),
                "follow".to_string(),
                "recent_activity".to_string(),
            ]),
            via_user_ids: HashSet::new(),
        };

        let candidate = apply_graph_metadata(candidate("author-1"), &aggregate, 0);

        assert_eq!(
            candidate.recall_source.as_deref(),
            Some("GraphKernelSource")
        );
        assert_eq!(
            candidate.graph_recall_type.as_deref(),
            Some("cpp_graph_multi_signal")
        );
        assert_eq!(candidate.graph_score, Some(12.4));
        assert!(
            candidate
                .graph_path
                .as_deref()
                .is_some_and(|path| path.contains(map_graph_kernel_source_kind(
                    &GraphKernelSourceKind::SocialNeighbor
                )))
        );
        assert!(
            candidate
                .graph_path
                .as_deref()
                .is_some_and(|path| path.contains("relations:follow|recent_activity|reply"))
        );
    }
}
