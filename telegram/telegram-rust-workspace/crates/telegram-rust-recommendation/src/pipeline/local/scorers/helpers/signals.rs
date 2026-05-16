use chrono::Utc;
use telegram_ranking_primitives::{
    ACTION_NEGATIVE_FIELD, ActionWeightedScoreInput, FATIGUE_STRENGTH_FIELD,
    HeuristicWeightedScoreInput, NEGATIVE_FEEDBACK_STRENGTH_FIELD, PhoenixWeightedScoreInput,
    RANKING_STABLE_INTEREST_FIELD, WeightedScoreInput, WeightedScoreSummary,
    compute_weighted_score_summary,
};
use telegram_source_primitives::{
    RETRIEVAL_AUTHOR_PRIOR_FIELD, RETRIEVAL_CANDIDATE_CLUSTER_SCORE_FIELD,
    RETRIEVAL_CROSS_LANE_BONUS_FIELD, RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD,
    RETRIEVAL_DENSE_VECTOR_SCORE_FIELD, RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD,
    RETRIEVAL_MULTI_SOURCE_BONUS_FIELD, RETRIEVAL_SECONDARY_SOURCE_COUNT_FIELD,
};

use crate::contracts::RecommendationCandidatePayload;

use super::super::{ContentQualitySummary, MIN_VIDEO_DURATION_SEC};
use super::context::breakdown_value;
use super::normalization::clamp01;

pub(in crate::pipeline::local::scorers) fn compute_weighted_score(
    candidate: &RecommendationCandidatePayload,
) -> WeightedScoreSummary {
    let evidence_prior = weighted_evidence_prior(candidate);
    let signal_prior = weighted_signal_prior(candidate);
    compute_weighted_score_summary(WeightedScoreInput {
        phoenix_scores: phoenix_weighted_score_input(candidate),
        action_scores: action_weighted_score_input(candidate),
        heuristic_scores: heuristic_weighted_score_input(candidate),
        evidence_prior,
        signal_prior,
    })
}

fn phoenix_weighted_score_input(
    candidate: &RecommendationCandidatePayload,
) -> Option<PhoenixWeightedScoreInput> {
    let scores = candidate.phoenix_scores.as_ref()?;
    Some(PhoenixWeightedScoreInput {
        like: scores.like_score.unwrap_or_default(),
        reply: scores.reply_score.unwrap_or_default(),
        repost: scores.repost_score.unwrap_or_default(),
        quote: scores.quote_score.unwrap_or_default(),
        photo_expand: scores.photo_expand_score.unwrap_or_default(),
        click: scores.click_score.unwrap_or_default(),
        quoted_click: scores.quoted_click_score.unwrap_or_default(),
        profile_click: scores.profile_click_score.unwrap_or_default(),
        video_quality_view: if candidate.video_duration_sec.unwrap_or_default()
            > MIN_VIDEO_DURATION_SEC
        {
            scores.video_quality_view_score.unwrap_or_default()
        } else {
            0.0
        },
        share: scores.share_score.unwrap_or_default(),
        share_via_dm: scores.share_via_dm_score.unwrap_or_default(),
        share_via_copy_link: scores.share_via_copy_link_score.unwrap_or_default(),
        dwell: scores.dwell_score.unwrap_or_default(),
        dwell_time: scores.dwell_time.unwrap_or_default(),
        follow_author: scores.follow_author_score.unwrap_or_default(),
        not_interested: scores.not_interested_score.unwrap_or_default(),
        dismiss: scores.dismiss_score.unwrap_or_default(),
        block_author: scores.block_author_score.unwrap_or_default(),
        block: scores.block_score.unwrap_or_default(),
        mute_author: scores.mute_author_score.unwrap_or_default(),
        report: scores.report_score.unwrap_or_default(),
    })
}

fn action_weighted_score_input(
    candidate: &RecommendationCandidatePayload,
) -> Option<ActionWeightedScoreInput> {
    let scores = candidate.action_scores.as_ref()?;
    Some(ActionWeightedScoreInput {
        like: scores.like,
        reply: scores.reply,
        repost: scores.repost,
        click: scores.click,
        dwell: scores.dwell,
        negative: scores.negative,
    })
}

fn heuristic_weighted_score_input(
    candidate: &RecommendationCandidatePayload,
) -> HeuristicWeightedScoreInput {
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let click_proxy = if candidate.has_image == Some(true) || candidate.has_video == Some(true) {
        0.18
    } else {
        0.08
    };
    let breakdown = candidate.score_breakdown.as_ref();
    let retrieval_author_prior = breakdown_value(breakdown, RETRIEVAL_AUTHOR_PRIOR_FIELD);
    let retrieval_dense_support = breakdown_value(breakdown, RETRIEVAL_DENSE_VECTOR_SCORE_FIELD);
    let retrieval_cluster_support =
        breakdown_value(breakdown, RETRIEVAL_CANDIDATE_CLUSTER_SCORE_FIELD);

    HeuristicWeightedScoreInput {
        engagement_rate: clamp01((engagements / views) / 0.12),
        reply_proxy: clamp01(candidate.comment_count.unwrap_or_default() / 8.0),
        repost_proxy: clamp01(candidate.repost_count.unwrap_or_default() / 6.0),
        click_proxy,
        content_proxy: clamp01(candidate.content.chars().count() as f64 / 280.0),
        follow_proxy: clamp01(candidate.author_affinity_score.unwrap_or_default().max(0.0)),
        retrieval_support: retrieval_author_prior * 0.45
            + retrieval_dense_support * 0.3
            + retrieval_cluster_support * 0.25,
    }
}

