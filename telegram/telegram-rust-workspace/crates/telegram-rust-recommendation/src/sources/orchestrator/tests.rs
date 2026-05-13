use axum::{
    Json, Router,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use telegram_pipeline_primitives::{
    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
    PIPELINE_STAGE_KIND_SOURCE, PIPELINE_STAGE_KIND_SOURCE_MERGE,
    RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
    RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2, source_provider_key,
};
use telegram_rust_http_types::SuccessEnvelope;
use telegram_source_primitives::{
    RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD, SOURCE_LANE_MERGE_STAGE_NAME,
    SOURCE_STAGE_CANDIDATE_COUNT_FIELD, SOURCE_STAGE_CONTRACT_VERSION,
    SOURCE_STAGE_CONTRACT_VERSION_FIELD, SOURCE_STAGE_EXECUTION_OUTCOME_FIELD,
    SOURCE_STAGE_OUTCOME_DISABLED, SOURCE_STAGE_OUTCOME_FAILED, SOURCE_STAGE_OUTCOME_SUCCESS,
    SOURCE_STAGE_OUTCOME_SUCCESS_EMPTY, SOURCE_STAGE_RETRIEVAL_LANE_FIELD,
    SOURCE_STAGE_SOURCE_NAME_FIELD, source_merge_detail_contract_violations,
};
use tokio::{net::TcpListener, task::JoinHandle, time::Duration};

use crate::{
    clients::backend_client::BackendRecommendationClient,
    config::RecommendationConfig,
    contracts::{
        EmbeddingContextPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
        RecommendationStagePayload, SourceCandidatesResponse, SparseEmbeddingEntryPayload,
        UserStateContextPayload,
    },
    sources::graph_source::GraphSourceRuntime,
};

use super::{
    GRAPH_SOURCE_NAME, RecommendationSourceOrchestrator, build_failed_source_execution,
    merge_source_candidates,
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
        stage: RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2.to_string(),
        retrieval_mode: RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2.to_string(),
        ranking_mode: RANKING_MODE_PHOENIX_STANDARDIZED.to_string(),
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
        news_trends_cache_enabled: true,
        news_trends_cache_ttl_secs: 60,
        news_trends_cache_prefix: "news:trends:rust:v1".to_string(),
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
        embedding_context: None,
        user_state_context: None,
        user_action_sequence: None,
        news_history_external_ids: None,
        model_user_action_sequence: None,
        experiment_context: None,
        ranking_policy: None,
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
        retrieval_lane: None,
        interest_pool_kind: None,
        secondary_recall_sources: None,
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
        action_scores: None,
        ranking_signals: None,
        recall_evidence: None,
        selection_pool: None,
        selection_reason: None,
        score_contract_version: None,
        score_breakdown_version: None,
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

fn assert_source_output_does_not_write_ranking_owned_fields(
    candidates: &[RecommendationCandidatePayload],
) {
    for candidate in candidates {
        assert!(
            candidate.weighted_score.is_none(),
            "source output must not write weighted_score for {}",
            candidate.post_id
        );
        assert!(
            candidate.phoenix_scores.is_none(),
            "source output must not write phoenix_scores for {}",
            candidate.post_id
        );
        assert!(
            candidate.action_scores.is_none(),
            "source output must not write action_scores for {}",
            candidate.post_id
        );
        assert!(
            candidate.ranking_signals.is_none(),
            "source output must not write ranking_signals for {}",
            candidate.post_id
        );
        assert!(
            candidate.score_contract_version.is_none(),
            "source output must not write score_contract_version for {}",
            candidate.post_id
        );
        assert!(
            candidate.score_breakdown_version.is_none(),
            "source output must not write score_breakdown_version for {}",
            candidate.post_id
        );
    }
}

async fn source_handler(Path(source_name): Path<String>) -> Response {
    match source_name.as_str() {
        "FollowingSource" => {
            tokio::time::sleep(Duration::from_millis(40)).await;
            Json(SuccessEnvelope::ok(SourceCandidatesResponse {
                source_name: source_name.clone(),
                candidates: vec![fixture_candidate(
                    "post-following",
                    "author-following",
                    "FollowingSource",
                )],
                stage: fixture_stage("FollowingSource", 40, 1),
                timed_out: false,
                timeout_ms: None,
                error_class: None,
            }))
            .into_response()
        }
        "PopularSource" => {
            tokio::time::sleep(Duration::from_millis(5)).await;
            (StatusCode::BAD_GATEWAY, "popular_source_failed").into_response()
        }
        "NewsAnnSource" => {
            tokio::time::sleep(Duration::from_millis(10)).await;
            Json(SuccessEnvelope::ok(SourceCandidatesResponse {
                source_name: source_name.clone(),
                candidates: vec![fixture_candidate(
                    "post-news",
                    "author-news",
                    "NewsAnnSource",
                )],
                stage: fixture_stage("NewsAnnSource", 10, 1),
                timed_out: false,
                timeout_ms: None,
                error_class: None,
            }))
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

async fn empty_source_handler(Path(source_name): Path<String>) -> Response {
    match source_name.as_str() {
        "FollowingSource" => Json(SuccessEnvelope::ok(SourceCandidatesResponse {
            source_name: source_name.clone(),
            candidates: Vec::new(),
            stage: fixture_stage("FollowingSource", 5, 0),
            timed_out: false,
            timeout_ms: None,
            error_class: None,
        }))
        .into_response(),
        _ => (StatusCode::NOT_FOUND, "unknown_source").into_response(),
    }
}

async fn spawn_empty_source_server() -> (String, JoinHandle<()>) {
    let app = Router::new().route("/sources/{source_name}", post(empty_source_handler));
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind fake empty source provider");
    let address = listener
        .local_addr()
        .expect("read fake empty source provider addr");
    let handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("serve fake empty source provider");
    });
    (format!("http://{address}"), handle)
}

#[tokio::test]
async fn keeps_retrieval_alive_when_one_source_fails_and_preserves_source_order() {
    let (base_url, server_handle) = spawn_source_server().await;
    let config = fixture_config(base_url);
    let backend_client = BackendRecommendationClient::new(&config).expect("build backend client");
    let orchestrator = RecommendationSourceOrchestrator::new(
        backend_client.clone(),
        GraphSourceRuntime::new(backend_client, None, 2, 7),
        config.source_order.clone(),
        false,
        4,
    );
    let mut query = fixture_query();
    query.user_state_context = Some(UserStateContextPayload {
        state: "warm".to_string(),
        reason: "test".to_string(),
        followed_count: 4,
        recent_action_count: 6,
        recent_positive_action_count: 3,
        usable_embedding: false,
        account_age_days: Some(14),
    });

    let response = orchestrator
        .retrieve_candidates(&query, &[])
        .await
        .expect("retrieve candidates with partial source failure");

    server_handle.abort();
    let _ = server_handle.await;

    assert_eq!(response.summary.stage, "source_parallel_lane_merge_v6");
    assert_eq!(response.candidates.len(), 1);
    assert_eq!(
        response
            .candidates
            .iter()
            .map(|candidate| candidate.post_id.as_str())
            .collect::<Vec<_>>(),
        vec!["post-following"]
    );
    assert_source_output_does_not_write_ranking_owned_fields(&response.candidates);
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
        Some(&0)
    );
    assert_eq!(
        response
            .summary
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_SUCCESS),
        Some(&1)
    );
    assert_eq!(
        response
            .summary
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_FAILED),
        Some(&1)
    );
    assert_eq!(
        response
            .summary
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_DISABLED),
        Some(&1)
    );
    assert_eq!(
        response.summary.source_failure_counts.get("PopularSource"),
        Some(&1)
    );
    assert_eq!(
        response.summary.source_disabled_counts.get("NewsAnnSource"),
        Some(&1)
    );
    assert_eq!(response.summary.lane_counts.get("in_network"), Some(&1));
    assert_eq!(response.summary.lane_counts.get("interest"), None);
    assert!(response.summary.degraded_reasons.iter().any(|reason| {
        reason.starts_with("retrieval:PopularSource:backend_recommendation_request_failed")
    }));
    assert_eq!(
        response
            .provider_calls
            .get(&source_provider_key("FollowingSource")),
        Some(&1)
    );
    assert_eq!(
        response
            .provider_calls
            .get(&source_provider_key("PopularSource")),
        Some(&1)
    );
    assert_eq!(
        response
            .provider_calls
            .get(&source_provider_key("NewsAnnSource")),
        None
    );

    let following_stage = response
        .stages
        .iter()
        .find(|stage| stage.name == "FollowingSource")
        .expect("FollowingSource stage");
    let detail = following_stage
        .detail
        .as_ref()
        .expect("source stage detail");
    assert_eq!(
        detail.get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD),
        Some(&serde_json::json!("FollowingSource"))
    );
    assert_eq!(
        detail.get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD),
        Some(&serde_json::json!(PIPELINE_STAGE_KIND_SOURCE))
    );
    assert_eq!(
        detail.get(SOURCE_STAGE_CONTRACT_VERSION_FIELD),
        Some(&serde_json::json!(SOURCE_STAGE_CONTRACT_VERSION))
    );
    assert_eq!(
        detail.get(SOURCE_STAGE_SOURCE_NAME_FIELD),
        Some(&serde_json::json!("FollowingSource"))
    );
    assert_eq!(
        detail.get(SOURCE_STAGE_CANDIDATE_COUNT_FIELD),
        Some(&serde_json::json!(1))
    );
    assert_eq!(
        detail.get(SOURCE_STAGE_RETRIEVAL_LANE_FIELD),
        Some(&serde_json::json!("in_network"))
    );
    assert_eq!(
        detail.get(SOURCE_STAGE_EXECUTION_OUTCOME_FIELD),
        Some(&serde_json::json!(SOURCE_STAGE_OUTCOME_SUCCESS))
    );

    let popular_stage = response
        .stages
        .iter()
        .find(|stage| stage.name == "PopularSource")
        .expect("PopularSource failure stage");
    assert_eq!(
        popular_stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get(SOURCE_STAGE_EXECUTION_OUTCOME_FIELD)),
        Some(&serde_json::json!(SOURCE_STAGE_OUTCOME_FAILED))
    );

    let lane_merge_stage = response
        .stages
        .iter()
        .find(|stage| stage.name == SOURCE_LANE_MERGE_STAGE_NAME)
        .expect("LaneMerge stage");
    let lane_merge_detail = lane_merge_stage
        .detail
        .as_ref()
        .expect("lane merge stage detail");
    assert_eq!(
        lane_merge_detail.get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD),
        Some(&serde_json::json!(SOURCE_LANE_MERGE_STAGE_NAME))
    );
    assert_eq!(
        lane_merge_detail.get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD),
        Some(&serde_json::json!(PIPELINE_STAGE_KIND_SOURCE_MERGE))
    );
    assert_eq!(lane_merge_stage.input_count, 1);
    assert_eq!(lane_merge_stage.output_count, 1);
    assert!(source_merge_detail_contract_violations(Some(lane_merge_detail)).is_empty());
}

