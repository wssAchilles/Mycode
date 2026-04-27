use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use chrono::Utc;
use reqwest::Url;
use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, ranking_policy_contract_version,
    ranking_policy_keywords, ranking_policy_number, ranking_policy_score_breakdown_version,
    related_post_ids, source_mixing_multiplier, source_retrieval_lane, space_feed_experiment_flag,
};
use super::scoring::apply_lightweight_phoenix_scores_with_profile;
use super::scoring::calibration::calibration_table_adjustment;
use super::signals::user_actions::UserActionProfile;

const LOCAL_EXECUTION_MODE: &str = "rust_local_scorers_v1";
const MIN_VIDEO_DURATION_SEC: f64 = 5.0;
const OON_WEIGHT_FACTOR: f64 = 0.7;
const POSITIVE_WEIGHT_SUM: f64 = 30.15;
const NEGATIVE_WEIGHT_SUM: f64 = 27.0;
const NEGATIVE_SCORES_OFFSET: f64 = 0.1;

struct WeightedScoreSummary {
    raw_score: f64,
    base_raw_score: f64,
    positive_score: f64,
    negative_score: f64,
    evidence_score: f64,
    action_scores_used: bool,
    heuristic_fallback_used: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct ContentQualitySummary {
    score: f64,
    quality_prior: f64,
    engagement_prior: f64,
    low_quality_penalty: f64,
}

#[derive(Debug, Clone, Copy, Default)]
struct NegativeFeedbackSummary {
    strength: f64,
    multiplier: f64,
}

pub struct LocalScoringExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub fn run_local_scorers(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalScoringExecution {
    let mut current = candidates;
    let mut stages = Vec::new();

    for scorer in [
        lightweight_phoenix_scorer as ScorerFn,
        weighted_scorer as ScorerFn,
        score_calibration_scorer,
        content_quality_scorer,
        author_affinity_scorer,
        recency_scorer,
        cold_start_interest_scorer,
        trend_affinity_scorer,
        trend_personalization_scorer,
        exploration_scorer,
        bandit_exploration_scorer,
        fatigue_scorer,
        session_suppression_scorer,
        intra_request_diversity_scorer,
        author_diversity_scorer,
        oon_scorer,
        score_contract_scorer,
    ] {
        let (next, stage) = scorer(query, current);
        current = next;
        stages.push(stage);
    }

    LocalScoringExecution {
        candidates: current,
        stages,
    }
}

type ScorerFn = fn(
    &RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
);

fn lightweight_phoenix_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let action_profile = UserActionProfile::from_query(query);
    for candidate in &mut candidates {
        apply_lightweight_phoenix_scores_with_profile(query, candidate, &action_profile);
    }
    (
        candidates,
        build_stage("LightweightPhoenixScorer", input_count, true, None),
    )
}

fn weighted_scorer(
    _query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        let weighted = compute_weighted_score(candidate);
        let normalized = normalize_weighted_score(weighted.raw_score);
        candidate.weighted_score = Some(normalized);
        candidate.pipeline_score = Some(normalized);
        merge_breakdown(candidate, "weightedRawScore", weighted.raw_score);
        merge_breakdown(candidate, "weightedBaseRawScore", weighted.base_raw_score);
        merge_breakdown(candidate, "weightedPositiveScore", weighted.positive_score);
        merge_breakdown(candidate, "weightedNegativeScore", weighted.negative_score);
        merge_breakdown(
            candidate,
            "weightedEvidencePrior",
            weighted.evidence_score / 0.12,
        );
        merge_breakdown(candidate, "weightedEvidenceLift", weighted.evidence_score);
        merge_breakdown(
            candidate,
            "weightedActionScoresUsed",
            weighted.action_scores_used as i32 as f64,
        );
        merge_breakdown(
            candidate,
            "weightedHeuristicFallbackUsed",
            weighted.heuristic_fallback_used as i32 as f64,
        );
        merge_breakdown(candidate, "positiveWeightSum", POSITIVE_WEIGHT_SUM);
        merge_breakdown(candidate, "negativeWeightSum", NEGATIVE_WEIGHT_SUM);
        merge_breakdown(candidate, "normalizedWeightedScore", normalized);
    }
    (
        candidates,
        build_stage("WeightedScorer", input_count, true, None),
    )
}

fn score_calibration_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_score_calibration_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("ScoreCalibrationScorer", input_count, false, None),
        );
    }

    let action_profile = UserActionProfile::from_query(query);
    for candidate in &mut candidates {
        let current = candidate.weighted_score.unwrap_or_default();
        let action_match = action_profile.match_candidate(candidate);
        let source_multiplier = calibration_source_multiplier(query, candidate);
        let quality_multiplier = match query.embedding_context.as_ref() {
            None => 0.97,
            Some(context) if !context.usable => 0.95,
            Some(context) if context.stale.unwrap_or(false) => {
                0.94 + clamp01(context.quality_score.unwrap_or_default()) * 0.05
            }
            Some(context) => 0.96 + clamp01(context.quality_score.unwrap_or_default()) * 0.08,
        };
        let freshness_multiplier = freshness_multiplier(candidate);
        let engagement_multiplier = engagement_multiplier(candidate);
        let evidence_multiplier = evidence_multiplier(candidate);
        let early_suppression = early_suppression(query, candidate);
        let negative_feedback = direct_negative_feedback(query, candidate);
        let behavior_multiplier = (1.0 + action_match.personalized_strength * 0.14
            - action_match.negative_feedback * 0.22
            - action_match.delivery_fatigue * 0.08)
            .clamp(0.72, 1.18);
        let calibration_table = calibration_table_adjustment(query, candidate, action_match);
        let user_state_multiplier = match query
            .user_state_context
            .as_ref()
            .map(|state| state.state.as_str())
        {
            Some("cold_start") => 0.97,
            Some("sparse") => 0.99,
            Some("heavy") => 1.02,
            _ => 1.0,
        };
        let adjusted = current
            * source_multiplier
            * quality_multiplier
            * freshness_multiplier
            * engagement_multiplier
            * evidence_multiplier
            * early_suppression.multiplier
            * negative_feedback.multiplier
            * behavior_multiplier
            * calibration_table.multiplier
            * user_state_multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "calibrationSourceMultiplier", source_multiplier);
        merge_breakdown(
            candidate,
            "calibrationEmbeddingQualityMultiplier",
            quality_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationFreshnessMultiplier",
            freshness_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationEngagementMultiplier",
            engagement_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationEvidenceMultiplier",
            evidence_multiplier,
        );
        merge_breakdown(
            candidate,
            "earlySuppressionStrength",
            early_suppression.strength,
        );
        merge_breakdown(
            candidate,
            "earlySuppressionMultiplier",
            early_suppression.multiplier,
        );
        merge_breakdown(
            candidate,
            "negativeFeedbackStrength",
            negative_feedback.strength,
        );
        merge_breakdown(
            candidate,
            "negativeFeedbackMultiplier",
            negative_feedback.multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationBehaviorMultiplier",
            behavior_multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationTableMultiplier",
            calibration_table.multiplier,
        );
        merge_breakdown(
            candidate,
            "calibrationLanePrior",
            calibration_table.lane_prior,
        );
        merge_breakdown(
            candidate,
            "calibrationSourcePrior",
            calibration_table.source_prior,
        );
        merge_breakdown(
            candidate,
            "calibrationEngagementPrior",
            calibration_table.engagement_prior,
        );
        merge_breakdown(
            candidate,
            "calibrationQualityPrior",
            calibration_table.quality_prior,
        );
        merge_breakdown(
            candidate,
            "calibrationBehaviorPrior",
            calibration_table.behavior_prior,
        );
        merge_breakdown(
            candidate,
            "calibrationPersonalizedStrength",
            action_match.personalized_strength,
        );
        merge_breakdown(
            candidate,
            "calibrationDeliveryFatigue",
            action_match.delivery_fatigue,
        );
        merge_breakdown(
            candidate,
            "calibrationUserStateMultiplier",
            user_state_multiplier,
        );
    }

    (
        candidates,
        build_stage("ScoreCalibrationScorer", input_count, true, None),
    )
}

