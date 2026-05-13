use telegram_serving_primitives::{
    PAGE_BUILD_LATENCY_KEY, SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION,
};

use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationQueryPayload, RecommendationResultPayload, RecommendationSelectorPayload,
    RecommendationServingSummaryPayload, RecommendationSummaryPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::serving::cursor::{CURSOR_MODE, SERVED_STATE_VERSION, SERVING_VERSION};
use crate::serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE};

use super::super::utils::dedup_strings;
use super::ranking_stage::RankingStageOutput;
use super::retrieval_stage::RetrievalStageOutput;
use super::serving_stage::ServingStageOutput;
use super::summary::build_online_eval;
use super::telemetry::RunTelemetry;
use super::trace::build_recommendation_trace;

pub(super) struct LiveRecommendationResultInput<'a> {
    pub(super) config: &'a RecommendationConfig,
    pub(super) definition: &'a RecommendationPipelineDefinition,
    pub(super) hydrated_query: &'a RecommendationQueryPayload,
    pub(super) retrieval: RetrievalStageOutput,
    pub(super) ranking: RankingStageOutput,
    pub(super) serving: ServingStageOutput,
    pub(super) telemetry: RunTelemetry,
    pub(super) page_build_duration_ms: u64,
}

pub(super) fn build_live_recommendation_result(
    input: LiveRecommendationResultInput<'_>,
) -> RecommendationResultPayload {
    let mut telemetry = input.telemetry;
    let RetrievalStageOutput {
        retrieved_count,
        retrieval_summary,
        ..
    } = input.retrieval;
    let RankingStageOutput {
        scored_candidates,
        ranking_summary,
    } = input.ranking;
    let ServingStageOutput {
        final_candidates,
        duplicate_suppressed_count,
        cross_page_duplicate_count,
        has_more,
        page_remaining_count,
        page_underfilled,
        page_underfill_reason,
        suppression_reasons,
        truncated,
        next_cursor,
        stable_order_key,
    } = input.serving;

    if final_candidates.is_empty() {
        telemetry
            .degraded_reasons
            .push("empty_selection".to_string());
    } else if final_candidates.len() < input.hydrated_query.limit {
        telemetry
            .degraded_reasons
            .push("underfilled_selection".to_string());
    }
    dedup_strings(&mut telemetry.degraded_reasons);
    telemetry.stage_latency_ms.insert(
        PAGE_BUILD_LATENCY_KEY.to_string(),
        input.page_build_duration_ms,
    );

    let trace = build_recommendation_trace(
        input.hydrated_query,
        &final_candidates,
        &scored_candidates,
        &input.definition.pipeline_version,
        &input.definition.owner,
        &input.definition.fallback_mode,
        false,
    );

    let serving_summary = RecommendationServingSummaryPayload {
        serving_version: SERVING_VERSION.to_string(),
        cursor_mode: CURSOR_MODE.to_string(),
        cursor: input.hydrated_query.cursor,
        next_cursor,
        has_more,
        served_state_version: SERVED_STATE_VERSION.to_string(),
        stable_order_key: stable_order_key.clone(),
        duplicate_suppressed_count,
        cross_page_duplicate_count,
        suppression_reasons,
        serve_cache_hit: false,
        stable_order_drifted: false,
        cache_key_mode: CACHE_KEY_MODE.to_string(),
        cache_policy: CACHE_POLICY_MODE.to_string(),
        cache_policy_reason: SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION.to_string(),
        page_remaining_count,
        page_underfilled,
        page_underfill_reason,
    };

    let summary = RecommendationSummaryPayload {
        request_id: input.hydrated_query.request_id.clone(),
        stage: input.config.stage.clone(),
        pipeline_version: input.definition.pipeline_version.clone(),
        owner: input.definition.owner.clone(),
        fallback_mode: input.definition.fallback_mode.clone(),
        provider_calls: telemetry.provider_calls,
        provider_latency_ms: telemetry.provider_latency_ms,
        retrieved_count,
        selected_count: final_candidates.len(),
        source_counts: retrieval_summary.source_counts.clone(),
        filter_drop_counts: telemetry.filter_drop_counts,
        stage_timings: telemetry.stage_timings,
        stage_latency_ms: telemetry.stage_latency_ms,
        degraded_reasons: telemetry.degraded_reasons,
        recent_hot_applied: input.config.recent_source_enabled
            && !input.hydrated_query.in_network_only,
        online_eval: build_online_eval(&final_candidates),
        selector: RecommendationSelectorPayload {
            oversample_factor: input.config.selector_oversample_factor,
            max_size: input.config.selector_max_size,
            final_limit: input.hydrated_query.limit,
            truncated,
        },
        serving: serving_summary,
        retrieval: retrieval_summary,
        ranking: ranking_summary,
        stages: telemetry.stages,
        trace: Some(trace),
    };

    RecommendationResultPayload {
        request_id: input.hydrated_query.request_id.clone(),
        serving_version: SERVING_VERSION.to_string(),
        cursor: input.hydrated_query.cursor,
        next_cursor: summary.serving.next_cursor,
        has_more: summary.serving.has_more,
        served_state_version: SERVED_STATE_VERSION.to_string(),
        stable_order_key,
        candidates: final_candidates,
        summary,
    }
}

#[cfg(test)]
mod tests {
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
            weighted_score: Some(0.5),
            score: Some(0.7),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: Some(false),
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }
}
