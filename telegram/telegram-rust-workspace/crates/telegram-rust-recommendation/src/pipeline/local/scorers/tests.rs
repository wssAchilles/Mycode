use chrono::{TimeZone, Utc};
use serde_json::json;
use std::collections::HashMap;
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_RANKING, stage_detail_contract_violations};
use telegram_ranking_primitives::{
    AUTHOR_AFFINITY_SCORE_FIELD, EXPLORATION_ELIGIBLE_FIELD, FATIGUE_STRENGTH_FIELD,
    NEGATIVE_FEEDBACK_STRENGTH_FIELD, RANKING_CANDIDATE_FIELD_WRITES_FIELD,
    RANKING_FUSED_GROUP_FIELD, RANKING_FUSED_GROUP_STAGES_FIELD,
    RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD, RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
    RankingStageKind, TREND_AFFINITY_STRENGTH_FIELD, TREND_PERSONALIZATION_STRENGTH_FIELD,
    ranking_stage_detail_contract_violations,
};
use telegram_source_primitives::{
    RETRIEVAL_MULTI_SOURCE_BONUS_FIELD, RETRIEVAL_SECONDARY_SOURCE_COUNT_FIELD,
    RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD, SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD,
};

use crate::contracts::query::RankingPolicyPayload;
use crate::contracts::{
    CandidateNewsMetadataPayload, EmbeddingContextPayload, PhoenixScoresPayload,
    RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload,
};

use super::ownership::candidate_field_write_names_for_stage;
use super::runner::{local_scoring_execution_passes, run_local_scorers_without_fusion};
use super::{
    local_ranking_adjustment_group_specs, local_ranking_ladder_specs, run_local_scorers,
    validate_local_ranking_adjustment_registry, validate_local_ranking_ladder,
};
use crate::pipeline::local::context::FALLBACK_LANE;
use crate::pipeline::local::ranking::validate_ranking_ladder;
use crate::selectors::top_k::select_candidates;

const EXPECTED_LOCAL_SCORER_ORDER: [&str; 19] = [
    "LightweightPhoenixScorer",
    "WeightedScorer",
    "ScoreCalibrationScorer",
    "ContentQualityScorer",
    "AuthorAffinityScorer",
    "RecencyScorer",
    "ColdStartInterestScorer",
    "TrendAffinityScorer",
    "TrendPersonalizationScorer",
    "NewsTrendLinkScorer",
    "InterestDecayScorer",
    "ExplorationScorer",
    "BanditExplorationScorer",
    "FatigueScorer",
    "SessionSuppressionScorer",
    "OutOfNetworkScorer",
    "IntraRequestDiversityScorer",
    "AuthorDiversityScorer",
    "ScoreContractScorer",
];

const EXPECTED_WEIGHTED_SCORE_MUTATORS: [&str; 16] = [
    "WeightedScorer",
    "ScoreCalibrationScorer",
    "ContentQualityScorer",
    "AuthorAffinityScorer",
    "RecencyScorer",
    "ColdStartInterestScorer",
    "TrendAffinityScorer",
    "TrendPersonalizationScorer",
    "NewsTrendLinkScorer",
    "InterestDecayScorer",
    "ExplorationScorer",
    "BanditExplorationScorer",
    "FatigueScorer",
    "SessionSuppressionScorer",
    "OutOfNetworkScorer",
    "IntraRequestDiversityScorer",
];

#[test]
fn local_ranking_ladder_satisfies_score_contract_invariants() {
    let specs = local_ranking_ladder_specs();

    validate_ranking_ladder(&specs).expect("valid local ranking ladder");
    validate_local_ranking_ladder().expect("runner validates local ranking ladder");
    validate_local_ranking_adjustment_registry().expect("valid local adjustment registry");
}

#[test]
fn local_ranking_ladder_specs_match_candidate_field_write_registry() {
    for spec in local_ranking_ladder_specs() {
        let writes = candidate_field_write_names_for_stage(spec.stage_name);
        let writes_weighted_score = writes.iter().any(|field| field == "weighted_score");
        let writes_final_score = writes.iter().any(|field| field == "score");
        let writes_model_scores = writes
            .iter()
            .any(|field| matches!(field.as_str(), "phoenix_scores" | "action_scores"));

        assert_eq!(
            writes_weighted_score, spec.writes_weighted_score,
            "{} weighted score write registry drifted from ranking spec",
            spec.stage_name
        );
        assert_eq!(
            writes_final_score, spec.writes_final_score,
            "{} final score write registry drifted from ranking spec",
            spec.stage_name
        );

        match spec.kind {
            RankingStageKind::ModelScores => {
                assert!(
                    writes_model_scores,
                    "{} must own model score fields",
                    spec.stage_name
                );
                assert!(
                    !writes_weighted_score && !writes_final_score,
                    "{} must not write rank scores",
                    spec.stage_name
                );
            }
            RankingStageKind::Metadata => {
                assert!(
                    !writes_weighted_score && !writes_final_score && !writes_model_scores,
                    "{} metadata stage must not write score fields",
                    spec.stage_name
                );
            }
            RankingStageKind::ScoreAdjustment => {
                assert!(
                    writes_weighted_score && !writes_final_score && !writes_model_scores,
                    "{} adjustment stage must only mutate weighted score fields",
                    spec.stage_name
                );
            }
            RankingStageKind::WeightedScore | RankingStageKind::FinalScore => {}
        }
    }
}