fn content_quality_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_content_quality_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("ContentQualityScorer", input_count, false, None),
        );
    }

    for candidate in &mut candidates {
        let quality = compute_content_quality(candidate);
        let adjusted = candidate.weighted_score.unwrap_or_default()
            * (0.82 + quality.score * 0.36)
            * (1.0 - quality.low_quality_penalty * 0.18);
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "contentQuality", quality.score);
        merge_breakdown(candidate, "contentQualityPrior", quality.quality_prior);
        merge_breakdown(
            candidate,
            "contentEngagementPrior",
            quality.engagement_prior,
        );
        merge_breakdown(
            candidate,
            "contentLowQualityPenalty",
            quality.low_quality_penalty,
        );
    }

    (
        candidates,
        build_stage("ContentQualityScorer", input_count, true, None),
    )
}

fn calibration_source_multiplier(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let source_name = candidate.recall_source.as_deref().unwrap_or("");
    let policy_multiplier = source_mixing_multiplier(query, source_name);
    if policy_multiplier > 0.0 {
        return policy_multiplier;
    }

    if candidate.in_network == Some(true) || source_name == "FollowingSource" {
        return 1.0;
    }

    match source_retrieval_lane(source_name) {
        SOCIAL_EXPANSION_LANE => 0.92,
        INTEREST_LANE => 0.88,
        FALLBACK_LANE => 0.82,
        _ => 0.8,
    }
}

fn author_affinity_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_author_affinity_scorer", true)
        && query
            .user_action_sequence
            .as_ref()
            .is_some_and(|actions| !actions.is_empty());
    if !enabled {
        return (
            candidates,
            build_stage("AuthorAffinityScorer", input_count, false, None),
        );
    }

    let action_profile = UserActionProfile::from_query(query);
    for candidate in &mut candidates {
        let action_match = action_profile.match_candidate(candidate);
        let affinity_score = (action_match.author_affinity * 0.58
            + action_match.topic_affinity * 0.18
            + action_match.source_affinity * 0.1
            + action_match.conversation_affinity * 0.14
            - action_match.negative_feedback * 0.72
            - action_match.delivery_fatigue * 0.18)
            .clamp(-1.0, 1.0);
        let positive_score = clamp01(
            action_match.author_affinity.max(0.0) * 0.58
                + action_match.topic_affinity.max(0.0) * 0.18
                + action_match.source_affinity.max(0.0) * 0.1
                + action_match.conversation_affinity.max(0.0) * 0.14,
        );
        let negative_score = action_match.negative_feedback;
        let multiplier = if affinity_score >= 0.45 {
            1.08 + affinity_score * 0.34
        } else if affinity_score > 0.0 {
            1.02 + affinity_score * 0.24
        } else if affinity_score < 0.0 {
            (1.0 + affinity_score * 0.72).max(0.35)
        } else {
            1.0
        };
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.author_affinity_score = Some(affinity_score);
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "authorAffinityScore", affinity_score);
        merge_breakdown(candidate, "authorAffinityPositiveScore", positive_score);
        merge_breakdown(candidate, "authorAffinityNegativeScore", negative_score);
        merge_breakdown(
            candidate,
            "authorAffinityPositiveActions",
            action_match.positive_actions as f64,
        );
        merge_breakdown(
            candidate,
            "authorAffinityNegativeActions",
            action_match.negative_actions as f64,
        );
        merge_breakdown(
            candidate,
            "authorAffinityTopicScore",
            action_match.topic_affinity,
        );
        merge_breakdown(
            candidate,
            "authorAffinitySourceScore",
            action_match.source_affinity,
        );
        merge_breakdown(
            candidate,
            "authorAffinityConversationScore",
            action_match.conversation_affinity,
        );
        merge_breakdown(
            candidate,
            "authorAffinityDeliveryFatigue",
            action_match.delivery_fatigue,
        );
        merge_breakdown(candidate, "authorAffinityMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("AuthorAffinityScorer", input_count, true, None),
    )
}

fn recency_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_recency_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("RecencyScorer", input_count, false, None),
        );
    }

    let half_life_ms = ranking_policy_number(query, "freshness_half_life_hours", 6.0)
        .clamp(1.0, 168.0)
        * 60.0
        * 60.0
        * 1000.0;
    let now = Utc::now();
    for candidate in &mut candidates {
        let age_ms = now
            .signed_duration_since(candidate.created_at)
            .num_milliseconds()
            .max(0) as f64;
        let decay_factor = 0.5_f64.powf(age_ms / half_life_ms);
        let multiplier = 0.8 + (1.5 - 0.8) * decay_factor;
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "recencyMultiplier", multiplier);
        merge_breakdown(candidate, "ageHours", age_ms / (60.0 * 60.0 * 1000.0));
    }

    (
        candidates,
        build_stage("RecencyScorer", input_count, true, None),
    )
}

fn cold_start_interest_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_cold_start_interest_scorer", true)
        && user_state(query) == "cold_start";
    if !enabled {
        return (
            candidates,
            build_stage("ColdStartInterestScorer", input_count, false, None),
        );
    }

    let policy_keywords = ranking_policy_keywords(query, "cold_start_keywords");
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let policy_match = keyword_overlap_ratio(&candidate_keywords, &policy_keywords);
        let trend_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
        let language_match = query.language_code.as_ref().is_some_and(|language| {
            let language = language.trim().to_lowercase();
            !language.is_empty()
                && candidate_keywords
                    .iter()
                    .any(|keyword| keyword == &language || keyword.contains(&language))
        });
        let news_prior = if candidate.is_news == Some(true) {
            0.08
        } else {
            0.0
        };
        let fallback_prior = if candidate.retrieval_lane.as_deref() == Some(FALLBACK_LANE) {
            0.06
        } else {
            0.0
        };
        let strength = clamp01(
            policy_match * 0.46
                + trend_match * 0.28
                + (language_match as i32 as f64) * 0.08
                + news_prior
                + fallback_prior,
        );
        let multiplier = 1.0 + strength.min(0.28);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "coldStartInterestStrength", strength);
        merge_breakdown(candidate, "coldStartInterestPolicyMatch", policy_match);
        merge_breakdown(candidate, "coldStartInterestTrendMatch", trend_match);
        merge_breakdown(candidate, "coldStartInterestMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("ColdStartInterestScorer", input_count, true, None),
    )
}

