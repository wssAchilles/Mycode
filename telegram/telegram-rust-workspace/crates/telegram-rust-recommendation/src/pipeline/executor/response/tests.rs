use std::collections::HashMap;
use std::sync::Arc;

use chrono::{TimeZone, Utc};
use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;
use telegram_pipeline_primitives::{
    RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
    RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
};
use telegram_serving_primitives::{
    PAGE_BUILD_LATENCY_KEY, SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION,
};

use crate::candidate_pipeline::definition::build_pipeline_definition;
use crate::clients::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationGraphRetrievalPayload,
    RecommendationQueryPayload, RecommendationRankingSummaryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationStagePayload,
};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::builder::RecommendationPipelineBuilder;
use crate::state::recent_store::RecentHotStore;

use super::super::ranking_stage::RankingStageOutput;
use super::super::retrieval_stage::RetrievalStageOutput;
use super::super::serving_stage::ServingStageOutput;
use super::super::telemetry::RunTelemetry;
use super::{
    LiveRecommendationResultInput, build_live_recommendation_result,
    build_ranked_cursor_abstention_result,
};

#[test]
fn builds_live_result_and_records_selection_degradation() {
    let config = test_config();
    let definition = build_pipeline_definition(&config);
    let query = RecommendationQueryPayload {
        request_id: "req-response".to_string(),
        decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 2,
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
        user_signal_features: None,
        interested_topics: None,
        mutual_follow_ids: None,
        demographics: None,
        feature_switches: HashMap::new(),
        past_request_timestamps: Vec::new(),
        impressed_post_ids: Vec::new(),
        subscribed_user_ids: Vec::new(),
    };
    let candidate = candidate("post-1");
    let next_cursor = candidate.created_at;

    let mut telemetry = RunTelemetry::default();
    telemetry.add_stage(RecommendationStagePayload {
        name: RUST_TOP_K_SELECTOR.to_string(),
        enabled: true,
        duration_ms: 3,
        input_count: 1,
        output_count: 1,
        removed_count: Some(0),
        detail: Some(HashMap::from([(
            "selectorSelectionMode".to_string(),
            serde_json::Value::String("policy_state_machine".to_string()),
        )])),
    });

    let result = build_live_recommendation_result(LiveRecommendationResultInput {
        config: &config,
        definition: &definition,
        hydrated_query: &query,
        retrieval: RetrievalStageOutput {
            retrieved: vec![candidate.clone()],
            retrieved_count: 1,
            retrieval_summary: RecommendationRetrievalSummaryPayload {
                stage: "test_retrieval".to_string(),
                total_candidates: 1,
                in_network_candidates: 0,
                out_of_network_candidates: 1,
                ml_retrieved_candidates: 0,
                recent_hot_candidates: 0,
                source_counts: HashMap::new(),
                source_outcome_counts: HashMap::new(),
                source_failure_counts: HashMap::new(),
                source_disabled_counts: HashMap::new(),
                lane_counts: HashMap::new(),
                ml_source_counts: HashMap::new(),
                stage_timings: HashMap::new(),
                degraded_reasons: Vec::new(),
                graph: RecommendationGraphRetrievalPayload::default(),
            },
        },
        ranking: RankingStageOutput {
            scored_candidates: vec![candidate.clone()],
            ranking_summary: RecommendationRankingSummaryPayload {
                stage: "test_ranking".to_string(),
                input_candidates: 1,
                hydrated_candidates: 1,
                filtered_candidates: 1,
                scored_candidates: 1,
                ml_eligible_candidates: 0,
                ml_ranked_candidates: 0,
                weighted_candidates: 1,
                stage_timings: HashMap::new(),
                filter_drop_counts: HashMap::new(),
                degraded_reasons: Vec::new(),
            },
        },
        serving: ServingStageOutput {
            final_candidates: vec![candidate],
            duplicate_suppressed_count: 0,
            cross_page_duplicate_count: 0,
            has_more: true,
            page_remaining_count: 1,
            page_underfilled: true,
            page_underfill_reason: Some("under_limit".to_string()),
            suppression_reasons: HashMap::new(),
            truncated: true,
            next_cursor: Some(next_cursor),
            stable_order_key: "stable-key".to_string(),
        },
        telemetry,
        page_build_duration_ms: 17,
    });

    assert_eq!(result.request_id, "req-response");
    assert_eq!(result.candidates.len(), 1);
    assert!(!result.has_more);
    assert!(result.next_cursor.is_none());
    assert!(!result.summary.serving.has_more);
    assert_eq!(result.summary.serving.page_remaining_count, 1);
    assert_eq!(
        result.summary.serving.cursor_mode,
        "ranked_cursor_abstention_v1"
    );
    assert_eq!(result.summary.selected_count, 1);
    assert_eq!(
        result.summary.stage_latency_ms.get(PAGE_BUILD_LATENCY_KEY),
        Some(&17)
    );
    assert!(
        result
            .summary
            .degraded_reasons
            .contains(&"underfilled_selection".to_string())
    );
    assert!(
        result
            .summary
            .degraded_reasons
            .contains(&"ranked_cursor_abstention".to_string())
    );
    assert_eq!(
        result.summary.serving.cache_policy_reason,
        SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION
    );
    assert!(result.summary.trace.is_some());
    assert!(result.summary.selector.selector_report.is_some());
    assert!(
        result
            .summary
            .selector
            .selector_report_unavailable_reason
            .is_none()
    );
}