fn query() -> RecommendationQueryPayload {
    RecommendationQueryPayload {
        request_id: "req-local-scorers".to_string(),
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
            quality_score: Some(0.9),
            usable: true,
            ..EmbeddingContextPayload::default()
        }),
        user_state_context: Some(UserStateContextPayload {
            state: "warm".to_string(),
            reason: "test".to_string(),
            followed_count: 3,
            recent_action_count: 4,
            recent_positive_action_count: 2,
            usable_embedding: true,
            account_age_days: Some(20),
        }),
        user_action_sequence: Some(vec![HashMap::from([
            ("action".to_string(), json!("reply")),
            ("targetAuthorId".to_string(), json!("author-a")),
            ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
        ])]),
        news_history_external_ids: None,
        model_user_action_sequence: None,
        experiment_context: None,
        ranking_policy: None,
    }
}

fn candidate(post_id: &str, author_id: &str) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        model_post_id: Some(post_id.to_string()),
        author_id: author_id.to_string(),
        content: "a reasonably long content body for quality scoring".to_string(),
        created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
        conversation_id: None,
        is_reply: false,
        reply_to_post_id: None,
        is_repost: false,
        original_post_id: None,
        in_network: Some(false),
        recall_source: Some("GraphSource".to_string()),
        retrieval_lane: None,
        interest_pool_kind: None,
        secondary_recall_sources: None,
        has_video: Some(true),
        has_image: Some(true),
        video_duration_sec: Some(12.0),
        media: None,
        like_count: Some(12.0),
        comment_count: Some(4.0),
        repost_count: Some(2.0),
        view_count: Some(100.0),
        author_username: None,
        author_avatar_url: None,
        author_affinity_score: None,
        phoenix_scores: Some(PhoenixScoresPayload {
            like_score: Some(0.2),
            reply_score: Some(0.1),
            repost_score: Some(0.05),
            click_score: Some(0.3),
            follow_author_score: Some(0.1),
            ..Default::default()
        }),
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

fn fused_equivalence_scenarios() -> Vec<(
    RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
)> {
    let mut cold_trend_query = query();
    cold_trend_query.language_code = Some("rust".to_string());
    cold_trend_query.user_state_context = Some(UserStateContextPayload {
        state: "cold_start".to_string(),
        reason: "fused_equivalence_cold_start".to_string(),
        followed_count: 0,
        recent_action_count: 0,
        recent_positive_action_count: 0,
        usable_embedding: false,
        account_age_days: Some(1),
    });
    cold_trend_query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["rust".to_string(), "ai".to_string()]),
        ..RankingPolicyPayload::default()
    });
    let mut cold_trend_candidate = candidate("post-cold-trend", "author-cold");
    cold_trend_candidate.content =
        "rust ai systems post with enough content for trend and cold start scoring".to_string();
    cold_trend_candidate.recall_source = Some("ColdStartSource".to_string());
    cold_trend_candidate.retrieval_lane = Some(FALLBACK_LANE.to_string());

    let mut negative_query = query();
    negative_query.user_action_sequence = Some(vec![
        HashMap::from([
            ("action".to_string(), json!("block_author")),
            ("targetAuthorId".to_string(), json!("author-negative")),
            ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
        ]),
        HashMap::from([
            ("action".to_string(), json!("not_interested")),
            ("targetPostId".to_string(), json!("post-negative")),
            ("targetAuthorId".to_string(), json!("author-negative")),
            ("timestamp".to_string(), json!("2026-04-21T00:00:00Z")),
        ]),
    ]);
    let mut negative_candidate = candidate("post-negative", "author-negative");
    negative_candidate.in_network = Some(true);

    let mut sparse_query = query();
    sparse_query.user_state_context = Some(UserStateContextPayload {
        state: "sparse".to_string(),
        reason: "fused_equivalence_sparse".to_string(),
        followed_count: 2,
        recent_action_count: 1,
        recent_positive_action_count: 1,
        usable_embedding: true,
        account_age_days: Some(10),
    });
    sparse_query.user_action_sequence = None;
    let mut sparse_fallback = candidate("post-sparse-fallback", "author-fallback");
    sparse_fallback.retrieval_lane = Some(FALLBACK_LANE.to_string());
    sparse_fallback.recall_source = Some("PopularSource".to_string());

    vec![
        (
            query(),
            vec![
                candidate("post-warm-a", "author-a"),
                candidate("post-warm-b", "author-b"),
            ],
        ),
        (cold_trend_query, vec![cold_trend_candidate]),
        (negative_query, vec![negative_candidate]),
        (
            sparse_query,
            vec![
                candidate("post-sparse-interest", "author-interest"),
                sparse_fallback,
            ],
        ),
    ]
}

fn assert_scored_candidates_match(
    fused: &[RecommendationCandidatePayload],
    unfused: &[RecommendationCandidatePayload],
) {
    assert_eq!(fused.len(), unfused.len());
    for (left, right) in fused.iter().zip(unfused) {
        assert_eq!(left.post_id, right.post_id);
        assert_close(left.weighted_score, right.weighted_score, "weighted_score");
        assert_close(left.score, right.score, "score");
        assert_close(left.pipeline_score, right.pipeline_score, "pipeline_score");
        assert_close(
            left.author_affinity_score,
            right.author_affinity_score,
            "author_affinity_score",
        );

        let left_breakdown = left.score_breakdown.as_ref().expect("left breakdown");
        let right_breakdown = right.score_breakdown.as_ref().expect("right breakdown");
        assert_eq!(
            left_breakdown
                .keys()
                .collect::<std::collections::HashSet<_>>(),
            right_breakdown
                .keys()
                .collect::<std::collections::HashSet<_>>()
        );
        for (key, left_value) in left_breakdown {
            if matches!(key.as_str(), "ageHours" | "rankingFreshness") {
                continue;
            }
            assert_f64_close(
                *left_value,
                *right_breakdown.get(key).expect("right breakdown key"),
                key,
            );
        }
    }
}