fn trend_affinity_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    let enabled = space_feed_experiment_flag(query, "enable_trend_affinity_scorer", true)
        && !trend_keywords.is_empty();
    if !enabled {
        return (
            candidates,
            build_stage("TrendAffinityScorer", input_count, false, None),
        );
    }

    let boost = ranking_policy_number(query, "trend_source_boost", 0.16).clamp(0.0, 0.35);
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let trend_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
        if trend_match <= 0.0 {
            merge_breakdown(candidate, "trendAffinityMatch", 0.0);
            merge_breakdown(candidate, "trendAffinityMultiplier", 1.0);
            continue;
        }

        let lane = candidate.retrieval_lane.as_deref().unwrap_or_else(|| {
            source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or(""))
        });
        let lane_prior = match lane {
            INTEREST_LANE => 0.18,
            SOCIAL_EXPANSION_LANE => 0.12,
            FALLBACK_LANE => 0.08,
            _ => 0.04,
        };
        let news_prior = if candidate.is_news == Some(true) {
            0.12
        } else {
            0.0
        };
        let evidence_prior = candidate
            .recall_evidence
            .as_ref()
            .map(|evidence| evidence.confidence * 0.16)
            .unwrap_or_else(|| {
                breakdown_value(
                    candidate.score_breakdown.as_ref(),
                    "retrievalEvidenceConfidence",
                ) * 0.12
            });
        let freshness_prior = (freshness_multiplier(candidate) - 0.94).max(0.0) / 0.1 * 0.08;
        let strength = clamp01(
            trend_match * 0.62 + lane_prior + news_prior + evidence_prior + freshness_prior,
        );
        let multiplier = (1.0 + boost * strength).clamp(1.0, 1.16);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "trendAffinityMatch", trend_match);
        merge_breakdown(candidate, "trendAffinityStrength", strength);
        merge_breakdown(candidate, "trendAffinityMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("TrendAffinityScorer", input_count, true, None),
    )
}

fn trend_personalization_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let trend_keywords = ranking_policy_keywords(query, "trend_keywords");
    let action_profile = UserActionProfile::from_query(query);
    let enabled = space_feed_experiment_flag(query, "enable_trend_personalization_scorer", true)
        && !trend_keywords.is_empty()
        && action_profile.action_count > 0;
    if !enabled {
        return (
            candidates,
            build_stage("TrendPersonalizationScorer", input_count, false, None),
        );
    }

    let boost = ranking_policy_number(query, "trend_source_boost", 0.16).clamp(0.0, 0.35);
    for candidate in &mut candidates {
        let candidate_keywords = candidate_keyword_set(candidate);
        let trend_match = keyword_overlap_ratio(&candidate_keywords, &trend_keywords);
        if trend_match <= 0.0 {
            merge_breakdown(candidate, "trendPersonalizationMatch", 0.0);
            merge_breakdown(candidate, "trendPersonalizationStrength", 0.0);
            merge_breakdown(candidate, "trendPersonalizationMultiplier", 1.0);
            continue;
        }

        let action_match = action_profile.match_candidate(candidate);
        let personal_interest = clamp01(
            action_match.topic_affinity.max(0.0) * 0.56
                + action_match.author_affinity.max(0.0) * 0.18
                + action_match.source_affinity.max(0.0) * 0.16
                + action_match.conversation_affinity.max(0.0) * 0.1,
        );
        let interaction_confidence = clamp01((action_match.positive_actions.min(5) as f64) / 5.0);
        let negative_pressure = action_match.negative_feedback.max(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "negativeFeedbackStrength",
        ));
        let eligible = negative_pressure < 0.42;
        let strength = if eligible {
            clamp01(
                trend_match * 0.46 + personal_interest * 0.42 + interaction_confidence * 0.12
                    - negative_pressure * 0.36,
            )
        } else {
            0.0
        };
        let multiplier = (1.0 + boost * 0.9 * strength).clamp(1.0, 1.14);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "trendPersonalizationMatch", trend_match);
        merge_breakdown(candidate, "trendPersonalizationInterest", personal_interest);
        merge_breakdown(
            candidate,
            "trendPersonalizationInteractionConfidence",
            interaction_confidence,
        );
        merge_breakdown(
            candidate,
            "trendPersonalizationNegativePressure",
            negative_pressure,
        );
        merge_breakdown(candidate, "trendPersonalizationStrength", strength);
        merge_breakdown(candidate, "trendPersonalizationMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("TrendPersonalizationScorer", input_count, true, None),
    )
}

fn exploration_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_exploration_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("ExplorationScorer", input_count, false, None),
        );
    }

    let action_profile = UserActionProfile::from_query(query);
    let temporal = action_profile.temporal_summary();
    let configured_rate = ranking_policy_number(
        query,
        "exploration_rate",
        default_exploration_rate(user_state(query)),
    )
    .clamp(0.0, 0.5);
    let risk_ceiling =
        ranking_policy_number(query, "exploration_risk_ceiling", 0.58).clamp(0.12, 0.92);
    for candidate in &mut candidates {
        let action_match = action_profile.match_candidate(candidate);
        let signals = candidate.ranking_signals.unwrap_or_default();
        let lane = candidate.retrieval_lane.as_deref().unwrap_or_else(|| {
            source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or(""))
        });
        let novelty = clamp01(
            1.0 - action_match.author_affinity.max(0.0) * 0.36
                - action_match.topic_affinity.max(0.0) * 0.32
                - action_match.source_affinity.max(0.0) * 0.16
                - action_match.conversation_affinity.max(0.0) * 0.16,
        );
        let quality = signals.quality.max(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "contentQuality",
        ));
        let freshness = signals.freshness.max(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "rankingFreshness",
        ));
        let discovery_lane_prior = match lane {
            FALLBACK_LANE => 0.82,
            INTEREST_LANE => 0.68,
            SOCIAL_EXPANSION_LANE => 0.48,
            _ => 0.24,
        };
        let cold_start_relief = if user_state(query) == "cold_start" {
            0.22
        } else {
            0.0
        };
        let temporal_pressure =
            temporal.negative_pressure() * 0.28 + temporal.exposure_pressure() * 0.14;
        let temporal_interest = temporal.short_interest() * 0.18 + temporal.stable_interest() * 0.1;
        let risk = exploration_risk(candidate, action_match.negative_feedback);
        let trend_relief =
            breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength") * 0.08;
        let eligible = candidate.in_network != Some(true)
            && action_match.negative_feedback < 0.38
            && risk <= risk_ceiling
            && quality >= 0.42
            && novelty >= 0.32;
        let strength = if eligible {
            clamp01(
                configured_rate
                    * (novelty * 0.36
                        + quality * 0.24
                        + freshness * 0.14
                        + discovery_lane_prior * 0.18
                        + cold_start_relief
                        + temporal_interest
                        + trend_relief
                        - risk * 0.24
                        - temporal_pressure),
            )
        } else {
            0.0
        };
        let multiplier = (1.0 + strength).clamp(1.0, 1.16);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "explorationEligible", eligible as i32 as f64);
        merge_breakdown(candidate, "explorationRate", configured_rate);
        merge_breakdown(candidate, "explorationRisk", risk);
        merge_breakdown(candidate, "explorationRiskCeiling", risk_ceiling);
        merge_breakdown(candidate, "explorationNovelty", novelty);
        merge_breakdown(candidate, "explorationStrength", strength);
        merge_breakdown(candidate, "explorationMultiplier", multiplier);
        merge_breakdown(
            candidate,
            "temporalShortInterest",
            temporal.short_interest(),
        );
        merge_breakdown(
            candidate,
            "temporalStableInterest",
            temporal.stable_interest(),
        );
        merge_breakdown(
            candidate,
            "temporalNegativePressure",
            temporal.negative_pressure(),
        );
        merge_breakdown(
            candidate,
            "temporalExposurePressure",
            temporal.exposure_pressure(),
        );
    }

    (
        candidates,
        build_stage("ExplorationScorer", input_count, true, None),
    )
}

