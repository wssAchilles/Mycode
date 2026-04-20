use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::contracts::{
    RecommendationGraphRetrievalPayload, RecommendationQueryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationStagePayload, RetrievalResponse,
};

use super::contracts::{
    GraphRetrievalBreakdown, build_disabled_source_stage, build_failed_graph_breakdown,
    build_failed_source_stage, normalize_source_candidates,
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
    breakdown: GraphRetrievalBreakdown,
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
            per_kernel_candidate_counts: HashMap::new(),
            per_kernel_requested_limits: HashMap::new(),
            per_kernel_available_counts: HashMap::new(),
            per_kernel_returned_counts: HashMap::new(),
            per_kernel_truncated_counts: HashMap::new(),
            per_kernel_latency_ms: HashMap::new(),
            per_kernel_empty_reasons: HashMap::new(),
            per_kernel_errors: HashMap::new(),
            budget_exhausted_kernels: Vec::new(),
            dominant_kernel_source: None,
            dominance_share: None,
            empty_reason: None,
        };

        let source_results = self.retrieve_source_results(query).await?;

        for source_result in source_results {
            let SourceExecution {
                source_name,
                stage,
                candidates: source_candidates,
                provider_calls: source_provider_calls,
                breakdown,
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
                graph_summary.total_candidates = breakdown.total_candidates;
                graph_summary.kernel_candidates = breakdown.kernel_candidates;
                graph_summary.legacy_candidates = breakdown.legacy_candidates;
                graph_summary.fallback_used = breakdown.fallback_used;
                graph_summary.empty_result = breakdown.empty_result;
                graph_summary.kernel_source_counts = breakdown.kernel_source_counts;
                graph_summary.per_kernel_candidate_counts = breakdown.per_kernel_candidate_counts;
                graph_summary.per_kernel_requested_limits = breakdown.per_kernel_requested_limits;
                graph_summary.per_kernel_available_counts = breakdown.per_kernel_available_counts;
                graph_summary.per_kernel_returned_counts = breakdown.per_kernel_returned_counts;
                graph_summary.per_kernel_truncated_counts = breakdown.per_kernel_truncated_counts;
                graph_summary.per_kernel_latency_ms = breakdown.per_kernel_latency_ms;
                graph_summary.per_kernel_empty_reasons = breakdown.per_kernel_empty_reasons;
                graph_summary.per_kernel_errors = breakdown.per_kernel_errors;
                graph_summary.budget_exhausted_kernels = breakdown.budget_exhausted_kernels;
                graph_summary.dominant_kernel_source = breakdown.dominant_kernel_source;
                graph_summary.dominance_share = breakdown.dominance_share;
                graph_summary.empty_reason = breakdown.empty_reason;

                match graph_summary.empty_reason.as_deref() {
                    Some("legacy_fallback_used") => {
                        degraded_reasons.push("graph_source:legacy_fallback".to_string());
                    }
                    Some("all_kernels_empty") => {
                        degraded_reasons.push("graph_source:all_kernels_empty".to_string());
                    }
                    Some("all_kernels_failed") => {
                        degraded_reasons.push("graph_source:all_kernels_failed".to_string());
                    }
                    Some("partial_kernel_failure") => {
                        degraded_reasons.push("graph_source:partial_kernel_failure".to_string());
                    }
                    Some("authors_materialized_empty") => {
                        degraded_reasons
                            .push("graph_source:authors_materialized_empty".to_string());
                    }
                    Some("authors_materialized_empty_after_retry") => {
                        degraded_reasons.push(
                            "graph_source:authors_materialized_empty_after_retry".to_string(),
                        );
                    }
                    Some("graph_author_materializer_failed") => {
                        degraded_reasons
                            .push("graph_source:graph_author_materializer_failed".to_string());
                    }
                    Some("graph_author_materializer_retry_failed") => {
                        degraded_reasons.push(
                            "graph_source:graph_author_materializer_retry_failed".to_string(),
                        );
                    }
                    _ => {}
                }
            }

            candidates.extend(source_candidates);
        }

        dedup_reasons(&mut degraded_reasons);

        Ok(RetrievalResponse {
            summary: RecommendationRetrievalSummaryPayload {
                stage: "source_parallel_graph_v5".to_string(),
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
                        breakdown: GraphRetrievalBreakdown::default(),
                    });
                    continue;
                }

                let graph_source_runtime = self.graph_source_runtime.clone();
                let query = query.clone();
                let source_name = source_name.clone();
                join_set.spawn(async move {
                    let started_at = Instant::now();
                    let response = graph_source_runtime.retrieve(&query).await;
                    (
                        index,
                        source_name.clone(),
                        started_at.elapsed().as_millis() as u64,
                        response.map(|response| SourceExecution {
                            source_name: source_name.clone(),
                            stage: response.stage,
                            candidates: normalize_source_candidates(
                                &source_name,
                                response.candidates,
                            ),
                            provider_calls: response.provider_calls,
                            breakdown: response.breakdown,
                        }),
                    )
                });
                continue;
            }

            let backend_client = self.backend_client.clone();
            let query = query.clone();
            let source_name = source_name.clone();
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
                        stage: response.stage,
                        candidates: normalize_source_candidates(&source_name, response.candidates),
                        provider_calls: HashMap::from([(format!("sources/{source_name}"), 1)]),
                        breakdown: GraphRetrievalBreakdown::default(),
                    }),
                )
            });
        }

        while let Some(joined) = join_set.join_next().await {
            let (index, source_name, duration_ms, result) = joined.expect("source join task");
            ordered_results[index] = Some(match result {
                Ok(source_execution) => source_execution,
                Err(error) => {
                    build_failed_source_execution(&source_name, &error.to_string(), duration_ms)
                }
            });
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

fn build_failed_source_execution(
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
        breakdown: if source_name == GRAPH_SOURCE_NAME {
            build_failed_graph_breakdown()
        } else {
            GraphRetrievalBreakdown::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Json, Router,
        extract::Path,
        http::StatusCode,
        response::{IntoResponse, Response},
        routing::post,
    };
    use chrono::{DateTime, Utc};
    use tokio::{net::TcpListener, task::JoinHandle, time::Duration};

    use crate::{
        clients::backend_client::BackendRecommendationClient,
        config::RecommendationConfig,
        contracts::{
            RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
            SourceCandidatesResponse, SuccessEnvelope,
        },
        sources::graph_source::GraphSourceRuntime,
    };

    use super::{
        GRAPH_SOURCE_NAME, RecommendationSourceOrchestrator, build_failed_source_execution,
    };

    fn fixture_config(base_url: String) -> RecommendationConfig {
        RecommendationConfig {
            bind_addr: "0.0.0.0:4200".to_string(),
            backend_url: base_url,
            redis_url: "redis://redis:6379".to_string(),
            internal_token: None,
            timeout_ms: 1200,
            graph_kernel_enabled: false,
            graph_kernel_url: "http://graph-kernel.invalid".to_string(),
            graph_kernel_timeout_ms: 500,
            graph_materializer_limit_per_author: 2,
            graph_materializer_lookback_days: 7,
            stage: "retrieval_ranking_v2".to_string(),
            retrieval_mode: "source_orchestrated_graph_v2".to_string(),
            ranking_mode: "phoenix_standardized".to_string(),
            selector_oversample_factor: 5,
            selector_max_size: 200,
            recent_per_user_capacity: 64,
            recent_global_capacity: 256,
            recent_source_enabled: true,
            source_order: vec![
                "FollowingSource".to_string(),
                "PopularSource".to_string(),
                "NewsAnnSource".to_string(),
            ],
            graph_source_enabled: false,
            serve_cache_enabled: true,
            serve_cache_ttl_secs: 45,
            serve_cache_prefix: "recommendation:serve:v1".to_string(),
            serving_author_soft_cap: 2,
        }
    }

    fn fixture_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-phase-33".to_string(),
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
        }
    }

    fn fixture_candidate(
        post_id: &str,
        author_id: &str,
        recall_source: &str,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: format!("content-{post_id}"),
            created_at: DateTime::parse_from_rfc3339("2026-04-17T00:00:00.000Z")
                .expect("valid timestamp")
                .with_timezone(&Utc),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(recall_source == "FollowingSource"),
            recall_source: Some(recall_source.to_string()),
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

    fn fixture_stage(
        source_name: &str,
        duration_ms: u64,
        output_count: usize,
    ) -> RecommendationStagePayload {
        RecommendationStagePayload {
            name: source_name.to_string(),
            enabled: true,
            duration_ms,
            input_count: 1,
            output_count,
            removed_count: None,
            detail: None,
        }
    }

    async fn source_handler(Path(source_name): Path<String>) -> Response {
        match source_name.as_str() {
            "FollowingSource" => {
                tokio::time::sleep(Duration::from_millis(40)).await;
                Json(SuccessEnvelope {
                    success: true,
                    data: SourceCandidatesResponse {
                        source_name: source_name.clone(),
                        candidates: vec![fixture_candidate(
                            "post-following",
                            "author-following",
                            "FollowingSource",
                        )],
                        stage: fixture_stage("FollowingSource", 40, 1),
                    },
                })
                .into_response()
            }
            "PopularSource" => {
                tokio::time::sleep(Duration::from_millis(5)).await;
                (StatusCode::BAD_GATEWAY, "popular_source_failed").into_response()
            }
            "NewsAnnSource" => {
                tokio::time::sleep(Duration::from_millis(10)).await;
                Json(SuccessEnvelope {
                    success: true,
                    data: SourceCandidatesResponse {
                        source_name: source_name.clone(),
                        candidates: vec![fixture_candidate(
                            "post-news",
                            "author-news",
                            "NewsAnnSource",
                        )],
                        stage: fixture_stage("NewsAnnSource", 10, 1),
                    },
                })
                .into_response()
            }
            _ => (StatusCode::NOT_FOUND, "unknown_source").into_response(),
        }
    }

    async fn spawn_source_server() -> (String, JoinHandle<()>) {
        let app = Router::new().route("/sources/{source_name}", post(source_handler));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake source provider");
        let address = listener
            .local_addr()
            .expect("read fake source provider addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve fake source provider");
        });
        (format!("http://{address}"), handle)
    }

    #[tokio::test]
    async fn keeps_retrieval_alive_when_one_source_fails_and_preserves_source_order() {
        let (base_url, server_handle) = spawn_source_server().await;
        let config = fixture_config(base_url);
        let backend_client =
            BackendRecommendationClient::new(&config).expect("build backend client");
        let orchestrator = RecommendationSourceOrchestrator::new(
            backend_client.clone(),
            GraphSourceRuntime::new(backend_client, None, 2, 7),
            config.source_order.clone(),
            false,
            4,
        );

        let response = orchestrator
            .retrieve_candidates(&fixture_query())
            .await
            .expect("retrieve candidates with partial source failure");

        server_handle.abort();
        let _ = server_handle.await;

        assert_eq!(response.summary.stage, "source_parallel_graph_v5");
        assert_eq!(response.candidates.len(), 2);
        assert_eq!(
            response
                .candidates
                .iter()
                .map(|candidate| candidate.post_id.as_str())
                .collect::<Vec<_>>(),
            vec!["post-following", "post-news"]
        );
        assert_eq!(
            response.summary.source_counts.get("FollowingSource"),
            Some(&1)
        );
        assert_eq!(
            response.summary.source_counts.get("PopularSource"),
            Some(&0)
        );
        assert_eq!(
            response.summary.source_counts.get("NewsAnnSource"),
            Some(&1)
        );
        assert!(response.summary.degraded_reasons.iter().any(|reason| {
            reason.starts_with("retrieval:PopularSource:backend_recommendation_request_failed")
        }));
        assert_eq!(
            response.provider_calls.get("sources/FollowingSource"),
            Some(&1)
        );
        assert_eq!(
            response.provider_calls.get("sources/PopularSource"),
            Some(&1)
        );
        assert_eq!(
            response.provider_calls.get("sources/NewsAnnSource"),
            Some(&1)
        );
    }

    #[test]
    fn builds_graph_source_fail_open_execution_with_machine_readable_breakdown() {
        let execution =
            build_failed_source_execution(GRAPH_SOURCE_NAME, "graph_materializer_failed", 27);

        assert_eq!(execution.source_name, GRAPH_SOURCE_NAME);
        assert_eq!(
            execution
                .stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("error"))
                .and_then(|value| value.as_str()),
            Some("graph_materializer_failed")
        );
        assert_eq!(
            execution.breakdown.empty_reason.as_deref(),
            Some("all_kernels_failed")
        );
        assert!(execution.breakdown.empty_result);
        assert!(execution.provider_calls.is_empty());
    }
}