fn stage_value_without_fusion_detail(
    stage: &crate::contracts::RecommendationStagePayload,
) -> serde_json::Value {
    let mut value = serde_json::to_value(stage).expect("serialize stage");
    if let Some(detail) = value
        .get_mut("detail")
        .and_then(|detail| detail.as_object_mut())
    {
        detail.remove(RANKING_FUSED_GROUP_FIELD);
        detail.remove(RANKING_FUSED_GROUP_STAGES_FIELD);
        detail.remove(RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD);
        detail.remove(RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD);
    }
    value
}

fn assert_close(left: Option<f64>, right: Option<f64>, label: &str) {
    match (left, right) {
        (Some(left), Some(right)) => assert_f64_close(left, right, label),
        _ => assert_eq!(left, right, "{label} option mismatch"),
    }
}

fn assert_f64_close(left: f64, right: f64, label: &str) {
    assert!(
        (left - right).abs() <= 1e-9,
        "{label} mismatch: left={left} right={right}"
    );
}

#[test]
fn local_scorer_ladder_has_stable_order_and_score_write_boundaries() {
    let result = run_local_scorers(&query(), vec![candidate("post-1", "author-a")]);
    let stage_names = result
        .stages
        .iter()
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(stage_names, EXPECTED_LOCAL_SCORER_ORDER);
    let specs = local_ranking_ladder_specs();

    for stage in &result.stages {
        let detail = stage.detail.as_ref().expect("ranking stage detail");
        assert!(
            stage_detail_contract_violations(
                stage.name.as_str(),
                PIPELINE_STAGE_KIND_RANKING,
                Some(detail),
            )
            .is_empty()
        );
        assert_eq!(
            detail
                .get("rankingStageName")
                .and_then(|value| value.as_str()),
            Some(stage.name.as_str())
        );
        let spec = specs
            .iter()
            .find(|spec| spec.stage_name == stage.name)
            .copied()
            .unwrap_or_else(|| panic!("missing ranking spec for {}", stage.name));
        assert!(ranking_stage_detail_contract_violations(spec, Some(detail)).is_empty());
    }

    let weighted_score_mutators = result
        .stages
        .iter()
        .filter(|stage| {
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingWritesWeightedScore"))
                .and_then(|value| value.as_bool())
                == Some(true)
        })
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(weighted_score_mutators, EXPECTED_WEIGHTED_SCORE_MUTATORS);

    let final_score_writers = result
        .stages
        .iter()
        .filter(|stage| {
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingWritesFinalScore"))
                .and_then(|value| value.as_bool())
                == Some(true)
        })
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(final_score_writers, vec!["AuthorDiversityScorer"]);

    let weighted_score_field_writers = result
        .stages
        .iter()
        .filter(|stage| {
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get(RANKING_CANDIDATE_FIELD_WRITES_FIELD))
                .and_then(|value| value.as_array())
                .is_some_and(|fields| {
                    fields
                        .iter()
                        .any(|field| field.as_str() == Some("weighted_score"))
                })
        })
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        weighted_score_field_writers,
        EXPECTED_WEIGHTED_SCORE_MUTATORS
    );

    let final_score_field_writers = result
        .stages
        .iter()
        .filter(|stage| {
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get(RANKING_CANDIDATE_FIELD_WRITES_FIELD))
                .and_then(|value| value.as_array())
                .is_some_and(|fields| fields.iter().any(|field| field.as_str() == Some("score")))
        })
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(final_score_field_writers, vec!["AuthorDiversityScorer"]);

    let fallback_model_scorers = result
        .stages
        .iter()
        .filter(|stage| {
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingFallbackModelScorer"))
                .and_then(|value| value.as_bool())
                == Some(true)
        })
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(fallback_model_scorers, vec!["LightweightPhoenixScorer"]);

    assert_eq!(
        result
            .stages
            .last()
            .and_then(|stage| stage.detail.as_ref())
            .and_then(|detail| detail.get("rankingStageKind"))
            .and_then(|value| value.as_str()),
        Some("metadata")
    );
    assert_eq!(
        result.stages[0]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingScoreRole"))
            .and_then(|value| value.as_str()),
        Some("model_score_generation")
    );
    assert_eq!(
        result.stages[1]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingScoreRole"))
            .and_then(|value| value.as_str()),
        Some("weighted_score_creation")
    );
    assert_eq!(
        result.stages[2]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingScoreRole"))
            .and_then(|value| value.as_str()),
        Some("weighted_score_adjustment")
    );
    assert_eq!(
        result.stages[17]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingScoreRole"))
            .and_then(|value| value.as_str()),
        Some("final_score_creation")
    );
    assert_eq!(
        result.stages[18]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingScoreRole"))
            .and_then(|value| value.as_str()),
        Some("metadata_only")
    );
}