#[test]
fn builds_terminal_ranked_cursor_abstention_without_running_pipeline_stages() {
    let config = test_config();
    let definition = build_pipeline_definition(&config);
    let cursor = Utc.with_ymd_and_hms(2026, 7, 15, 0, 0, 0).unwrap();
    let query = RecommendationQueryPayload {
        request_id: "req-ranked-cursor-abstention".to_string(),
        decision_id: "00000000-0000-4000-8000-0000000000ab".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 20,
        cursor: Some(cursor),
        in_network_only: false,
        ..RecommendationQueryPayload::default()
    };

    let result = build_ranked_cursor_abstention_result(&config, &definition, &query, 5);

    assert!(result.candidates.is_empty());
    assert_eq!(result.cursor, Some(cursor));
    assert!(result.next_cursor.is_none());
    assert!(!result.has_more);
    assert_eq!(
        result.summary.serving.cursor_mode,
        "ranked_cursor_abstention_v1"
    );
    assert_eq!(result.summary.retrieved_count, 0);
    assert_eq!(result.summary.selected_count, 0);
    assert!(result.summary.provider_calls.is_empty());
    assert!(result.summary.stages.is_empty());
    assert!(
        result
            .summary
            .degraded_reasons
            .contains(&"ranked_cursor_abstention".to_string())
    );
    assert!(
        !result
            .summary
            .degraded_reasons
            .contains(&"empty_selection".to_string())
    );
}

#[tokio::test]
async fn executor_abstains_before_cache_and_provider_work() {
    let mut config = test_config();
    config.backend_url = "http://127.0.0.1:1".to_string();
    config.redis_url = "redis://127.0.0.1:1".to_string();
    config.timeout_ms = 50;
    let recent_store = Arc::new(RecentHotStore::new_sharded(
        config.recent_per_user_capacity,
        config.recent_global_capacity,
        config.recent_hot_shard_count,
    ));
    let metrics = Arc::new(tokio::sync::Mutex::new(RecommendationMetrics::default()));
    let backend_client = BackendRecommendationClient::new(&config).expect("build backend client");
    let pipeline =
        RecommendationPipelineBuilder::new(backend_client, config, recent_store, metrics).build();
    let before = pipeline.cache_control_plane_snapshot().serve_cache;
    let query = RecommendationQueryPayload {
        request_id: "req-executor-ranked-cursor-abstention".to_string(),
        decision_id: "00000000-0000-4000-8000-0000000000ac".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 20,
        cursor: Some(Utc.with_ymd_and_hms(2026, 7, 15, 0, 0, 0).unwrap()),
        in_network_only: false,
        ..RecommendationQueryPayload::default()
    };

    let result = pipeline
        .run(query)
        .await
        .expect("terminal abstention result");
    let after = pipeline.cache_control_plane_snapshot().serve_cache;

    assert!(result.candidates.is_empty());
    assert!(result.summary.provider_calls.is_empty());
    assert!(result.summary.stages.is_empty());
    assert_eq!(
        result.summary.serving.cursor_mode,
        "ranked_cursor_abstention_v1"
    );
    assert_eq!(
        (
            after.local_hit_count,
            after.local_miss_count,
            after.shared_hit_count,
            after.shared_miss_count,
        ),
        (
            before.local_hit_count,
            before.local_miss_count,
            before.shared_hit_count,
            before.shared_miss_count,
        )
    );
}