fn bandit_exploration_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_bandit_exploration_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("BanditExplorationScorer", input_count, false, None),
        );
    }

    let epsilon = ranking_policy_number(query, "bandit_exploration_rate", 0.08).clamp(0.0, 0.35);
    let uncertainty_weight =
        ranking_policy_number(query, "bandit_uncertainty_weight", 0.3).clamp(0.0, 0.7);
    let risk_ceiling =
        ranking_policy_number(query, "exploration_risk_ceiling", 0.58).clamp(0.12, 0.92);
    for candidate in &mut candidates {
        let trials = (candidate.view_count.unwrap_or_default()
            + breakdown_value(candidate.score_breakdown.as_ref(), "retrievalSourceRank").max(1.0))
        .max(1.0);
        let rewards = candidate.like_count.unwrap_or_default()
            + candidate.comment_count.unwrap_or_default() * 1.8
            + candidate.repost_count.unwrap_or_default() * 2.4
            + candidate
                .action_scores
                .as_ref()
                .map(|scores| {
                    scores.like * 2.0 + scores.reply * 3.0 + scores.repost * 2.8 + scores.dwell
                })
                .unwrap_or_default();
        let posterior_mean = (1.0 + rewards).ln_1p() / (2.0 + trials).ln_1p();
        let uncertainty = (1.0 / (1.0 + trials.ln_1p())).clamp(0.0, 1.0);
        let deterministic_jitter = stable_unit_interval(&query.request_id, &candidate.post_id);
        let novelty = breakdown_value(candidate.score_breakdown.as_ref(), "explorationNovelty");
        let risk = exploration_risk(
            candidate,
            breakdown_value(
                candidate.score_breakdown.as_ref(),
                "negativeFeedbackStrength",
            ),
        );
        let trend_strength =
            breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength");
        let eligible = candidate.in_network != Some(true)
            && breakdown_value(
                candidate.score_breakdown.as_ref(),
                "negativeFeedbackStrength",
            ) < 0.45
            && risk <= risk_ceiling;
        let lift = if eligible {
            epsilon
                * (posterior_mean * 0.36
                    + uncertainty * uncertainty_weight
                    + novelty * 0.22
                    + trend_strength * 0.12
                    + deterministic_jitter * 0.12)
        } else {
            0.0
        };
        let multiplier = (1.0 + lift).clamp(1.0, 1.12);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "banditEligible", eligible as i32 as f64);
        merge_breakdown(candidate, "banditEpsilon", epsilon);
        merge_breakdown(candidate, "banditPosteriorMean", posterior_mean);
        merge_breakdown(candidate, "banditUncertainty", uncertainty);
        merge_breakdown(candidate, "banditUncertaintyWeight", uncertainty_weight);
        merge_breakdown(candidate, "banditRisk", risk);
        merge_breakdown(candidate, "banditJitter", deterministic_jitter);
        merge_breakdown(candidate, "banditMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("BanditExplorationScorer", input_count, true, None),
    )
}

fn fatigue_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_fatigue_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("FatigueScorer", input_count, false, None),
        );
    }

    let action_profile = UserActionProfile::from_query(query);
    let temporal = action_profile.temporal_summary();
    for candidate in &mut candidates {
        let action_match = action_profile.match_candidate(candidate);
        let cross_page_pressure = cross_page_pressure(query, candidate);
        let fatigue_strength = clamp01(
            action_match.delivery_fatigue * 0.58
                + action_match.negative_feedback * 0.2
                + temporal.exposure_pressure() * 0.12
                + cross_page_pressure * 0.1,
        );
        let multiplier = (1.0 - fatigue_strength * 0.34).clamp(0.6, 1.0);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "fatigueStrength", fatigue_strength);
        merge_breakdown(candidate, "fatigueDelivery", action_match.delivery_fatigue);
        merge_breakdown(
            candidate,
            "fatigueNegativeFeedback",
            action_match.negative_feedback,
        );
        merge_breakdown(candidate, "fatigueCrossPagePressure", cross_page_pressure);
        merge_breakdown(candidate, "fatigueMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("FatigueScorer", input_count, true, None),
    )
}

fn session_suppression_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_session_suppression_scorer", true);
    if !enabled {
        return (
            candidates,
            build_stage("SessionSuppressionScorer", input_count, false, None),
        );
    }

    for candidate in &mut candidates {
        let semantic_overlap = recent_action_token_overlap(query, candidate);
        let semantic_threshold =
            ranking_policy_number(query, "semantic_dedup_overlap_threshold", 0.62).clamp(0.2, 0.95);
        let semantic_suppression = if semantic_overlap >= semantic_threshold {
            ((semantic_overlap - semantic_threshold) / (1.0 - semantic_threshold)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let topic_weight =
            ranking_policy_number(query, "session_topic_suppression_weight", 0.2).clamp(0.0, 0.5);
        let served_related = related_post_ids(candidate)
            .into_iter()
            .filter(|id| query.served_ids.contains(id) || query.seen_ids.contains(id))
            .count() as f64;
        let author_served = query
            .served_ids
            .iter()
            .filter(|id| id.as_str() == candidate.author_id)
            .count() as f64;
        let topic_served = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
            .map(|cluster_id| format!("news:cluster:{cluster_id}"))
            .map(|key| query.served_ids.iter().filter(|id| *id == &key).count() as f64)
            .unwrap_or_default();
        let trend_topic_match = keyword_overlap_ratio(
            &candidate_keyword_set(candidate),
            &ranking_policy_keywords(query, "trend_keywords"),
        );
        let trend_topic_pressure = if trend_topic_match > 0.0 && topic_served > 0.0 {
            trend_topic_match * 0.1
        } else {
            0.0
        };
        let suppression = clamp01(
            served_related * 0.34
                + author_served * 0.08
                + topic_served * 0.18
                + semantic_suppression * topic_weight
                + trend_topic_pressure,
        );
        let multiplier = (1.0 - suppression * 0.42).clamp(0.58, 1.0);
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "sessionSuppressionStrength", suppression);
        merge_breakdown(candidate, "sessionSemanticOverlap", semantic_overlap);
        merge_breakdown(
            candidate,
            "sessionSemanticSuppression",
            semantic_suppression,
        );
        merge_breakdown(candidate, "sessionTrendTopicPressure", trend_topic_pressure);
        merge_breakdown(candidate, "sessionSuppressionMultiplier", multiplier);
    }

    (
        candidates,
        build_stage("SessionSuppressionScorer", input_count, true, None),
    )
}