#[test]
fn local_adjustment_registry_declares_fused_weighted_score_groups() {
    let specs = local_ranking_ladder_specs();
    let groups = local_ranking_adjustment_group_specs();

    validate_local_ranking_adjustment_registry().expect("valid adjustment registry");
    assert_eq!(
        groups
            .iter()
            .map(|group| group.group_name)
            .collect::<Vec<_>>(),
        vec![
            "fused_foundation_adjustments",
            "fused_trend_adjustments",
            "fused_interest_exploration_adjustments",
            "fused_suppression_adjustments",
        ]
    );

    for group in groups {
        assert!(!group.stage_names.is_empty());
        for stage_name in group.stage_names {
            let spec = specs
                .iter()
                .find(|spec| spec.stage_name == *stage_name)
                .unwrap_or_else(|| panic!("missing spec for grouped stage {stage_name}"));
            assert_eq!(spec.kind, RankingStageKind::ScoreAdjustment);
            assert!(spec.writes_weighted_score);
            assert!(!spec.writes_final_score);
        }
    }
}

#[test]
fn fused_adjustment_execution_matches_unfused_scorer_semantics() {
    for (query, candidates) in fused_equivalence_scenarios() {
        let fused = run_local_scorers(&query, candidates.clone());
        let unfused = run_local_scorers_without_fusion(&query, candidates);

        assert_eq!(
            fused
                .stages
                .iter()
                .map(stage_value_without_fusion_detail)
                .collect::<Vec<_>>(),
            unfused
                .stages
                .iter()
                .map(stage_value_without_fusion_detail)
                .collect::<Vec<_>>()
        );
        assert_scored_candidates_match(&fused.candidates, &unfused.candidates);
    }
}

#[test]
fn local_scoring_execution_pass_plan_preserves_fused_boundaries() {
    let passes = local_scoring_execution_passes();
    let flattened = passes
        .iter()
        .flat_map(|(_, stages)| stages.iter().copied())
        .collect::<Vec<_>>();

    assert_eq!(flattened, EXPECTED_LOCAL_SCORER_ORDER);
    assert_eq!(passes.len(), 9);
    assert_eq!(
        passes
            .iter()
            .find(|(name, _)| *name == "fused_foundation_adjustments")
            .map(|(_, stages)| stages.as_slice()),
        Some(
            [
                "ScoreCalibrationScorer",
                "ContentQualityScorer",
                "AuthorAffinityScorer",
                "RecencyScorer",
                "ColdStartInterestScorer"
            ]
            .as_slice()
        )
    );
    assert_eq!(
        passes
            .iter()
            .find(|(name, _)| *name == "fused_suppression_adjustments")
            .map(|(_, stages)| stages.as_slice()),
        Some(
            [
                "FatigueScorer",
                "SessionSuppressionScorer",
                "OutOfNetworkScorer"
            ]
            .as_slice()
        )
    );
    assert!(passes.iter().any(|(name, stages)| {
        *name == "final_score" && stages.as_slice() == ["AuthorDiversityScorer"].as_slice()
    }));
}

#[test]
fn fused_adjustment_groups_preserve_logical_stage_outputs() {
    let mut query = query();
    query.language_code = Some("rust".to_string());
    query.user_state_context = Some(UserStateContextPayload {
        state: "cold_start".to_string(),
        reason: "fused_adjustment_test".to_string(),
        followed_count: 0,
        recent_action_count: 0,
        recent_positive_action_count: 0,
        usable_embedding: false,
        account_age_days: Some(1),
    });
    query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["rust".to_string(), "ai".to_string()]),
        ..RankingPolicyPayload::default()
    });

    let mut candidate = candidate("post-fused-adjustment", "author-fused");
    candidate.content =
        "rust ai systems post with enough content for the fused adjustment path".to_string();
    candidate.recall_source = Some("ColdStartSource".to_string());
    candidate.retrieval_lane = Some(FALLBACK_LANE.to_string());

    let result = run_local_scorers(&query, vec![candidate]);
    let stage_names = result
        .stages
        .iter()
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(stage_names, EXPECTED_LOCAL_SCORER_ORDER);

    for stage_name in [
        "ScoreCalibrationScorer",
        "ContentQualityScorer",
        "AuthorAffinityScorer",
        "RecencyScorer",
        "ColdStartInterestScorer",
        "TrendAffinityScorer",
        "TrendPersonalizationScorer",
        "NewsTrendLinkScorer",
        "InterestDecayScorer",
        "ExplorationScorer",
        "BanditExplorationScorer",
        "FatigueScorer",
        "SessionSuppressionScorer",
        "OutOfNetworkScorer",
    ] {
        let stage = result
            .stages
            .iter()
            .find(|stage| stage.name == stage_name)
            .expect("fused logical stage exists");
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingWritesWeightedScore"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert!(stage.enabled, "{stage_name} should stay enabled");
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingWritesFinalScore"))
                .and_then(|value| value.as_bool()),
            Some(false)
        );
        let expected_group = match stage_name {
            "ScoreCalibrationScorer"
            | "ContentQualityScorer"
            | "AuthorAffinityScorer"
            | "RecencyScorer"
            | "ColdStartInterestScorer" => "fused_foundation_adjustments",
            "TrendAffinityScorer" | "TrendPersonalizationScorer" | "NewsTrendLinkScorer" => {
                "fused_trend_adjustments"
            }
            "InterestDecayScorer" | "ExplorationScorer" | "BanditExplorationScorer" => {
                "fused_interest_exploration_adjustments"
            }
            "FatigueScorer" | "SessionSuppressionScorer" | "OutOfNetworkScorer" => {
                "fused_suppression_adjustments"
            }
            _ => unreachable!("unexpected fused stage"),
        };
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get(RANKING_FUSED_GROUP_FIELD))
                .and_then(|value| value.as_str()),
            Some(expected_group)
        );
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get(RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD))
                .and_then(|value| value.as_u64()),
            Some(1)
        );
    }

    let score_calibration = result
        .stages
        .iter()
        .find(|stage| stage.name == "ScoreCalibrationScorer")
        .expect("ScoreCalibrationScorer stage");
    let score_calibration_detail = score_calibration.detail.as_ref().expect("stage detail");
    assert_eq!(
        score_calibration_detail
            .get(RANKING_FUSED_GROUP_FIELD)
            .and_then(|value| value.as_str()),
        Some("fused_foundation_adjustments")
    );
    assert_eq!(
        score_calibration_detail
            .get(RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD)
            .and_then(|value| value.as_u64()),
        Some(1)
    );
    assert_eq!(
        score_calibration_detail.get(RANKING_CANDIDATE_FIELD_WRITES_FIELD),
        Some(&json!([
            "weighted_score",
            "pipeline_score",
            "score_breakdown"
        ]))
    );
    assert_eq!(
        score_calibration_detail.get(RANKING_FUSED_GROUP_STAGES_FIELD),
        Some(&json!([
            "ScoreCalibrationScorer",
            "ContentQualityScorer",
            "AuthorAffinityScorer",
            "RecencyScorer",
            "ColdStartInterestScorer"
        ]))
    );

    let breakdown = result.candidates[0]
        .score_breakdown
        .as_ref()
        .expect("score breakdown exists");
    for key in [
        "calibrationSourceMultiplier",
        "contentQuality",
        "authorAffinityMultiplier",
        "recencyMultiplier",
        "coldStartInterestMultiplier",
        "trendAffinityMultiplier",
        "trendPersonalizationMultiplier",
        "newsTrendLinkMultiplier",
        "interestDecayMultiplier",
        "explorationMultiplier",
        "banditMultiplier",
        "fatigueMultiplier",
        "sessionSuppressionMultiplier",
        "oonFactor",
    ] {
        assert!(breakdown.contains_key(key), "missing breakdown key: {key}");
    }
}