fn weighted_signal_prior(candidate: &RecommendationCandidatePayload) -> f64 {
    let Some(signals) = candidate.ranking_signals else {
        return 0.0;
    };
    let breakdown = candidate.score_breakdown.as_ref();
    let trend_signal = breakdown_value(breakdown, "rankingTrendHeat");
    let source_quality = breakdown_value(breakdown, "rankingSourceQuality");
    let temporal_interest = breakdown_value(breakdown, "rankingShortInterest")
        .max(breakdown_value(breakdown, RANKING_STABLE_INTEREST_FIELD));
    let negative = signals
        .negative_feedback
        .max(breakdown_value(breakdown, ACTION_NEGATIVE_FIELD));

    clamp01(
        signals.relevance * 0.32
            + signals.quality * 0.18
            + signals.source_evidence * 0.18
            + source_quality * 0.12
            + trend_signal * 0.1
            + temporal_interest * 0.1
            - negative * 0.42,
    )
}

pub(super) fn weighted_evidence_prior(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    let secondary_source_count = breakdown
        .and_then(|breakdown| breakdown.get(RETRIEVAL_SECONDARY_SOURCE_COUNT_FIELD))
        .copied()
        .unwrap_or_default();
    let cross_lane_source_count = breakdown
        .and_then(|breakdown| breakdown.get(RETRIEVAL_CROSS_LANE_SOURCE_COUNT_FIELD))
        .copied()
        .unwrap_or_default();
    let evidence_confidence = breakdown
        .and_then(|breakdown| breakdown.get(RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD))
        .copied()
        .unwrap_or_default();
    let multi_source_bonus = breakdown
        .and_then(|breakdown| breakdown.get(RETRIEVAL_MULTI_SOURCE_BONUS_FIELD))
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

pub(in crate::pipeline::local::scorers) fn freshness_multiplier(
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_seconds()
        .max(0) as f64
        / 3600.0;
    // 连续指数衰减, 半衰期 36 小时
    // 0h → 1.06, 6h → 1.02, 12h → 0.99, 24h → 0.95, 48h → 0.90, 72h → 0.87
    // 168h (1周) → 0.78, 720h (30天) → 0.52
    let decay = 0.5_f64.powf(age_hours / 36.0);
    // 映射到 [0.50, 1.06] 乘数范围
    0.50 + decay * 0.56
}

pub(in crate::pipeline::local::scorers) fn engagement_multiplier(
    candidate: &RecommendationCandidatePayload,
) -> f64 {
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

pub(in crate::pipeline::local::scorers) fn evidence_multiplier(
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let secondary_source_count = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get(RETRIEVAL_SECONDARY_SOURCE_COUNT_FIELD))
        .copied()
        .unwrap_or_default();
    let retrieval_multi_source_bonus = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get(RETRIEVAL_MULTI_SOURCE_BONUS_FIELD))
        .copied()
        .unwrap_or_default();
    let retrieval_cross_lane_bonus = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get(RETRIEVAL_CROSS_LANE_BONUS_FIELD))
        .copied()
        .unwrap_or_default();
    let retrieval_evidence_confidence = candidate
        .score_breakdown
        .as_ref()
        .and_then(|breakdown| breakdown.get(RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD))
        .copied()
        .unwrap_or_default();
    1.0 + retrieval_multi_source_bonus.min(0.1)
        + retrieval_cross_lane_bonus.min(0.06)
        + (secondary_source_count * 0.008).min(0.04)
        + (retrieval_evidence_confidence * 0.02).min(0.02)
}

pub(in crate::pipeline::local::scorers) fn exploration_risk(
    candidate: &RecommendationCandidatePayload,
    action_negative: f64,
) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    let negative = action_negative
        .max(breakdown_value(breakdown, NEGATIVE_FEEDBACK_STRENGTH_FIELD))
        .max(breakdown_value(breakdown, "earlySuppressionStrength"));
    let fatigue = breakdown_value(breakdown, FATIGUE_STRENGTH_FIELD)
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

pub(in crate::pipeline::local::scorers) fn compute_content_quality(
    candidate: &RecommendationCandidatePayload,
) -> ContentQualitySummary {
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
    let author_affinity = candidate.author_affinity_score.unwrap_or_default();
    let bounded_author_affinity = if author_affinity.is_nan() {
        0.0
    } else {
        author_affinity.clamp(0.0, 0.2)
    };
    let score = clamp01(
        quality_prior * 0.66 + engagement_prior * 0.24 + bounded_author_affinity * 0.1
            - low_quality_penalty * 0.18,
    );
    ContentQualitySummary {
        score,
        quality_prior,
        engagement_prior,
        low_quality_penalty,
    }
}

pub(super) fn low_quality_penalty(
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