fn intra_request_diversity_scorer(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let mut next = candidates;
    let mut ordered = next
        .iter()
        .enumerate()
        .map(|(index, candidate)| (index, candidate.weighted_score.unwrap_or_default()))
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut author_counts = HashMap::<String, usize>::new();
    let mut source_counts = HashMap::<String, usize>::new();
    let mut topic_counts = HashMap::<String, usize>::new();
    let mut seen_token_sets = Vec::<HashSet<String>>::new();

    for (index, _) in ordered {
        let author_repeat = author_counts
            .get(&next[index].author_id)
            .copied()
            .unwrap_or_default();
        let source_key = request_source_key(&next[index]);
        let source_repeat = source_counts.get(&source_key).copied().unwrap_or_default();
        let topic_key = request_topic_key(&next[index]);
        let topic_repeat = topic_counts.get(&topic_key).copied().unwrap_or_default();
        let candidate_tokens = candidate_semantic_tokens(&next[index])
            .into_iter()
            .collect::<HashSet<_>>();
        let semantic_overlap = seen_token_sets
            .iter()
            .map(|seen| jaccard_overlap(&candidate_tokens, seen))
            .fold(0.0, f64::max);
        let trend_protection = breakdown_value(
            next[index].score_breakdown.as_ref(),
            "trendPersonalizationStrength",
        )
        .max(breakdown_value(
            next[index].score_breakdown.as_ref(),
            "trendAffinityStrength",
        )) * 0.32;
        let evidence_protection = breakdown_value(
            next[index].score_breakdown.as_ref(),
            "retrievalEvidenceConfidence",
        ) * 0.08;
        let raw_penalty = (author_repeat as f64 * 0.05)
            + (source_repeat as f64 * 0.026)
            + (topic_repeat as f64 * 0.045)
            + semantic_overlap * 0.12;
        let protection = (trend_protection + evidence_protection).clamp(0.0, 0.38);
        let penalty = (raw_penalty * (1.0 - protection)).clamp(0.0, 0.24);
        let multiplier = 1.0 - penalty;
        let adjusted = next[index].weighted_score.unwrap_or_default() * multiplier;
        next[index].weighted_score = Some(adjusted);
        next[index].pipeline_score = Some(adjusted);
        merge_breakdown(&mut next[index], "intraRequestRedundancyPenalty", penalty);
        merge_breakdown(
            &mut next[index],
            "intraRequestSemanticOverlap",
            semantic_overlap,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestAuthorRepeat",
            author_repeat as f64,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestSourceRepeat",
            source_repeat as f64,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestTopicRepeat",
            topic_repeat as f64,
        );
        merge_breakdown(
            &mut next[index],
            "intraRequestDiversityMultiplier",
            multiplier,
        );

        *author_counts
            .entry(next[index].author_id.clone())
            .or_insert(0) += 1;
        *source_counts.entry(source_key).or_insert(0) += 1;
        *topic_counts.entry(topic_key).or_insert(0) += 1;
        if !candidate_tokens.is_empty() {
            seen_token_sets.push(candidate_tokens);
        }
    }

    (
        next,
        build_stage("IntraRequestDiversityScorer", input_count, true, None),
    )
}

fn author_diversity_scorer(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let mut next = candidates;
    let mut ordered = next
        .iter()
        .enumerate()
        .map(|(index, candidate)| (index, candidate.weighted_score.unwrap_or_default()))
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut key_counts = HashMap::<String, usize>::new();
    for (index, _) in ordered {
        let diversity_key = diversity_key(&next[index]);
        let position = key_counts.get(&diversity_key).copied().unwrap_or_default();
        key_counts.insert(diversity_key, position + 1);
        let multi_source_softener = 1.0
            + next[index]
                .secondary_recall_sources
                .as_ref()
                .map(|sources| ((sources.len() as f64) * 0.02).min(0.06))
                .unwrap_or_default();
        let recall_evidence_softener = 1.0
            + next[index]
                .recall_evidence
                .as_ref()
                .map(|evidence| ((evidence.source_count - 1.0).max(0.0) * 0.015).min(0.045))
                .unwrap_or_default();
        let multiplier = ((1.0 - 0.3) * 0.8_f64.powi(position as i32) + 0.3)
            * multi_source_softener
            * recall_evidence_softener;
        let adjusted = next[index].weighted_score.unwrap_or_default() * multiplier;
        next[index].score = Some(adjusted);
        next[index].pipeline_score = Some(adjusted);
        merge_breakdown(&mut next[index], "diversityMultiplier", multiplier);
    }

    (
        next,
        build_stage("AuthorDiversityScorer", input_count, true, None),
    )
}

fn oon_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    for candidate in &mut candidates {
        let base = candidate
            .score
            .or(candidate.weighted_score)
            .unwrap_or_default();
        let factor = if candidate.in_network == Some(false) {
            oon_factor(query, candidate)
        } else {
            1.0
        };
        let adjusted = base * factor;
        candidate.score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "baseScore", base);
        merge_breakdown(candidate, "oonFactor", factor);
    }
    (
        candidates,
        build_stage("OutOfNetworkScorer", input_count, true, None),
    )
}

fn score_contract_scorer(
    query: &RecommendationQueryPayload,
    mut candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let contract_version = ranking_policy_contract_version(query).to_string();
    let breakdown_version = ranking_policy_score_breakdown_version(query).to_string();
    for candidate in &mut candidates {
        candidate.score_contract_version = Some(contract_version.clone());
        candidate.score_breakdown_version = Some(breakdown_version.clone());

        let action_score =
            breakdown_value(candidate.score_breakdown.as_ref(), "weightedPositiveScore");
        let quality_score = breakdown_value(candidate.score_breakdown.as_ref(), "contentQuality");
        let freshness_score =
            breakdown_value(candidate.score_breakdown.as_ref(), "recencyMultiplier");
        let diversity_multiplier =
            breakdown_value(candidate.score_breakdown.as_ref(), "diversityMultiplier");
        let negative_penalty = breakdown_value(
            candidate.score_breakdown.as_ref(),
            "negativeFeedbackStrength",
        )
        .max(breakdown_value(
            candidate.score_breakdown.as_ref(),
            "earlySuppressionStrength",
        ));
        let source_multiplier = breakdown_value(
            candidate.score_breakdown.as_ref(),
            "calibrationSourceMultiplier",
        )
        .max(1.0);
        let behavior_multiplier = breakdown_value(
            candidate.score_breakdown.as_ref(),
            "calibrationBehaviorMultiplier",
        )
        .max(1.0);
        let calibration_multiplier = source_multiplier * behavior_multiplier;

        merge_breakdown(candidate, "scoreContractVersion", 2.0);
        merge_breakdown(candidate, "scoreBreakdownVersion", 2.0);
        merge_breakdown(
            candidate,
            "componentBaseScore",
            candidate.score.unwrap_or_default(),
        );
        merge_breakdown(candidate, "componentActionScore", action_score);
        merge_breakdown(candidate, "componentQualityScore", quality_score);
        merge_breakdown(candidate, "componentFreshnessScore", freshness_score);
        merge_breakdown(
            candidate,
            "componentDiversityPenalty",
            (1.0 - diversity_multiplier).max(0.0),
        );
        merge_breakdown(candidate, "componentNegativePenalty", negative_penalty);
        merge_breakdown(
            candidate,
            "componentCalibrationMultiplier",
            calibration_multiplier,
        );
    }

    (
        candidates,
        build_stage("ScoreContractScorer", input_count, true, None),
    )
}

