use std::collections::HashMap;

use chrono::Utc;
use reqwest::Url;
use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::context::{
    FALLBACK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, source_mixing_multiplier,
    space_feed_experiment_flag,
};

const LOCAL_EXECUTION_MODE: &str = "rust_local_scorers_v1";
const MIN_VIDEO_DURATION_SEC: f64 = 5.0;
const OON_WEIGHT_FACTOR: f64 = 0.7;
const POSITIVE_WEIGHT_SUM: f64 = 30.15;
const NEGATIVE_WEIGHT_SUM: f64 = 27.0;
const NEGATIVE_SCORES_OFFSET: f64 = 0.1;

struct WeightedScoreSummary {
    raw_score: f64,
    positive_score: f64,
    negative_score: f64,
    heuristic_fallback_used: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct AuthorAffinitySummary {
    score: f64,
    positive_score: f64,
    negative_score: f64,
    positive_actions: usize,
    negative_actions: usize,
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
        weighted_scorer as ScorerFn,
        score_calibration_scorer,
        content_quality_scorer,
        author_affinity_scorer,
        recency_scorer,
        author_diversity_scorer,
        oon_scorer,
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
        merge_breakdown(candidate, "weightedPositiveScore", weighted.positive_score);
        merge_breakdown(candidate, "weightedNegativeScore", weighted.negative_score);
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

    for candidate in &mut candidates {
        let current = candidate.weighted_score.unwrap_or_default();
        let source_multiplier =
            source_mixing_multiplier(query, candidate.recall_source.as_deref().unwrap_or(""));
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
        let negative_feedback = direct_negative_feedback(query, candidate);
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
            * negative_feedback.multiplier
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

    let author_affinities = compute_author_affinities(query);
    for candidate in &mut candidates {
        let affinity = author_affinities
            .get(&candidate.author_id)
            .copied()
            .unwrap_or_default();
        let multiplier = if affinity.score >= 0.45 {
            1.08 + affinity.score * 0.34
        } else if affinity.score > 0.0 {
            1.02 + affinity.score * 0.24
        } else if affinity.score < 0.0 {
            (1.0 + affinity.score * 0.72).max(0.35)
        } else {
            1.0
        };
        let adjusted = candidate.weighted_score.unwrap_or_default() * multiplier;
        candidate.author_affinity_score = Some(affinity.score);
        candidate.weighted_score = Some(adjusted);
        candidate.pipeline_score = Some(adjusted);
        merge_breakdown(candidate, "authorAffinityScore", affinity.score);
        merge_breakdown(
            candidate,
            "authorAffinityPositiveScore",
            affinity.positive_score,
        );
        merge_breakdown(
            candidate,
            "authorAffinityNegativeScore",
            affinity.negative_score,
        );
        merge_breakdown(
            candidate,
            "authorAffinityPositiveActions",
            affinity.positive_actions as f64,
        );
        merge_breakdown(
            candidate,
            "authorAffinityNegativeActions",
            affinity.negative_actions as f64,
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

    let half_life_ms = 6.0 * 60.0 * 60.0 * 1000.0;
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
        let multiplier =
            ((1.0 - 0.3) * 0.8_f64.powi(position as i32) + 0.3) * multi_source_softener;
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

fn compute_weighted_score(candidate: &RecommendationCandidatePayload) -> WeightedScoreSummary {
    let video_quality_weight =
        if candidate.video_duration_sec.unwrap_or_default() > MIN_VIDEO_DURATION_SEC {
            3.0
        } else {
            0.0
        };
    let (positive_score, negative_score, heuristic_fallback_used) = if let Some(scores) =
        candidate.phoenix_scores.as_ref()
    {
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
        )
    } else {
        let engagements = candidate.like_count.unwrap_or_default()
            + candidate.comment_count.unwrap_or_default() * 2.0
            + candidate.repost_count.unwrap_or_default() * 3.0;
        let views = candidate.view_count.unwrap_or(1.0).max(1.0);
        let engagement_rate = clamp01((engagements / views) / 0.12);
        let reply_proxy = clamp01(candidate.comment_count.unwrap_or_default() / 8.0);
        let repost_proxy = clamp01(candidate.repost_count.unwrap_or_default() / 6.0);
        let click_proxy = if candidate.has_image == Some(true) || candidate.has_video == Some(true)
        {
            0.18
        } else {
            0.08
        };
        let content_proxy = clamp01(candidate.content.chars().count() as f64 / 280.0);
        let follow_proxy = clamp01(candidate.author_affinity_score.unwrap_or_default().max(0.0));
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
            true,
        )
    };

    WeightedScoreSummary {
        raw_score: positive_score - negative_score,
        positive_score,
        negative_score,
        heuristic_fallback_used,
    }
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
        let recency = 0.97_f64.powf(age_days.min(30.0));
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

fn compute_author_affinities(
    query: &RecommendationQueryPayload,
) -> HashMap<String, AuthorAffinitySummary> {
    let now = Utc::now();
    let mut affinities = HashMap::<String, AuthorAffinitySummary>::new();
    for action in query.user_action_sequence.as_ref().into_iter().flatten() {
        let Some(author_id) = action
            .get("targetAuthorId")
            .or_else(|| action.get("target_author_id"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let action_name = action
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
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
        let entry = affinities.entry(author_id.to_string()).or_default();
        let recent_bonus = if age_days <= 2.0 {
            1.15
        } else if age_days <= 7.0 {
            1.05
        } else {
            1.0
        };
        match action_name {
            "like" => {
                entry.positive_score += 1.0 * 0.93_f64.powf(age_days) * recent_bonus;
                entry.positive_actions += 1;
            }
            "reply" => {
                entry.positive_score += 3.2 * 0.95_f64.powf(age_days) * recent_bonus;
                entry.positive_actions += 1;
            }
            "repost" => {
                entry.positive_score += 2.1 * 0.94_f64.powf(age_days) * recent_bonus;
                entry.positive_actions += 1;
            }
            "quote" => {
                entry.positive_score += 2.6 * 0.95_f64.powf(age_days) * recent_bonus;
                entry.positive_actions += 1;
            }
            "click" => {
                entry.positive_score += 0.22 * 0.9_f64.powf(age_days);
                entry.positive_actions += 1;
            }
            "profile_click" => {
                entry.positive_score += 1.4 * 0.94_f64.powf(age_days) * recent_bonus;
                entry.positive_actions += 1;
            }
            "share" => {
                entry.positive_score += 2.0 * 0.95_f64.powf(age_days) * recent_bonus;
                entry.positive_actions += 1;
            }
            "dismiss" => {
                entry.negative_score += 1.6 * 0.98_f64.powf(age_days) * recent_bonus;
                entry.negative_actions += 1;
            }
            "not_interested" => {
                entry.negative_score += 2.8 * 0.985_f64.powf(age_days) * recent_bonus;
                entry.negative_actions += 1;
            }
            "mute_author" => {
                entry.negative_score += 4.5 * 0.988_f64.powf(age_days) * recent_bonus;
                entry.negative_actions += 1;
            }
            "block_author" => {
                entry.negative_score += 7.0 * 0.99_f64.powf(age_days) * recent_bonus;
                entry.negative_actions += 1;
            }
            "report" => {
                entry.negative_score += 6.2 * 0.99_f64.powf(age_days) * recent_bonus;
                entry.negative_actions += 1;
            }
            _ => {}
        }
    }

    for affinity in affinities.values_mut() {
        let repeated_positive_bonus = match affinity.positive_actions {
            0 | 1 => 0.0,
            2 => 0.04,
            _ => 0.08,
        };
        let repeated_negative_bonus = if affinity.negative_actions >= 2 {
            0.06
        } else {
            0.0
        };
        let positive_score = if affinity.positive_actions == 0 {
            0.0
        } else {
            clamp01(
                affinity.positive_score / (8.0 + affinity.positive_actions as f64 * 0.4)
                    + repeated_positive_bonus,
            )
        };
        let negative_score = if affinity.negative_actions == 0 {
            0.0
        } else {
            clamp01(
                affinity.negative_score / (5.5 + affinity.negative_actions as f64 * 0.2)
                    + repeated_negative_bonus,
            )
        };
        let mut final_score = (positive_score - negative_score * 1.15).clamp(-1.0, 1.0);
        if affinity.positive_actions <= 1 && final_score > 0.18 {
            final_score = 0.18;
        }
        if affinity.negative_actions > 0 && affinity.positive_actions == 0 {
            final_score = final_score.min(-0.22);
        }
        affinity.positive_score = positive_score;
        affinity.negative_score = negative_score;
        affinity.score = final_score;
    }
    affinities
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

    (base + evidence_relief).min(0.9)
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

    use crate::contracts::{
        CandidateNewsMetadataPayload, EmbeddingContextPayload, PhoenixScoresPayload,
        RecommendationCandidatePayload, RecommendationQueryPayload, UserStateContextPayload,
    };

    use super::run_local_scorers;

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
        assert_eq!(result.stages.len(), 7);
        assert!(result.stages.iter().all(|stage| stage.enabled));
        assert!(result.candidates[0].weighted_score.unwrap_or_default() > 0.0);
        assert!(result.candidates[0].score.unwrap_or_default() > 0.0);
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
                .and_then(|breakdown| breakdown.get("weightedHeuristicFallbackUsed"))
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
}