#[test]
fn local_scorers_compute_weighted_and_final_scores() {
    let mut second = candidate("post-2", "author-b");
    second.is_news = Some(true);
    second.news_metadata = Some(CandidateNewsMetadataPayload {
        source_url: Some("https://example.com/news".to_string()),
        ..CandidateNewsMetadataPayload::default()
    });

    let result = run_local_scorers(&query(), vec![candidate("post-1", "author-a"), second]);
    assert_eq!(result.stages.len(), 19);
    let weighted_stage = result
        .stages
        .iter()
        .find(|stage| stage.name == "WeightedScorer")
        .expect("WeightedScorer stage");
    assert_eq!(
        weighted_stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get("weightedScorerPolicyVersion"))
            .and_then(|value| value.as_str()),
        Some("weighted_scorer_policy_v1")
    );
    assert_eq!(
        weighted_stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get("normalizationPositiveWeightSum"))
            .and_then(|value| value.as_f64()),
        Some(30.15)
    );
    assert_eq!(
        weighted_stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get(RANKING_CANDIDATE_FIELD_WRITES_FIELD)),
        Some(&json!([
            "weighted_score",
            "pipeline_score",
            "score_breakdown"
        ]))
    );
    let author_affinity_stage = result
        .stages
        .iter()
        .find(|stage| stage.name == "AuthorAffinityScorer")
        .expect("AuthorAffinityScorer stage");
    assert_eq!(
        author_affinity_stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get(RANKING_CANDIDATE_FIELD_WRITES_FIELD)),
        Some(&json!([
            "author_affinity_score",
            "weighted_score",
            "pipeline_score",
            "score_breakdown"
        ]))
    );
    let score_contract_stage = result
        .stages
        .iter()
        .find(|stage| stage.name == "ScoreContractScorer")
        .expect("ScoreContractScorer stage");
    assert_eq!(
        score_contract_stage
            .detail
            .as_ref()
            .and_then(|detail| detail.get(RANKING_CANDIDATE_FIELD_WRITES_FIELD)),
        Some(&json!([
            "score_contract_version",
            "score_breakdown_version",
            "score_breakdown"
        ]))
    );
    assert_eq!(
        result.stages[0]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingStageKind"))
            .and_then(|value| value.as_str()),
        Some("model_scores")
    );
    assert_eq!(
        result.stages[0]
            .detail
            .as_ref()
            .and_then(|detail| detail.get("rankingFallbackModelScorer"))
            .and_then(|value| value.as_bool()),
        Some(true)
    );
    let final_score_writers = result
        .stages
        .iter()
        .filter(|stage| {
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingWritesFinalScore"))
                .and_then(|value| value.as_bool())
                == Some(true)
        })
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(final_score_writers, vec!["AuthorDiversityScorer"]);
    let oon_index = result
        .stages
        .iter()
        .position(|stage| stage.name == "OutOfNetworkScorer")
        .expect("OutOfNetworkScorer stage");
    let diversity_index = result
        .stages
        .iter()
        .position(|stage| stage.name == "AuthorDiversityScorer")
        .expect("AuthorDiversityScorer stage");
    assert!(oon_index < diversity_index);
    assert!(
        result
            .stages
            .iter()
            .any(|stage| stage.name == "ScoreContractScorer" && stage.enabled)
    );
    assert!(result.candidates[0].weighted_score.unwrap_or_default() > 0.0);
    assert!(result.candidates[0].score.unwrap_or_default() > 0.0);
    assert!(result.candidates[0].action_scores.is_some());
    assert!(result.candidates[0].ranking_signals.is_some());
    assert!(
        result.candidates[0]
            .score_breakdown
            .as_ref()
            .is_some_and(|breakdown| breakdown.contains_key("normalizedWeightedScore"))
    );
    assert!(
        result.candidates[0]
            .score_breakdown
            .as_ref()
            .is_some_and(|breakdown| breakdown.contains_key(AUTHOR_AFFINITY_SCORE_FIELD))
    );
    assert!(
        result.candidates[1]
            .score_breakdown
            .as_ref()
            .is_some_and(|breakdown| breakdown.contains_key("oonFactor"))
    );
    assert_eq!(
        result.candidates[0].score_contract_version.as_deref(),
        Some("recommendation_score_contract_v2")
    );
    assert!(
        result.candidates[0]
            .score_breakdown
            .as_ref()
            .is_some_and(|breakdown| breakdown.contains_key("componentActionScore"))
    );
}