fn compute_weighted_score(candidate: &RecommendationCandidatePayload) -> WeightedScoreSummary {
    let video_quality_weight =
        if candidate.video_duration_sec.unwrap_or_default() > MIN_VIDEO_DURATION_SEC {
            3.0
        } else {
            0.0
        };
    let (positive_score, negative_score, action_scores_used, heuristic_fallback_used) =
        if let Some(scores) = candidate.phoenix_scores.as_ref() {
            (
                scores.like_score.unwrap_or_default() * 2.0
                    + scores.reply_score.unwrap_or_default() * 5.0
                    + scores.repost_score.unwrap_or_default() * 4.0
                    + scores.quote_score.unwrap_or_default() * 4.5
                    + scores.photo_expand_score.unwrap_or_default() * 1.0
                    + scores.click_score.unwrap_or_default() * 0.5
                    + scores.quoted_click_score.unwrap_or_default() * 0.8
                    + scores.profile_click_score.unwrap_or_default() * 1.0
                    + scores.video_quality_view_score.unwrap_or_default() * video_quality_weight
                    + scores.share_score.unwrap_or_default() * 2.5
                    + scores.share_via_dm_score.unwrap_or_default() * 2.0
                    + scores.share_via_copy_link_score.unwrap_or_default() * 1.5
                    + scores.dwell_score.unwrap_or_default() * 0.3
                    + scores.dwell_time.unwrap_or_default() * 0.05
                    + scores.follow_author_score.unwrap_or_default() * 2.4,
                scores.not_interested_score.unwrap_or_default() * 5.0
                    + scores.dismiss_score.unwrap_or_default() * 5.0
                    + scores.block_author_score.unwrap_or_default() * 10.0
                    + scores.block_score.unwrap_or_default() * 10.0
                    + scores.mute_author_score.unwrap_or_default() * 4.0
                    + scores.report_score.unwrap_or_default() * 8.0,
                false,
                false,
            )
        } else if let Some(scores) = candidate.action_scores.as_ref() {
            (
                scores.like * 2.0
                    + scores.reply * 5.0
                    + scores.repost * 4.0
                    + scores.click * 0.5
                    + scores.dwell * 0.3,
                scores.negative * 12.0,
                true,
                false,
            )
        } else {
            let engagements = candidate.like_count.unwrap_or_default()
                + candidate.comment_count.unwrap_or_default() * 2.0
                + candidate.repost_count.unwrap_or_default() * 3.0;
            let views = candidate.view_count.unwrap_or(1.0).max(1.0);
            let engagement_rate = clamp01((engagements / views) / 0.12);
            let reply_proxy = clamp01(candidate.comment_count.unwrap_or_default() / 8.0);
            let repost_proxy = clamp01(candidate.repost_count.unwrap_or_default() / 6.0);
            let click_proxy =
                if candidate.has_image == Some(true) || candidate.has_video == Some(true) {
                    0.18
                } else {
                    0.08
                };
            let content_proxy = clamp01(candidate.content.chars().count() as f64 / 280.0);
            let follow_proxy =
                clamp01(candidate.author_affinity_score.unwrap_or_default().max(0.0));
            let retrieval_author_prior = candidate
                .score_breakdown
                .as_ref()
                .and_then(|breakdown| breakdown.get("retrievalAuthorPrior"))
                .copied()
                .unwrap_or_default();
            let retrieval_dense_support = candidate
                .score_breakdown
                .as_ref()
                .and_then(|breakdown| breakdown.get("retrievalDenseVectorScore"))
                .copied()
                .unwrap_or_default();
            let retrieval_cluster_support = candidate
                .score_breakdown
                .as_ref()
                .and_then(|breakdown| breakdown.get("retrievalCandidateClusterScore"))
                .copied()
                .unwrap_or_default();
            let retrieval_support = retrieval_author_prior * 0.45
                + retrieval_dense_support * 0.3
                + retrieval_cluster_support * 0.25;
            (
                engagement_rate * 3.1
                    + reply_proxy * 3.8
                    + repost_proxy * 3.3
                    + click_proxy * 1.2
                    + content_proxy * 0.9
                    + follow_proxy * 2.2
                    + retrieval_support * 1.7,
                0.0,
                false,
                true,
            )
        };

    let base_raw_score = positive_score - negative_score;
    let evidence_score = if base_raw_score > 0.0 {
        weighted_evidence_prior(candidate) * 0.12
    } else {
        0.0
    };

    WeightedScoreSummary {
        raw_score: base_raw_score + evidence_score,
        base_raw_score,
        positive_score,
        negative_score,
        evidence_score,
        action_scores_used,
        heuristic_fallback_used,
    }
}

fn weighted_evidence_prior(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    let secondary_source_count = breakdown
        .and_then(|breakdown| breakdown.get("retrievalSecondarySourceCount"))
        .copied()
        .unwrap_or_default();
    let cross_lane_source_count = breakdown
        .and_then(|breakdown| breakdown.get("retrievalCrossLaneSourceCount"))
        .copied()
        .unwrap_or_default();
    let evidence_confidence = breakdown
        .and_then(|breakdown| breakdown.get("retrievalEvidenceConfidence"))
        .copied()
        .unwrap_or_default();
    let multi_source_bonus = breakdown
        .and_then(|breakdown| breakdown.get("retrievalMultiSourceBonus"))
        .copied()
        .unwrap_or_default();
    let recall_confidence = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| evidence.confidence)
        .unwrap_or_default();
    let recall_source_count = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| evidence.source_count)
        .unwrap_or_default();

    clamp01(
        secondary_source_count * 0.16
            + cross_lane_source_count * 0.22
            + evidence_confidence * 0.28
            + multi_source_bonus * 1.1
            + recall_confidence * 0.18
            + (recall_source_count - 1.0).max(0.0) * 0.08,
    )
}

fn normalize_weighted_score(raw_score: f64) -> f64 {
    if raw_score < 0.0 {
        (((raw_score + NEGATIVE_WEIGHT_SUM) / POSITIVE_WEIGHT_SUM) * NEGATIVE_SCORES_OFFSET)
            .max(0.0)
    } else {
        raw_score / POSITIVE_WEIGHT_SUM + NEGATIVE_SCORES_OFFSET
    }
}

fn freshness_multiplier(candidate: &RecommendationCandidatePayload) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_hours()
        .max(0);
    match age_hours {
        0..=24 => 1.04,
        25..=72 => 1.02,
        73..=168 => 1.0,
        169..=720 => 0.97,
        _ => 0.94,
    }
}

fn engagement_multiplier(candidate: &RecommendationCandidatePayload) -> f64 {
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    if engagements >= 60.0 {
        1.05
    } else if engagements >= 20.0 {
        1.02
    } else if engagements >= 5.0 {
        1.0
    } else {
        0.97
    }
}

fn evidence_multiplier(candidate: &RecommendationCandidatePayload) -> f64 {
    let secondary_source_count = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get("retrievalSecondarySourceCount"))
        .copied()
        .unwrap_or_default();
    let retrieval_multi_source_bonus = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get("retrievalMultiSourceBonus"))
        .copied()
        .unwrap_or_default();
    let retrieval_cross_lane_bonus = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get("retrievalCrossLaneBonus"))
        .copied()
        .unwrap_or_default();
    let retrieval_evidence_confidence = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get("retrievalEvidenceConfidence"))
        .copied()
        .unwrap_or_default();
    1.0 + retrieval_multi_source_bonus.min(0.1)
        + retrieval_cross_lane_bonus.min(0.06)
        + (secondary_source_count * 0.008).min(0.04)
        + (retrieval_evidence_confidence * 0.02).min(0.02)
}

