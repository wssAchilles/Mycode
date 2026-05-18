use std::collections::HashMap;

use chrono::Utc;
use telegram_pipeline_primitives::{
    RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
    RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
};
use telegram_serving_primitives::{
    PAGE_BUILD_LATENCY_KEY, SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION,
};

use crate::candidate_pipeline::definition::build_pipeline_definition;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationCandidatePayload, RecommendationGraphRetrievalPayload,
    RecommendationQueryPayload, RecommendationRankingSummaryPayload,
    RecommendationRetrievalSummaryPayload,
};

use super::super::ranking_stage::RankingStageOutput;
use super::super::retrieval_stage::RetrievalStageOutput;
use super::super::serving_stage::ServingStageOutput;
use super::super::telemetry::RunTelemetry;
use super::{LiveRecommendationResultInput, build_live_recommendation_result};

#[test]
fn builds_live_result_and_records_selection_degradation() {
    let config = test_config();
    let definition = build_pipeline_definition(&config);
    let query = RecommendationQueryPayload {
        request_id: "req-response".to_string(),
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
            has_more: false,
            page_remaining_count: 0,
            page_underfilled: true,
            page_underfill_reason: Some("under_limit".to_string()),
            suppression_reasons: HashMap::new(),
            truncated: false,
            next_cursor: None,
            stable_order_key: "stable-key".to_string(),
        },
        telemetry: RunTelemetry::default(),
        page_build_duration_ms: 17,
    });

    assert_eq!(result.request_id, "req-response");
    assert_eq!(result.candidates.len(), 1);
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
    assert_eq!(
        result.summary.serving.cache_policy_reason,
        SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION
    );
    assert!(result.summary.trace.is_some());
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
