use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use tokio::sync::Mutex;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::config::RecommendationConfig;
use crate::contracts::{
    RecommendationQueryPayload, RecommendationResultPayload, RecommendationSelectorPayload,
    RecommendationServingSummaryPayload, RecommendationSummaryPayload,
};
use crate::metrics::RecommendationMetrics;
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::serving::cache::ServeCache;
use crate::serving::cursor::{CURSOR_MODE, SERVED_STATE_VERSION, SERVING_VERSION};
use crate::serving::policy::{
    CACHE_KEY_MODE, CACHE_POLICY_MODE, build_query_fingerprint, evaluate_store_policy,
};
use crate::side_effects::runtime::dispatch_post_response_side_effects;
use crate::sources::orchestrator::RecommendationSourceOrchestrator;
use crate::state::recent_store::RecentHotStore;

use super::utils::dedup_strings;

mod cache_replay;
mod flow;
mod query_hydration;
mod stages;
mod summary;
mod trace;

use flow::RunTelemetry;
use stages::build_serve_cache_stage;
use summary::build_online_eval;
use trace::build_recommendation_trace;

const SELF_POST_RESCUE_LOOKBACK_DAYS: usize = 180;

#[derive(Clone)]
pub struct RecommendationPipeline {
    backend_client: BackendRecommendationClient,
    config: RecommendationConfig,
    definition: RecommendationPipelineDefinition,
    recent_store: Arc<Mutex<RecentHotStore>>,
    metrics: Arc<Mutex<RecommendationMetrics>>,
    source_orchestrator: RecommendationSourceOrchestrator,
    serve_cache: ServeCache,
}

impl RecommendationPipeline {
    pub fn new(
        backend_client: BackendRecommendationClient,
        config: RecommendationConfig,
        recent_store: Arc<Mutex<RecentHotStore>>,
        metrics: Arc<Mutex<RecommendationMetrics>>,
        definition: RecommendationPipelineDefinition,
        source_orchestrator: RecommendationSourceOrchestrator,
    ) -> Self {
        Self {
            serve_cache: ServeCache::from_config(&config),
            backend_client,
            config,
            definition,
            recent_store,
            metrics,
            source_orchestrator,
        }
    }

    pub fn definition(&self) -> &RecommendationPipelineDefinition {
        &self.definition
    }