fn early_suppression(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> NegativeFeedbackSummary {
    let mut strength: f64 = 0.0;

    if query
        .user_features
        .as_ref()
        .is_some_and(|features| features.blocked_user_ids.contains(&candidate.author_id))
    {
        strength = strength.max(1.0);
    }

    let content = format!(
        "{} {}",
        candidate.content.to_lowercase(),
        candidate
            .author_username
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
    );
    for keyword in query
        .user_features
        .as_ref()
        .map(|features| features.muted_keywords.as_slice())
        .unwrap_or_default()
    {
        let normalized = keyword.trim().to_lowercase();
        if !normalized.is_empty() && content.contains(&normalized) {
            strength = strength.max(0.52);
        }
    }

    if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
    {
        strength = strength.max(0.9);
    } else if candidate.is_nsfw == Some(true) {
        strength = strength.max(0.46);
    }

    let strength = clamp01(strength);
    NegativeFeedbackSummary {
        strength,
        multiplier: (1.0 - strength * 0.86).clamp(0.08, 1.0),
    }
}

fn direct_negative_feedback(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> NegativeFeedbackSummary {
    let Some(actions) = query.user_action_sequence.as_ref() else {
        return NegativeFeedbackSummary {
            strength: 0.0,
            multiplier: 1.0,
        };
    };

    let now = Utc::now();
    let mut strength: f64 = 0.0;
    for action in actions {
        let action_name = action
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let base = match action_name {
            "dismiss" => 0.32,
            "not_interested" => 0.45,
            "mute_author" => 0.62,
            "block_author" => 0.84,
            "report" => 0.78,
            _ => 0.0,
        };
        if base <= 0.0 {
            continue;
        }

        let post_match = action_string(
            action,
            &[
                "targetPostId",
                "target_post_id",
                "modelPostId",
                "model_post_id",
            ],
        )
        .is_some_and(|target| {
            target == candidate.post_id
                || candidate
                    .model_post_id
                    .as_ref()
                    .is_some_and(|model_id| target == *model_id)
        });
        let author_match = action_string(action, &["targetAuthorId", "target_author_id"])
            .is_some_and(|target| target == candidate.author_id);
        if !post_match && !author_match {
            continue;
        }

        let age_days = action
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|timestamp| {
                now.signed_duration_since(timestamp.with_timezone(&Utc))
                    .num_seconds()
                    .max(0) as f64
                    / 86_400.0
            })
            .unwrap_or_default();
        let half_life_days =
            ranking_policy_number(query, "negative_feedback_half_life_days", 22.8).clamp(1.0, 90.0);
        let recency = 0.5_f64.powf(age_days.min(90.0) / half_life_days);
        let target_factor = if post_match { 1.0 } else { 0.56 };
        strength += base * recency * target_factor;
    }

    let strength = clamp01(strength);
    NegativeFeedbackSummary {
        strength,
        multiplier: (1.0 - strength * 0.45).clamp(0.52, 1.0),
    }
}

fn action_string(action: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(as_string) = value.as_str() {
            return Some(as_string.to_string());
        }
        if let Some(as_oid) = value
            .as_object()
            .and_then(|object| object.get("$oid").or_else(|| object.get("oid")))
            .and_then(Value::as_str)
        {
            return Some(as_oid.to_string());
        }
    }
    None
}

fn exploration_risk(candidate: &RecommendationCandidatePayload, action_negative: f64) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    let negative = action_negative
        .max(breakdown_value(breakdown, "negativeFeedbackStrength"))
        .max(breakdown_value(breakdown, "earlySuppressionStrength"));
    let fatigue = breakdown_value(breakdown, "fatigueStrength")
        .max(breakdown_value(breakdown, "calibrationDeliveryFatigue"));
    let quality = breakdown_value(breakdown, "contentQuality").max(
        candidate
            .ranking_signals
            .map(|signals| signals.quality)
            .unwrap_or_default(),
    );
    let low_quality = breakdown_value(breakdown, "contentLowQualityPenalty");
    let stale_penalty = if Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_hours()
        > 168
    {
        0.12
    } else {
        0.0
    };

    clamp01(
        negative * 0.42
            + fatigue * 0.18
            + low_quality * 0.18
            + (1.0 - quality).max(0.0) * 0.14
            + stale_penalty,
    )
}

fn recent_action_token_overlap(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let candidate_tokens = candidate_semantic_tokens(candidate);
    if candidate_tokens.is_empty() {
        return 0.0;
    }
    let candidate_set = candidate_tokens.into_iter().collect::<HashSet<_>>();

    query
        .user_action_sequence
        .as_ref()
        .into_iter()
        .flatten()
        .chain(
            query
                .model_user_action_sequence
                .as_ref()
                .into_iter()
                .flatten(),
        )
        .filter(|action| {
            action
                .get("action")
                .and_then(Value::as_str)
                .map(|name| {
                    matches!(
                        name,
                        "delivery" | "impression" | "view" | "click" | "dwell" | "read"
                    )
                })
                .unwrap_or(false)
        })
        .filter_map(action_text)
        .map(|text| tokenize_semantic_text(&text))
        .filter(|tokens| !tokens.is_empty())
        .map(|tokens| {
            let action_set = tokens.into_iter().collect::<HashSet<_>>();
            let intersection = candidate_set.intersection(&action_set).count() as f64;
            let union = candidate_set.union(&action_set).count().max(1) as f64;
            intersection / union
        })
        .fold(0.0, f64::max)
}

fn action_text(action: &HashMap<String, Value>) -> Option<String> {
    let mut parts = Vec::new();
    for key in [
        "content",
        "text",
        "body",
        "title",
        "summary",
        "targetContent",
        "targetText",
        "targetTitle",
        "actionText",
        "action_text",
    ] {
        if let Some(value) = action.get(key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn compute_content_quality(candidate: &RecommendationCandidatePayload) -> ContentQualitySummary {
    let content_length = candidate.content.chars().count();
    let length_score = if content_length < 10 {
        0.3
    } else if content_length <= 280 {
        0.8 + content_length as f64 / 280.0 * 0.2
    } else if content_length <= 1_000 {
        0.9
    } else {
        0.7
    };

    let media_score = (candidate.has_image == Some(true)) as i32 as f64 * 0.1
        + (candidate.has_video == Some(true)) as i32 as f64 * 0.15;
    let media_prior = media_score.min(0.2) / 0.2;
    let structure_prior = if candidate.is_reply {
        0.86
    } else if candidate.is_repost {
        0.78
    } else {
        1.0
    };
    let quality_prior = clamp01(length_score * 0.58 + media_prior * 0.22 + structure_prior * 0.2);

    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let engagement_prior = clamp01((engagements / views) / 0.12);
    let low_quality_penalty = low_quality_penalty(
        candidate,
        content_length,
        engagements,
        quality_prior,
        engagement_prior,
    );
    let score = clamp01(
        quality_prior * 0.66
            + engagement_prior * 0.24
            + candidate
                .author_affinity_score
                .unwrap_or_default()
                .max(0.0)
                .min(0.2)
                * 0.1
            - low_quality_penalty * 0.18,
    );
    ContentQualitySummary {
        score,
        quality_prior,
        engagement_prior,
        low_quality_penalty,
    }
}

fn low_quality_penalty(
    candidate: &RecommendationCandidatePayload,
    content_length: usize,
    engagements: f64,
    quality_prior: f64,
    engagement_prior: f64,
) -> f64 {
    let short_content_penalty = if content_length < 8 { 0.34 } else { 0.0 };
    let empty_media_penalty = if candidate.has_image != Some(true)
        && candidate.has_video != Some(true)
        && content_length < 28
    {
        0.18
    } else {
        0.0
    };
    let stale_low_signal_penalty =
        if engagements < 2.0 && engagement_prior < 0.04 && quality_prior < 0.58 {
            0.22
        } else {
            0.0
        };
    let repost_penalty = if candidate.is_repost && content_length < 24 {
        0.12
    } else {
        0.0
    };
    clamp01(short_content_penalty + empty_media_penalty + stale_low_signal_penalty + repost_penalty)
}

fn diversity_key(candidate: &RecommendationCandidatePayload) -> String {
    if candidate.is_news == Some(true) {
        if let Some(url) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source_url.clone().or(metadata.url.clone()))
        {
            if let Ok(parsed) = Url::parse(&url) {
                if parsed.scheme() == "http" || parsed.scheme() == "https" {
                    if let Some(host) = parsed.host_str() {
                        return format!("news:domain:{host}");
                    }
                }
            }
        }
        if let Some(cluster_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
        {
            return format!("news:cluster:{cluster_id}");
        }
        if let Some(source) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source.clone())
        {
            return format!("news:source:{source}");
        }
        return format!("news:author:{}", candidate.author_id);
    }

    format!("author:{}", candidate.author_id)
}

fn request_source_key(candidate: &RecommendationCandidatePayload) -> String {
    if candidate.is_news == Some(true) {
        if let Some(url) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source_url.clone().or(metadata.url.clone()))
        {
            if let Ok(parsed) = Url::parse(&url) {
                if let Some(host) = parsed.host_str() {
                    return format!("domain:{host}");
                }
            }
        }
        if let Some(source) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.source.as_deref())
        {
            return format!("news_source:{source}");
        }
    }
    candidate
        .recall_source
        .as_deref()
        .or(candidate.retrieval_lane.as_deref())
        .unwrap_or("unknown")
        .to_string()
}