#[test]
fn mock_phoenix_scores_drive_ranking_and_top_k_selection() {
    let mut query = query();
    query.limit = 1;

    let mut weak = candidate("post-weak", "author-weak");
    weak.phoenix_scores = Some(PhoenixScoresPayload {
        like_score: Some(0.02),
        reply_score: Some(0.01),
        repost_score: Some(0.01),
        click_score: Some(0.04),
        ..PhoenixScoresPayload::default()
    });

    let mut strong = candidate("post-strong", "author-strong");
    strong.phoenix_scores = Some(PhoenixScoresPayload {
        like_score: Some(0.5),
        reply_score: Some(0.4),
        repost_score: Some(0.25),
        click_score: Some(0.7),
        dwell_score: Some(0.5),
        follow_author_score: Some(0.35),
        ..PhoenixScoresPayload::default()
    });

    let result = run_local_scorers(&query, vec![weak, strong]);
    let selected = select_candidates(&query, &result.candidates, 1, 10, 2);

    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].post_id, "post-strong");
    assert!(selected[0].weighted_score.unwrap_or_default() > 0.0);
    assert!(selected[0].score.unwrap_or_default() > 0.0);
}

#[test]
fn author_affinity_penalizes_negative_author_feedback() {
    let mut query = query();
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("block_author")),
        ("targetAuthorId".to_string(), json!("author-b")),
        ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
    ])]);

    let result = run_local_scorers(&query, vec![candidate("post-3", "author-b")]);
    let candidate = &result.candidates[0];
    assert!(candidate.author_affinity_score.unwrap_or_default() < 0.0);
    assert!(
        candidate
            .score_breakdown
            .as_ref()
            .and_then(|breakdown| breakdown.get("authorAffinityMultiplier"))
            .copied()
            .unwrap_or(1.0)
            < 1.0
    );
}

#[test]
fn direct_negative_feedback_downranks_matching_candidate() {
    let mut query = query();
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("not_interested")),
        ("targetPostId".to_string(), json!("post-6")),
        ("targetAuthorId".to_string(), json!("author-d")),
        ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
    ])]);

    let result = run_local_scorers(&query, vec![candidate("post-6", "author-d")]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get(NEGATIVE_FEEDBACK_STRENGTH_FIELD)
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        breakdown
            .get("negativeFeedbackMultiplier")
            .copied()
            .unwrap_or(1.0)
            < 1.0
    );
}

#[test]
fn semantic_negative_feedback_propagates_to_similar_candidates() {
    let mut query = query();
    query.ranking_policy = Some(RankingPolicyPayload {
        negative_feedback_propagation_weight: Some(0.6),
        negative_feedback_half_life_days: Some(90.0),
        ..RankingPolicyPayload::default()
    });
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("not_interested")),
        (
            "targetKeywords".to_string(),
            json!(["rust", "ranking", "delivery"]),
        ),
        (
            "actionText".to_string(),
            json!("rust ranking delivery worker"),
        ),
        ("timestamp".to_string(), json!("2026-04-25T00:00:00Z")),
    ])]);

    let mut candidate = candidate("post-related", "author-unrelated");
    candidate.content = "Rust ranking delivery worker fanout latency notes".to_string();

    let result = run_local_scorers(&query, vec![candidate]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get(NEGATIVE_FEEDBACK_STRENGTH_FIELD)
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        breakdown
            .get("negativeFeedbackMultiplier")
            .copied()
            .unwrap_or(1.0)
            < 1.0
    );
}

#[test]
fn calibration_keeps_in_network_candidate_rankable_when_source_policy_is_closed() {
    let mut query = query();
    query.user_state_context = Some(UserStateContextPayload {
        state: "cold_start".to_string(),
        reason: "bootstrap".to_string(),
        followed_count: 0,
        recent_action_count: 0,
        recent_positive_action_count: 0,
        usable_embedding: false,
        account_age_days: Some(1),
    });

    let mut candidate = candidate("post-in-network", "author-followed");
    candidate.in_network = Some(true);
    candidate.recall_source = Some("FollowingSource".to_string());

    let result = run_local_scorers(&query, vec![candidate]);
    let candidate = &result.candidates[0];
    let breakdown = candidate.score_breakdown.as_ref().unwrap();

    assert!(candidate.weighted_score.unwrap_or_default() > 0.0);
    assert_eq!(
        breakdown.get("calibrationSourceMultiplier").copied(),
        Some(1.0)
    );
}

