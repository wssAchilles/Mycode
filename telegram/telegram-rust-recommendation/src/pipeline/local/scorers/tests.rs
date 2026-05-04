use chrono::{TimeZone, Utc};
use serde_json::json;
use std::collections::HashMap;

use crate::contracts::query::RankingPolicyPayload;
use crate::contracts::{
    CandidateNewsMetadataPayload, EmbeddingContextPayload, PhoenixScoresPayload,
    RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload,
};

use super::run_local_scorers;
use crate::pipeline::local::context::FALLBACK_LANE;
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

#[test]
fn local_scorer_ladder_has_stable_order_and_score_write_boundaries() {
    let result = run_local_scorers(&query(), vec![candidate("post-1", "author-a")]);
    let stage_names = result
        .stages
        .iter()
        .map(|stage| stage.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(stage_names, EXPECTED_LOCAL_SCORER_ORDER);

    for stage in &result.stages {
        assert_eq!(
            stage
                .detail
                .as_ref()
                .and_then(|detail| detail.get("rankingStageName"))
                .and_then(|value| value.as_str()),
            Some(stage.name.as_str())
        );
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
            .is_some_and(|breakdown| breakdown.contains_key("authorAffinityScore"))
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
            .get("negativeFeedbackStrength")
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
            .get("negativeFeedbackStrength")
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
        ("retrievalSecondarySourceCount".to_string(), 2.0),
        ("retrievalMultiSourceBonus".to_string(), 0.06),
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
        ("trendAffinityStrength".to_string(), 0.52),
        ("sourceNormalizedScore".to_string(), 0.84),
        ("retrievalSourceDiversityScore".to_string(), 0.75),
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
    assert_eq!(breakdown.get("explorationEligible").copied(), Some(1.0));
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
            .get("fatigueStrength")
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
            .get("trendAffinityStrength")
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
            .get("trendPersonalizationStrength")
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