#[test]
fn selector_report_contract_returns_unavailable_reason_when_stage_missing() {
    let contract = super::selector_report_contract(&[]);

    assert!(contract.report.is_none());
    assert_eq!(
        contract.unavailable_reason.as_deref(),
        Some("selector_stage_missing")
    );
}

fn test_config() -> RecommendationConfig {
    RecommendationConfig {
        bind_addr: "0.0.0.0:4200".to_string(),
        backend_url: "http://backend:5000/internal/recommendation".to_string(),
        redis_url: "redis://redis:6379".to_string(),
        internal_token: None,
        timeout_ms: 9000,
        graph_kernel_enabled: true,
        graph_kernel_url: "http://graph_kernel:4300".to_string(),
        graph_kernel_timeout_ms: 1200,
        graph_materializer_limit_per_author: 2,
        graph_materializer_lookback_days: 7,
        stage: RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2.to_string(),
        retrieval_mode: RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2.to_string(),
        ranking_mode: RANKING_MODE_PHOENIX_STANDARDIZED.to_string(),
        selector_oversample_factor: 5,
        selector_max_size: 200,
        recent_per_user_capacity: 64,
        recent_global_capacity: 256,
        recent_hot_shard_count: 16,
        recent_source_enabled: true,
        source_order: vec![
            "FollowingSource".to_string(),
            "GraphSource".to_string(),
            "EmbeddingAuthorSource".to_string(),
            "PopularSource".to_string(),
            "TwoTowerSource".to_string(),
            "ColdStartSource".to_string(),
        ],
        graph_source_enabled: true,
        serve_cache_enabled: true,
        serve_cache_ttl_secs: 45,
        serve_cache_prefix: "recommendation:serve:v1".to_string(),
        cache_singleflight_enabled: false,
        cache_local_capacity: 4096,
        serving_author_soft_cap: 2,
        news_trends_cache_enabled: true,
        news_trends_cache_ttl_secs: 60,
        news_trends_cache_prefix: "news:trends:rust:v1".to_string(),
        source_cache_enabled: true,
        source_cache_ttl_secs: 300,
        source_cache_prefix: "recommendation:source:v1".to_string(),
    }
}

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
        recall_source: Some("PopularSource".to_string()),
        retrieval_lane: Some("fallback".to_string()),
        interest_pool_kind: None,
        topic_ids: Vec::new(),
        secondary_recall_sources: None,
        has_video: None,
        has_image: None,
        video_duration_sec: None,
        has_media: false,
        media_type: crate::contracts::MediaType::None,
        video_duration_ms: None,
        media: None,
        like_count: None,
        comment_count: None,
        repost_count: None,
        view_count: None,
        author_username: None,
        author_avatar_url: None,
        author_affinity_score: None,
        author_blocks_viewer: None,
        language_code: None,
        phoenix_scores: None,
        action_scores: None,
        ranking_signals: None,
        recall_evidence: None,
        selection_pool: None,
        selection_reason: None,
        score_contract_version: None,
        score_breakdown_version: None,
        weighted_score: Some(0.5),
        score: Some(0.7),
        is_liked_by_user: None,
        is_reposted_by_user: None,
        is_nsfw: None,
        vf_result: None,
        is_news: Some(false),
        news_metadata: None,
        is_pinned: None,
        is_subscription_only: None,
        score_breakdown: None,
        pipeline_score: None,
        graph_score: None,
        graph_path: None,
        graph_recall_type: None,
        post_type: None,
        mutual_follow_jaccard: None,
        following_replied: None,
    }
}