#[test]
fn heuristic_weighted_fallback_keeps_unscored_candidates_rankable() {
    let mut candidate = candidate("post-4", "author-c");
    candidate.phoenix_scores = None;
    candidate.score_breakdown = Some(HashMap::from([
        (RETRIEVAL_SECONDARY_SOURCE_COUNT_FIELD.to_string(), 2.0),
        (RETRIEVAL_MULTI_SOURCE_BONUS_FIELD.to_string(), 0.06),
    ]));

    let result = run_local_scorers(&query(), vec![candidate]);
    let candidate = &result.candidates[0];

    assert!(candidate.weighted_score.unwrap_or_default() > 0.0);
    assert!(
        candidate
            .score_breakdown
            .as_ref()
            .and_then(|breakdown| breakdown.get("lightweightPhoenixFallbackUsed"))
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        candidate
            .score_breakdown
            .as_ref()
            .and_then(|breakdown| breakdown.get("calibrationEvidenceMultiplier"))
            .copied()
            .unwrap_or(1.0)
            > 1.0
    );
}

#[test]
fn lightweight_phoenix_uses_trend_news_and_source_quality_priors() {
    let mut candidate = candidate("post-news-prior", "author-news");
    candidate.phoenix_scores = None;
    candidate.is_news = Some(true);
    candidate.recall_source = Some("NewsAnnSource".to_string());
    candidate.retrieval_lane = Some("interest".to_string());
    candidate.content =
        "AI delivery ranking systems are becoming a major infrastructure topic".to_string();
    candidate.news_metadata = Some(CandidateNewsMetadataPayload {
        source: Some("bbc_world".to_string()),
        title: Some("AI delivery ranking systems draw attention".to_string()),
        ..CandidateNewsMetadataPayload::default()
    });
    candidate.score_breakdown = Some(HashMap::from([
        (TREND_AFFINITY_STRENGTH_FIELD.to_string(), 0.52),
        (SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD.to_string(), 0.84),
        (RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD.to_string(), 0.75),
    ]));

    let result = run_local_scorers(&query(), vec![candidate]);
    let candidate = &result.candidates[0];
    let actions = candidate.action_scores.expect("lightweight actions");
    let breakdown = candidate.score_breakdown.as_ref().unwrap();

    assert!(actions.repost > 0.12);
    assert!(actions.dwell > 0.18);
    assert!(
        breakdown
            .get("rankingTrendHeat")
            .copied()
            .unwrap_or_default()
            >= 0.5
    );
    assert!(
        breakdown
            .get("rankingContentKind")
            .copied()
            .unwrap_or_default()
            >= 0.7
    );
    assert!(
        breakdown
            .get("rankingSourceQuality")
            .copied()
            .unwrap_or_default()
            > 0.4
    );
    assert!(
        breakdown
            .get("weightedSignalPrior")
            .copied()
            .unwrap_or_default()
            > 0.0
    );
}

#[test]
fn stale_single_click_does_not_overboost_author_affinity() {
    let mut query = query();
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("click")),
        ("targetAuthorId".to_string(), json!("author-a")),
        ("timestamp".to_string(), json!("2026-03-20T00:00:00Z")),
    ])]);

    let result = run_local_scorers(&query, vec![candidate("post-5", "author-a")]);
    let candidate = &result.candidates[0];

    assert!(candidate.author_affinity_score.unwrap_or_default() <= 0.18);
    assert!(
        candidate
            .score_breakdown
            .as_ref()
            .and_then(|breakdown| breakdown.get("authorAffinityMultiplier"))
            .copied()
            .unwrap_or(1.0)
            < 1.1
    );
}

#[test]
fn exploration_scorer_marks_quality_novel_candidates() {
    let mut query = query();
    query.user_state_context = Some(UserStateContextPayload {
        state: "sparse".to_string(),
        reason: "light_activity".to_string(),
        followed_count: 2,
        recent_action_count: 4,
        recent_positive_action_count: 2,
        usable_embedding: false,
        account_age_days: Some(5),
    });

    let mut candidate = candidate("post-explore", "author-new");
    candidate.recall_source = Some("PopularSource".to_string());
    candidate.retrieval_lane = Some(FALLBACK_LANE.to_string());
    candidate.in_network = Some(false);

    let result = run_local_scorers(&query, vec![candidate]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();
    assert_eq!(
        breakdown.get(EXPLORATION_ELIGIBLE_FIELD).copied(),
        Some(1.0)
    );
    assert!(
        breakdown
            .get("explorationMultiplier")
            .copied()
            .unwrap_or(1.0)
            > 1.0
    );
}

#[test]
fn fatigue_scorer_penalizes_repeated_exposure() {
    let mut query = query();
    query.user_action_sequence = Some(
        (0..5)
            .map(|_| {
                HashMap::from([
                    ("action".to_string(), json!("impression")),
                    ("targetPostId".to_string(), json!("post-fatigue")),
                    ("targetAuthorId".to_string(), json!("author-fatigue")),
                    ("timestamp".to_string(), json!("2026-04-25T00:00:00Z")),
                ])
            })
            .collect(),
    );

    let result = run_local_scorers(&query, vec![candidate("post-fatigue", "author-fatigue")]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();
    assert!(
        breakdown
            .get(FATIGUE_STRENGTH_FIELD)
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(breakdown.get("fatigueMultiplier").copied().unwrap_or(1.0) < 1.0);
}

#[test]
fn interest_decay_scorer_applies_negative_feedback_penalty() {
    let mut query = query();
    query.ranking_policy = Some(RankingPolicyPayload {
        negative_feedback_penalty_weight: Some(0.5),
        interest_decay_half_life_hours: Some(12.0),
        ..RankingPolicyPayload::default()
    });
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("not_interested")),
        ("targetAuthorId".to_string(), json!("author-negative")),
        ("timestamp".to_string(), json!("2026-04-25T00:00:00Z")),
    ])]);

    let result = run_local_scorers(&query, vec![candidate("post-negative", "author-negative")]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get("interestDecayNegativePenalty")
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        breakdown
            .get("interestDecayMultiplier")
            .copied()
            .unwrap_or(1.0)
            < 1.0
    );
}