    pub async fn run(
        &self,
        query: RecommendationQueryPayload,
    ) -> Result<RecommendationResultPayload> {
        let request_start = Instant::now();
        let query_fingerprint = build_query_fingerprint(&query);
        let serve_cache_start = Instant::now();
        let serve_cache_lookup = self.serve_cache.get(&query_fingerprint).await;
        let serve_cache_duration_ms = serve_cache_start.elapsed().as_millis() as u64;
        if let Some(cached_result) = serve_cache_lookup.result {
            return Ok(self.rebuild_cached_result(
                cached_result,
                &query,
                &query_fingerprint,
                serve_cache_duration_ms,
                request_start.elapsed().as_millis() as u64,
            ));
        }

        let mut telemetry = RunTelemetry::default();
        telemetry.add_stage(build_serve_cache_stage(
            false,
            serve_cache_duration_ms,
            0,
            self.serve_cache.enabled(),
            &query_fingerprint,
        ));
        telemetry
            .stage_latency_ms
            .insert("serveCache".to_string(), serve_cache_duration_ms);

        let query_stage = self.execute_query_stage(&query, &mut telemetry).await;
        let hydrated_query = query_stage.hydrated_query;
        let retrieval_stage = self
            .execute_retrieval_stage(
                &hydrated_query,
                &query_stage.circuit_open_sources,
                &mut telemetry,
            )
            .await?;
        let ranking_stage = self
            .execute_ranking_stage(
                &hydrated_query,
                &retrieval_stage.retrieved,
                &query_stage.circuit_open_hydrators,
                &mut telemetry,
            )
            .await?;
        let oversampled = self.execute_selector_stage(
            &hydrated_query,
            &ranking_stage.scored_candidates,
            &mut telemetry,
        );
        let final_candidates = self
            .execute_post_selection_stage(
                &hydrated_query,
                &oversampled,
                &query_stage.circuit_open_hydrators,
                &mut telemetry,
            )
            .await?;
        let final_candidates = self
            .rescue_empty_selection(&hydrated_query, final_candidates, &mut telemetry)
            .await;
        let serving = self.execute_serving_stage(&hydrated_query, final_candidates, &mut telemetry);

        if serving.final_candidates.is_empty() {
            telemetry
                .degraded_reasons
                .push("empty_selection".to_string());
        } else if serving.final_candidates.len() < hydrated_query.limit {
            telemetry
                .degraded_reasons
                .push("underfilled_selection".to_string());
        }
        dedup_strings(&mut telemetry.degraded_reasons);
        telemetry.stage_latency_ms.insert(
            "pageBuild".to_string(),
            request_start.elapsed().as_millis() as u64,
        );

        let trace = build_recommendation_trace(
            &hydrated_query,
            &serving.final_candidates,
            &ranking_stage.scored_candidates,
            &self.definition.pipeline_version,
            &self.definition.owner,
            &self.definition.fallback_mode,
            false,
        );

        let summary = RecommendationSummaryPayload {
            request_id: hydrated_query.request_id.clone(),
            stage: self.config.stage.clone(),
            pipeline_version: self.definition.pipeline_version.clone(),
            owner: self.definition.owner.clone(),
            fallback_mode: self.definition.fallback_mode.clone(),
            provider_calls: telemetry.provider_calls,
            provider_latency_ms: telemetry.provider_latency_ms,
            retrieved_count: retrieval_stage.retrieved_count,
            selected_count: serving.final_candidates.len(),
            source_counts: retrieval_stage.retrieval_summary.source_counts.clone(),
            filter_drop_counts: telemetry.filter_drop_counts,
            stage_timings: telemetry.stage_timings,
            stage_latency_ms: telemetry.stage_latency_ms,
            degraded_reasons: telemetry.degraded_reasons,
            recent_hot_applied: self.config.recent_source_enabled
                && !hydrated_query.in_network_only,
            online_eval: build_online_eval(&serving.final_candidates),
            selector: RecommendationSelectorPayload {
                oversample_factor: self.config.selector_oversample_factor,
                max_size: self.config.selector_max_size,
                final_limit: hydrated_query.limit,
                truncated: serving.truncated,
            },
            serving: RecommendationServingSummaryPayload {
                serving_version: SERVING_VERSION.to_string(),
                cursor_mode: CURSOR_MODE.to_string(),
                cursor: hydrated_query.cursor,
                next_cursor: serving.next_cursor,
                has_more: serving.has_more,
                served_state_version: SERVED_STATE_VERSION.to_string(),
                stable_order_key: serving.stable_order_key.clone(),
                duplicate_suppressed_count: serving.duplicate_suppressed_count,
                cross_page_duplicate_count: serving.cross_page_duplicate_count,
                suppression_reasons: serving.suppression_reasons,
                serve_cache_hit: false,
                stable_order_drifted: false,
                cache_key_mode: CACHE_KEY_MODE.to_string(),
                cache_policy: CACHE_POLICY_MODE.to_string(),
                cache_policy_reason: "pending_evaluation".to_string(),
                page_remaining_count: serving.page_remaining_count,
                page_underfilled: serving.page_underfilled,
                page_underfill_reason: serving.page_underfill_reason,
            },
            retrieval: retrieval_stage.retrieval_summary,
            ranking: ranking_stage.ranking_summary,
            stages: telemetry.stages,
            trace: Some(trace),
        };

        let mut result = RecommendationResultPayload {
            request_id: hydrated_query.request_id.clone(),
            serving_version: SERVING_VERSION.to_string(),
            cursor: hydrated_query.cursor,
            next_cursor: summary.serving.next_cursor,
            has_more: summary.serving.has_more,
            served_state_version: SERVED_STATE_VERSION.to_string(),
            stable_order_key: serving.stable_order_key,
            candidates: serving.final_candidates,
            summary,
        };

        let cache_store_policy =
            evaluate_store_policy(&hydrated_query, &result, self.serve_cache.enabled());
        result.summary.serving.cache_policy_reason = cache_store_policy.reason.clone();
        dispatch_post_response_side_effects(
            Arc::clone(&self.metrics),
            Arc::clone(&self.recent_store),
            self.serve_cache.clone(),
            hydrated_query.user_id.clone(),
            query_fingerprint,
            result.clone(),
            cache_store_policy.cacheable,
        );

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use chrono::Utc;
    use serde_json::json;

    use crate::contracts::{
        CandidateNewsMetadataPayload, EmbeddingContextPayload, ExperimentAssignmentPayload,
        ExperimentContextPayload, RecommendationCandidatePayload, RecommendationQueryPatchPayload,
        RecommendationQueryPayload, RecommendationStagePayload, UserStateContextPayload,
    };

    use super::query_hydration::apply_query_patch;
    use super::summary::build_ranking_summary;
    use super::trace::build_recommendation_trace;

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
            recall_source: Some("NewsAnnSource".to_string()),
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
            is_news: Some(true),
            news_metadata: Some(CandidateNewsMetadataPayload {
                external_id: Some(format!("ext-{post_id}")),
                ..CandidateNewsMetadataPayload::default()
            }),
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn builds_stageful_ranking_summary_and_ml_degradation() {
        let hydrated = vec![candidate("1"), candidate("2")];
        let filtered = hydrated.clone();
        let scored = vec![hydrated[0].clone()];
        let drop_counts = HashMap::from([("MutedKeywordFilter".to_string(), 1)]);
        let stages = vec![
            RecommendationStagePayload {
                name: "AuthorInfoHydrator".to_string(),
                enabled: true,
                duration_ms: 5,
                input_count: 2,
                output_count: 2,
                removed_count: None,
                detail: None,
            },
            RecommendationStagePayload {
                name: "PhoenixScorer".to_string(),
                enabled: true,
                duration_ms: 9,
                input_count: 2,
                output_count: 2,
                removed_count: None,
                detail: Some(HashMap::from([(
                    "error".to_string(),
                    json!("remote_timeout"),
                )])),
            },
        ];

        let summary = build_ranking_summary(
            2,
            &hydrated,
            &filtered,
            &scored,
            &drop_counts,
            &stages[..1],
            &[],
            &stages[1..],
        );

        assert_eq!(summary.stage, "xalgo_stageful_ranking_v2");
        assert_eq!(summary.input_candidates, 2);
        assert_eq!(summary.hydrated_candidates, 2);
        assert_eq!(summary.filtered_candidates, 2);
        assert_eq!(summary.scored_candidates, 1);
        assert_eq!(summary.ml_eligible_candidates, 2);
        assert_eq!(summary.ml_ranked_candidates, 0);
        assert_eq!(summary.weighted_candidates, 0);
        assert_eq!(
            summary.filter_drop_counts.get("MutedKeywordFilter"),
            Some(&1)
        );
        assert!(
            summary
                .degraded_reasons
                .contains(&"ranking:PhoenixScorer:remote_timeout".to_string())
        );
        assert!(
            summary
                .degraded_reasons
                .contains(&"ranking:PhoenixScorer:empty_ml_ranking".to_string())
        );
    }

    #[test]
    fn builds_rust_owned_recommendation_trace() {
        let mut first = candidate("507f191e810c19729de8c001");
        first.author_id = "author-a".to_string();
        first.in_network = Some(true);
        first.is_reply = true;
        first.score = Some(0.8);
        first.weighted_score = Some(0.7);
        first.pipeline_score = Some(0.6);
        first.score_breakdown = Some(HashMap::from([
            ("phoenixWeighted".to_string(), 0.8),
            ("ignoredNan".to_string(), f64::NAN),
        ]));

        let mut second = candidate("507f191e810c19729de8c002");
        second.author_id = "author-b".to_string();
        second.weighted_score = Some(0.2);

        let query = RecommendationQueryPayload {
            request_id: "req-trace".to_string(),
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
            embedding_context: Some(EmbeddingContextPayload {
                quality_score: Some(0.91),
                usable: true,
                ..EmbeddingContextPayload::default()
            }),
            user_state_context: Some(UserStateContextPayload {
                state: "warm".to_string(),
                reason: "test".to_string(),
                followed_count: 8,
                recent_action_count: 12,
                recent_positive_action_count: 6,
                usable_embedding: true,
                account_age_days: Some(20),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: Some(ExperimentContextPayload {
                user_id: "viewer-1".to_string(),
                assignments: vec![
                    ExperimentAssignmentPayload {
                        experiment_id: "recsys_v2".to_string(),
                        experiment_name: "Recsys V2".to_string(),
                        bucket: "treatment".to_string(),
                        config: HashMap::new(),
                        in_experiment: true,
                    },
                    ExperimentAssignmentPayload {
                        experiment_id: "holdout".to_string(),
                        experiment_name: "Holdout".to_string(),
                        bucket: "control".to_string(),
                        config: HashMap::new(),
                        in_experiment: false,
                    },
                ],
            }),
            ranking_policy: None,
        };

        let trace = build_recommendation_trace(
            &query,
            &[first.clone(), second.clone()],
            &[first.clone(), second.clone()],
            "xalgo_candidate_pipeline_v6",
            "rust",
            "node_provider_surface",
            false,
        );

        assert_eq!(trace.trace_version, "rust_candidate_trace_v1");
        assert_eq!(trace.trace_mode, "live_trace");
        assert_eq!(trace.selected_count, 2);
        assert_eq!(trace.in_network_count, 1);
        assert_eq!(trace.out_of_network_count, 1);
        assert_eq!(trace.author_diversity, 1.0);
        assert_eq!(trace.reply_ratio, 0.5);
        assert_eq!(trace.average_score, 0.5);
        assert_eq!(trace.experiment_keys, vec!["recsys_v2:treatment"]);
        assert_eq!(trace.user_state.as_deref(), Some("warm"));
        assert_eq!(trace.embedding_quality_score, Some(0.91));
        assert_eq!(trace.candidates[0].score, Some(0.8));
        assert_eq!(
            trace
                .replay_pool
                .as_ref()
                .map(|pool| pool.pool_kind.as_str()),
            Some("pre_selector_scored_topk_v1")
        );
        assert_eq!(
            trace.replay_pool.as_ref().map(|pool| pool.total_count),
            Some(2)
        );
        assert_eq!(
            trace.candidates[0]
                .score_breakdown
                .as_ref()
                .and_then(|breakdown| breakdown.get("phoenixWeighted")),
            Some(&0.8)
        );
        assert!(
            !trace.candidates[0]
                .score_breakdown
                .as_ref()
                .is_some_and(|breakdown| breakdown.contains_key("ignoredNan"))
        );
        assert_eq!(
            trace
                .replay_pool
                .as_ref()
                .and_then(|pool| pool.candidates.first())
                .and_then(|candidate| candidate.score),
            Some(0.8)
        );
    }

    #[test]
    fn applies_disjoint_query_patches_and_rejects_conflicts() {
        let mut query = RecommendationQueryPayload {
            request_id: "req-query-patch".to_string(),
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
        };
        let mut seen_fields = HashSet::new();

        let user_features_patch = RecommendationQueryPatchPayload {
            user_features: Some(crate::contracts::UserFeaturesPayload {
                followed_user_ids: vec!["author-1".to_string()],
                blocked_user_ids: Vec::new(),
                muted_keywords: Vec::new(),
                seen_post_ids: Vec::new(),
                follower_count: Some(42),
                account_created_at: None,
            }),
            ..RecommendationQueryPatchPayload::default()
        };
        apply_query_patch(&mut query, &user_features_patch, &mut seen_fields)
            .expect("disjoint user features patch should merge");
        assert_eq!(
            query
                .user_features
                .as_ref()
                .and_then(|value| value.follower_count),
            Some(42)
        );

        let experiment_patch = RecommendationQueryPatchPayload {
            experiment_context: Some(crate::contracts::ExperimentContextPayload {
                user_id: "viewer-1".to_string(),
                assignments: Vec::new(),
            }),
            ..RecommendationQueryPatchPayload::default()
        };
        apply_query_patch(&mut query, &experiment_patch, &mut seen_fields)
            .expect("disjoint experiment patch should merge");
        assert_eq!(
            query
                .experiment_context
                .as_ref()
                .map(|value| value.user_id.as_str()),
            Some("viewer-1")
        );

        let conflict = apply_query_patch(&mut query, &user_features_patch, &mut seen_fields)
            .expect_err("second writer to userFeatures should be rejected");
        assert_eq!(conflict, "query_patch_field_conflict:userFeatures");
    }
}