#[tokio::test]
async fn classifies_empty_source_success_without_failure_or_disabled_counts() {
    let (base_url, server_handle) = spawn_empty_source_server().await;
    let mut config = fixture_config(base_url);
    config.source_order = vec!["FollowingSource".to_string()];
    let backend_client = BackendRecommendationClient::new(&config).expect("build backend client");
    let orchestrator = RecommendationSourceOrchestrator::new(
        backend_client.clone(),
        GraphSourceRuntime::new(backend_client, None, 2, 7),
        config.source_order.clone(),
        false,
        4,
    );

    let response = orchestrator
        .retrieve_candidates(&fixture_query(), &[])
        .await
        .expect("retrieve empty source candidates");

    server_handle.abort();
    let _ = server_handle.await;

    assert!(response.candidates.is_empty());
    assert_eq!(
        response.summary.source_counts.get("FollowingSource"),
        Some(&0)
    );
    assert_eq!(
        response
            .summary
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_SUCCESS_EMPTY),
        Some(&1)
    );
    assert!(response.summary.source_failure_counts.is_empty());
    assert!(response.summary.source_disabled_counts.is_empty());
    assert!(response.summary.lane_counts.is_empty());
}

#[tokio::test]
async fn classifies_disabled_source_without_failure_or_lane_input() {
    let mut config = fixture_config("http://127.0.0.1:1".to_string());
    config.source_order = vec!["NewsAnnSource".to_string()];
    let backend_client = BackendRecommendationClient::new(&config).expect("build backend client");
    let orchestrator = RecommendationSourceOrchestrator::new(
        backend_client.clone(),
        GraphSourceRuntime::new(backend_client, None, 2, 7),
        config.source_order.clone(),
        false,
        4,
    );

    let response = orchestrator
        .retrieve_candidates(&fixture_query(), &[])
        .await
        .expect("retrieve disabled source candidates");

    assert!(response.candidates.is_empty());
    assert_eq!(
        response
            .summary
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_DISABLED),
        Some(&1)
    );
    assert_eq!(
        response.summary.source_disabled_counts.get("NewsAnnSource"),
        Some(&1)
    );
    assert!(response.summary.source_failure_counts.is_empty());
    assert!(response.summary.lane_counts.is_empty());
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