fn request_topic_key(candidate: &RecommendationCandidatePayload) -> String {
    if let Some(cluster_id) = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
    {
        return format!("news_cluster:{cluster_id}");
    }
    if let Some(conversation_id) = candidate
        .conversation_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return format!("conversation:{conversation_id}");
    }
    if let Some(pool) = candidate
        .interest_pool_kind
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return format!("interest_pool:{pool}");
    }
    let semantic_key = candidate_semantic_tokens(candidate)
        .into_iter()
        .take(3)
        .collect::<Vec<_>>()
        .join("|");
    if semantic_key.is_empty() {
        "format:text".to_string()
    } else {
        semantic_key
    }
}

fn jaccard_overlap(left: &HashSet<String>, right: &HashSet<String>) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count() as f64;
    let union = left.union(right).count().max(1) as f64;
    intersection / union
}

fn oon_factor(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");
    let lane = candidate.retrieval_lane.as_deref().unwrap_or("");
    let secondary_source_count = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get("retrievalSecondarySourceCount"))
        .copied()
        .unwrap_or_default();
    let evidence_relief = (secondary_source_count * 0.01).min(0.05);
    let recall_evidence_relief = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| {
            (evidence.confidence * 0.035 + (evidence.source_count - 1.0).max(0.0) * 0.008).min(0.06)
        })
        .unwrap_or_default();

    let base = match state {
        "cold_start" => 0.88,
        "sparse" => match lane {
            INTEREST_LANE | SOCIAL_EXPANSION_LANE => 0.82,
            FALLBACK_LANE => 0.78,
            _ => OON_WEIGHT_FACTOR,
        },
        "heavy" => match lane {
            INTEREST_LANE | SOCIAL_EXPANSION_LANE => 0.68,
            FALLBACK_LANE => 0.64,
            _ => OON_WEIGHT_FACTOR,
        },
        _ => match lane {
            INTEREST_LANE | SOCIAL_EXPANSION_LANE => 0.74,
            FALLBACK_LANE => 0.70,
            _ => OON_WEIGHT_FACTOR,
        },
    };

    (base + evidence_relief.max(recall_evidence_relief)).min(0.9)
}

fn default_exploration_rate(state: &str) -> f64 {
    match state {
        "cold_start" => 0.26,
        "sparse" => 0.18,
        "heavy" => 0.08,
        _ => 0.12,
    }
}

fn cross_page_pressure(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let related = related_post_ids(candidate);
    if related.is_empty() {
        return 0.0;
    }
    let seen_match = related
        .iter()
        .any(|id| query.seen_ids.iter().any(|seen_id| seen_id == id));
    let served_match = related
        .iter()
        .any(|id| query.served_ids.iter().any(|served_id| served_id == id));
    match (seen_match, served_match) {
        (true, true) => 1.0,
        (true, false) => 0.75,
        (false, true) => 0.62,
        _ => 0.0,
    }
}

fn user_state<'a>(query: &'a RecommendationQueryPayload) -> &'a str {
    query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("")
}

fn breakdown_value(breakdown: Option<&HashMap<String, f64>>, key: &str) -> f64 {
    breakdown
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .unwrap_or_default()
}

fn candidate_keyword_set(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let text = format!(
        "{} {} {}",
        candidate.content,
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.title.as_deref())
            .unwrap_or_default(),
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.summary.as_deref())
            .unwrap_or_default()
    );
    let mut seen = std::collections::HashSet::new();
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 2)
        .filter(|token| seen.insert(token.clone()))
        .take(32)
        .collect()
}

fn candidate_semantic_tokens(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let text = format!(
        "{} {} {}",
        candidate.content,
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.title.as_deref())
            .unwrap_or_default(),
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.summary.as_deref())
            .unwrap_or_default()
    );
    tokenize_semantic_text(&text)
}

fn tokenize_semantic_text(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 3)
        .filter(|token| !semantic_stop_word(token))
        .filter(|token| seen.insert(token.clone()))
        .take(48)
        .collect()
}

fn semantic_stop_word(token: &str) -> bool {
    matches!(
        token,
        "the"
            | "and"
            | "for"
            | "with"
            | "from"
            | "that"
            | "this"
            | "have"
            | "has"
            | "was"
            | "were"
            | "are"
            | "you"
            | "your"
            | "they"
            | "their"
            | "into"
            | "about"
            | "today"
            | "news"
            | "note"
            | "demo"
            | "post"
    )
}

fn keyword_overlap_ratio(candidate_keywords: &[String], policy_keywords: &[String]) -> f64 {
    if candidate_keywords.is_empty() || policy_keywords.is_empty() {
        return 0.0;
    }
    let matched = policy_keywords
        .iter()
        .filter(|keyword| {
            candidate_keywords.iter().any(|candidate_keyword| {
                candidate_keyword == *keyword
                    || candidate_keyword.contains(keyword.as_str())
                    || keyword.contains(candidate_keyword.as_str())
            })
        })
        .count();
    clamp01(matched as f64 / policy_keywords.len().max(1) as f64)
}

fn stable_unit_interval(request_id: &str, post_id: &str) -> f64 {
    let mut hasher = DefaultHasher::new();
    request_id.hash(&mut hasher);
    post_id.hash(&mut hasher);
    (hasher.finish() % 10_000) as f64 / 10_000.0
}

fn merge_breakdown(candidate: &mut RecommendationCandidatePayload, key: &str, value: f64) {
    if !value.is_finite() {
        return;
    }
    let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
    breakdown.insert(key.to_string(), value);
}

fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
}

fn build_stage(
    name: &str,
    input_count: usize,
    enabled: bool,
    detail: Option<HashMap<String, Value>>,
) -> RecommendationStagePayload {
    let mut detail = detail.unwrap_or_default();
    detail.insert(
        "executionMode".to_string(),
        Value::String(LOCAL_EXECUTION_MODE.to_string()),
    );
    detail.insert("owner".to_string(), Value::String("rust".to_string()));

    RecommendationStagePayload {
        name: name.to_string(),
        enabled,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: Some(0),
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;
    use std::collections::HashMap;

    use crate::contracts::query::RankingPolicyPayload;
    use crate::contracts::{
        CandidateNewsMetadataPayload, EmbeddingContextPayload, PhoenixScoresPayload,
        RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload,
    };

    use super::{FALLBACK_LANE, run_local_scorers};

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
    fn local_scorers_compute_weighted_and_final_scores() {
        let mut second = candidate("post-2", "author-b");
        second.is_news = Some(true);
        second.news_metadata = Some(CandidateNewsMetadataPayload {
            source_url: Some("https://example.com/news".to_string()),
            ..CandidateNewsMetadataPayload::default()
        });

        let result = run_local_scorers(&query(), vec![candidate("post-1", "author-a"), second]);
        assert_eq!(result.stages.len(), 17);
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
}