#[test]
fn trend_affinity_boosts_matching_candidates() {
    let mut query = query();
    query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["rust".to_string(), "ranking".to_string()]),
        trend_source_boost: Some(0.22),
        ..RankingPolicyPayload::default()
    });

    let mut candidate = candidate("post-trend", "author-trend");
    candidate.content = "Rust ranking pipeline improves recommendation latency".to_string();
    candidate.recall_source = Some("NewsAnnSource".to_string());
    candidate.retrieval_lane = Some("interest".to_string());

    let result = run_local_scorers(&query, vec![candidate]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get(TREND_AFFINITY_STRENGTH_FIELD)
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        breakdown
            .get("trendAffinityMultiplier")
            .copied()
            .unwrap_or(1.0)
            > 1.0
    );
}

#[test]
fn trend_personalization_uses_clicked_trend_keywords() {
    let mut query = query();
    query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["rust".to_string(), "ranking".to_string()]),
        trend_source_boost: Some(0.22),
        ..RankingPolicyPayload::default()
    });
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("click")),
        ("targetKeywords".to_string(), json!(["rust", "ranking"])),
        ("actionText".to_string(), json!("#rust #ranking")),
        ("productSurface".to_string(), json!("space_trends")),
        ("timestamp".to_string(), json!("2026-04-25T00:00:00Z")),
    ])]);

    let mut candidate = candidate("post-trend-personalized", "author-trend");
    candidate.content = "Rust ranking pipeline for recommendation systems".to_string();
    candidate.recall_source = Some("TwoTowerSource".to_string());
    candidate.retrieval_lane = Some("interest".to_string());

    let result = run_local_scorers(&query, vec![candidate]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get(TREND_PERSONALIZATION_STRENGTH_FIELD)
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        breakdown
            .get("trendPersonalizationMultiplier")
            .copied()
            .unwrap_or(1.0)
            > 1.0
    );
}

#[test]
fn news_trend_link_scorer_boosts_news_matching_active_trends() {
    let mut query = query();
    query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["ai".to_string(), "delivery".to_string()]),
        news_trend_link_boost: Some(0.18),
        ..RankingPolicyPayload::default()
    });

    let mut candidate = candidate("post-news-trend", "author-news");
    candidate.is_news = Some(true);
    candidate.recall_source = Some("NewsAnnSource".to_string());
    candidate.retrieval_lane = Some("interest".to_string());
    candidate.content = "AI delivery growth system update".to_string();
    candidate.news_metadata = Some(CandidateNewsMetadataPayload {
        title: Some("AI delivery systems are trending".to_string()),
        summary: Some("Delivery workers and AI infrastructure are in focus".to_string()),
        ..CandidateNewsMetadataPayload::default()
    });

    let result = run_local_scorers(&query, vec![candidate]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get("newsTrendLinkStrength")
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        breakdown
            .get("newsTrendLinkMultiplier")
            .copied()
            .unwrap_or(1.0)
            > 1.0
    );
}

#[test]
fn session_suppression_penalizes_semantic_repeat_exposure() {
    let mut query = query();
    query.ranking_policy = Some(RankingPolicyPayload {
        semantic_dedup_overlap_threshold: Some(0.2),
        session_topic_suppression_weight: Some(0.35),
        ..RankingPolicyPayload::default()
    });
    query.user_action_sequence = Some(vec![HashMap::from([
        ("action".to_string(), json!("impression")),
        (
            "content".to_string(),
            json!("Rust latency throughput ranking delivery worker"),
        ),
        ("timestamp".to_string(), json!("2026-04-25T00:00:00Z")),
    ])]);

    let mut candidate = candidate("post-semantic-repeat", "author-repeat");
    candidate.content = "Rust latency throughput ranking delivery worker notes".to_string();

    let result = run_local_scorers(&query, vec![candidate]);
    let breakdown = result.candidates[0].score_breakdown.as_ref().unwrap();

    assert!(
        breakdown
            .get("sessionSemanticOverlap")
            .copied()
            .unwrap_or_default()
            >= 0.2
    );
    assert!(
        breakdown
            .get("sessionSuppressionMultiplier")
            .copied()
            .unwrap_or(1.0)
            < 1.0
    );
}

#[test]
fn intra_request_diversity_penalizes_repeated_topic_candidates() {
    let mut first = candidate("post-topic-1", "author-1");
    first.content = "Rust ranking delivery throughput worker notes".to_string();
    first.like_count = Some(40.0);
    let mut second = candidate("post-topic-2", "author-2");
    second.content = "Rust ranking delivery throughput worker details".to_string();
    second.like_count = Some(4.0);

    let result = run_local_scorers(&query(), vec![first, second]);
    let second_breakdown = result.candidates[1].score_breakdown.as_ref().unwrap();

    assert!(
        second_breakdown
            .get("intraRequestRedundancyPenalty")
            .copied()
            .unwrap_or_default()
            > 0.0
    );
    assert!(
        second_breakdown
            .get("intraRequestDiversityMultiplier")
            .copied()
            .unwrap_or(1.0)
            < 1.0
    );
}