#[test]
fn lane_merge_deduplicates_multi_source_hits_and_preserves_secondary_evidence() {
    let mut query = fixture_query();
    query.user_state_context = Some(UserStateContextPayload {
        state: "sparse".to_string(),
        reason: "test".to_string(),
        followed_count: 12,
        recent_action_count: 6,
        recent_positive_action_count: 4,
        usable_embedding: true,
        account_age_days: Some(9),
    });
    query.embedding_context = Some(EmbeddingContextPayload {
        interested_in_clusters: vec![SparseEmbeddingEntryPayload {
            cluster_id: 9,
            score: 0.9,
        }],
        producer_embedding: vec![],
        known_for_cluster: None,
        known_for_score: None,
        quality_score: Some(0.8),
        computed_at: None,
        version: None,
        usable: true,
        stale: Some(false),
        ..EmbeddingContextPayload::default()
    });

    let following = fixture_candidate("shared-post", "author-1", "FollowingSource");
    let two_tower = fixture_candidate("shared-post", "author-1", "TwoTowerSource");
    let unique = fixture_candidate("unique-post", "author-2", "PopularSource");

    let (merged, lane_counts, detail) = merge_source_candidates(
        &query,
        vec![
            ("FollowingSource".to_string(), vec![following]),
            ("TwoTowerSource".to_string(), vec![two_tower]),
            ("PopularSource".to_string(), vec![unique]),
        ],
        &[
            "FollowingSource".to_string(),
            "TwoTowerSource".to_string(),
            "PopularSource".to_string(),
        ],
    );

    assert_eq!(merged.len(), 2);
    assert_source_output_does_not_write_ranking_owned_fields(&merged);
    let shared = merged
        .iter()
        .find(|candidate| candidate.post_id == "shared-post")
        .expect("shared candidate should be preserved");
    assert_eq!(shared.recall_source.as_deref(), Some("TwoTowerSource"));
    assert_eq!(shared.retrieval_lane.as_deref(), Some("interest"));
    assert_eq!(
        shared.secondary_recall_sources.as_ref(),
        Some(&vec!["FollowingSource".to_string()])
    );
    assert_eq!(
        shared
            .score_breakdown
            .as_ref()
            .and_then(|breakdown| breakdown.get(RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD))
            .copied(),
        Some(1.0)
    );
    let recall_evidence = shared
        .recall_evidence
        .as_ref()
        .expect("merged candidate should expose recall evidence");
    assert_eq!(recall_evidence.source_count, 2.0);
    assert_eq!(recall_evidence.cross_lane_source_count, 1.0);
    assert!(recall_evidence.confidence > 0.0);
    assert_eq!(lane_counts.get("interest"), Some(&1));
    assert_eq!(lane_counts.get("fallback"), Some(&1));
    assert_eq!(
        detail
            .get("duplicateRecallHits")
            .and_then(|value| value.as_u64()),
        Some(1)
    );
    assert!(source_merge_detail_contract_violations(Some(&detail)).is_empty());
}
