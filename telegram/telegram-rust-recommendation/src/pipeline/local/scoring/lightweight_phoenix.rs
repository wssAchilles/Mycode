use std::collections::HashMap;

use chrono::Utc;
use serde_json::Value;

use crate::contracts::{
    ActionScoresPayload, PhoenixScoresPayload, RankingSignalsPayload,
    RecommendationCandidatePayload, RecommendationQueryPayload,
};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, related_post_ids,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

pub fn apply_lightweight_phoenix_scores_with_profile(
    query: &RecommendationQueryPayload,
    candidate: &mut RecommendationCandidatePayload,
    action_profile: &UserActionProfile,
) {
    let signals = compute_ranking_signals(query, candidate, action_profile);
    let action_scores = candidate
        .phoenix_scores
        .as_ref()
        .map(action_scores_from_phoenix)
        .unwrap_or_else(|| estimate_action_scores(candidate, signals, action_profile));
    let temporal = action_profile.temporal_summary();

    if candidate.phoenix_scores.is_none() {
        candidate.phoenix_scores = Some(phoenix_scores_from_actions(action_scores));
        merge_breakdown(candidate, "lightweightPhoenixFallbackUsed", 1.0);
    } else {
        merge_breakdown(candidate, "lightweightPhoenixFallbackUsed", 0.0);
    }

    candidate.action_scores = Some(action_scores);
    candidate.ranking_signals = Some(signals);
    merge_breakdown(candidate, "rankingRelevance", signals.relevance);
    merge_breakdown(candidate, "rankingFreshness", signals.freshness);
    merge_breakdown(candidate, "rankingPopularity", signals.popularity);
    merge_breakdown(candidate, "rankingQuality", signals.quality);
    merge_breakdown(candidate, "rankingAuthorAffinity", signals.author_affinity);
    merge_breakdown(candidate, "rankingTopicAffinity", signals.topic_affinity);
    merge_breakdown(candidate, "rankingSourceAffinity", signals.source_affinity);
    merge_breakdown(
        candidate,
        "rankingConversationAffinity",
        signals.conversation_affinity,
    );
    merge_breakdown(candidate, "rankingSourceEvidence", signals.source_evidence);
    merge_breakdown(candidate, "rankingNetwork", signals.network);
    merge_breakdown(
        candidate,
        "rankingContentKind",
        content_kind_signal(candidate),
    );
    merge_breakdown(candidate, "rankingTrendHeat", trend_signal(candidate));
    merge_breakdown(
        candidate,
        "rankingSourceQuality",
        source_quality_signal(candidate),
    );
    merge_breakdown(candidate, "rankingShortInterest", temporal.short_interest());
    merge_breakdown(
        candidate,
        "rankingStableInterest",
        temporal.stable_interest(),
    );
    merge_breakdown(
        candidate,
        "rankingNegativeFeedback",
        signals.negative_feedback,
    );
    merge_breakdown(
        candidate,
        "rankingDeliveryFatigue",
        signals.delivery_fatigue,
    );
    merge_breakdown(candidate, "actionClick", action_scores.click);
    merge_breakdown(candidate, "actionLike", action_scores.like);
    merge_breakdown(candidate, "actionReply", action_scores.reply);
    merge_breakdown(candidate, "actionRepost", action_scores.repost);
    merge_breakdown(candidate, "actionDwell", action_scores.dwell);
    merge_breakdown(candidate, "actionNegative", action_scores.negative);
}

fn compute_ranking_signals(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
    action_profile: &UserActionProfile,
) -> RankingSignalsPayload {
    let action_match = action_profile.match_candidate(candidate);
    let freshness = freshness_signal(candidate);
    let popularity = popularity_signal(candidate);
    let quality = quality_signal(candidate);
    let author_affinity = author_affinity_signal(candidate).max(action_match.author_affinity);
    let topic_affinity = action_match.topic_affinity;
    let source_affinity = action_match.source_affinity;
    let conversation_affinity = action_match.conversation_affinity;
    let source_evidence = source_evidence_signal(candidate);
    let network = network_signal(candidate);
    let temporal = action_profile.temporal_summary();
    let temporal_interest =
        clamp01(temporal.short_interest() * 0.56 + temporal.stable_interest() * 0.44);
    let content_kind = content_kind_signal(candidate);
    let trend = trend_signal(candidate);
    let source_quality = source_quality_signal(candidate);
    let negative_feedback = negative_feedback_signal(query, candidate)
        .max(action_match.negative_feedback)
        .max(action_match.delivery_fatigue * 0.42)
        .max(temporal.negative_pressure() * 0.36);
    let delivery_fatigue = action_match
        .delivery_fatigue
        .max(temporal.exposure_pressure() * 0.32);
    let relevance = clamp01(
        source_evidence * 0.24
            + network * 0.18
            + author_affinity * 0.17
            + topic_affinity.max(0.0) * 0.14
            + source_affinity.max(0.0) * 0.06
            + conversation_affinity.max(0.0) * 0.06
            + popularity * 0.12
            + freshness * 0.11
            + quality * 0.11
            + temporal_interest * 0.1
            + content_kind * 0.06
            + trend * 0.08
            + source_quality * 0.05
            - negative_feedback * 0.34
            - delivery_fatigue * 0.1,
    );

    RankingSignalsPayload {
        relevance,
        freshness,
        popularity,
        quality,
        author_affinity,
        topic_affinity,
        source_affinity,
        conversation_affinity,
        source_evidence,
        network,
        negative_feedback,
        delivery_fatigue,
    }
}

fn estimate_action_scores(
    candidate: &RecommendationCandidatePayload,
    signals: RankingSignalsPayload,
    action_profile: &UserActionProfile,
) -> ActionScoresPayload {
    let media_signal = (candidate.has_image == Some(true)) as i32 as f64 * 0.45
        + (candidate.has_video == Some(true)) as i32 as f64 * 0.55;
    let content_signal = clamp01(candidate.content.chars().count() as f64 / 220.0);
    let temporal = action_profile.temporal_summary();
    let content_kind = content_kind_signal(candidate);
    let trend = trend_signal(candidate);
    let source_quality = source_quality_signal(candidate);
    let social_lane = match candidate.retrieval_lane.as_deref().unwrap_or_default() {
        IN_NETWORK_LANE => 0.18,
        SOCIAL_EXPANSION_LANE => 0.13,
        INTEREST_LANE => 0.08,
        _ => 0.0,
    };
    let negative = clamp01(
        signals.negative_feedback
            + (1.0 - signals.quality) * 0.08
            + signals.delivery_fatigue * 0.16
            + (1.0 - source_quality) * 0.04
            + (candidate.is_nsfw == Some(true)) as i32 as f64 * 0.18,
    );

    ActionScoresPayload {
        click: clamp01(
            0.03 + signals.relevance * 0.32
                + signals.source_evidence * 0.08
                + media_signal * 0.05
                + content_kind * 0.04
                + trend * 0.03
                - negative * 0.2,
        ),
        like: clamp01(
            0.02 + signals.relevance * 0.22
                + signals.author_affinity * 0.11
                + signals.quality * 0.06
                + temporal.stable_interest() * 0.04
                - negative * 0.18,
        ),
        reply: clamp01(
            0.01 + signals.author_affinity * 0.1
                + signals.network * 0.06
                + social_lane * 0.1
                + signals.relevance * 0.08
                + signals.conversation_affinity.max(0.0) * 0.07
                + content_signal * 0.04
                - negative * 0.16,
        ),
        repost: clamp01(
            0.008
                + signals.relevance * 0.12
                + signals.popularity * 0.1
                + signals.quality * 0.08
                + signals.source_evidence * 0.06
                + trend * 0.08
                + content_kind * 0.05
                - negative * 0.16,
        ),
        dwell: clamp01(
            0.04 + signals.quality * 0.22
                + signals.relevance * 0.18
                + media_signal * 0.1
                + signals.freshness * 0.04
                + content_kind * 0.06
                + source_quality * 0.03
                - negative * 0.12,
        ),
        negative,
    }
}

fn action_scores_from_phoenix(scores: &PhoenixScoresPayload) -> ActionScoresPayload {
    ActionScoresPayload {
        click: clamp01(scores.click_score.unwrap_or_default()),
        like: clamp01(scores.like_score.unwrap_or_default()),
        reply: clamp01(scores.reply_score.unwrap_or_default()),
        repost: clamp01(
            scores
                .repost_score
                .unwrap_or_default()
                .max(scores.quote_score.unwrap_or_default()),
        ),
        dwell: clamp01(
            scores
                .dwell_score
                .unwrap_or_default()
                .max(scores.dwell_time.unwrap_or_default() / 5.0),
        ),
        negative: clamp01(
            scores
                .not_interested_score
                .unwrap_or_default()
                .max(scores.dismiss_score.unwrap_or_default())
                .max(scores.block_author_score.unwrap_or_default())
                .max(scores.block_score.unwrap_or_default())
                .max(scores.mute_author_score.unwrap_or_default())
                .max(scores.report_score.unwrap_or_default()),
        ),
    }
}

fn phoenix_scores_from_actions(scores: ActionScoresPayload) -> PhoenixScoresPayload {
    PhoenixScoresPayload {
        like_score: Some(scores.like),
        reply_score: Some(scores.reply),
        repost_score: Some(scores.repost),
        quote_score: Some(scores.repost * 0.45),
        click_score: Some(scores.click),
        dwell_score: Some(scores.dwell),
        dwell_time: Some(scores.dwell * 5.0),
        share_score: Some(scores.repost * 0.55),
        follow_author_score: Some(scores.like * 0.35),
        not_interested_score: Some(scores.negative),
        dismiss_score: Some(scores.negative * 0.7),
        block_author_score: Some(scores.negative * 0.18),
        mute_author_score: Some(scores.negative * 0.22),
        report_score: Some(scores.negative * 0.12),
        ..PhoenixScoresPayload::default()
    }
}

fn freshness_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_seconds()
        .max(0) as f64
        / 3600.0;
    0.5_f64.powf(age_hours / 36.0)
}

fn popularity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let engagement_rate = clamp01((engagements / views) / 0.12);
    let volume = clamp01((engagements + views * 0.02).ln_1p() / 4.0);
    clamp01(engagement_rate * 0.68 + volume * 0.32)
}

fn quality_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let content_length = candidate.content.chars().count();
    let length = if content_length < 8 {
        0.28
    } else if content_length <= 280 {
        0.62 + content_length as f64 / 280.0 * 0.32
    } else if content_length <= 1_000 {
        0.86
    } else {
        0.72
    };
    let media = (candidate.has_image == Some(true)) as i32 as f64 * 0.08
        + (candidate.has_video == Some(true)) as i32 as f64 * 0.1;
    let structure = if candidate.is_reply {
        0.92
    } else if candidate.is_repost {
        0.84
    } else {
        1.0
    };
    let safety = if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
        || candidate.is_nsfw == Some(true)
    {
        0.58
    } else {
        1.0
    };
    clamp01((length + media) * 0.76 + structure * 0.16 + safety * 0.08)
}

fn author_affinity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    ((candidate
        .author_affinity_score
        .unwrap_or_default()
        .clamp(-1.0, 1.0)
        + 1.0)
        / 2.0)
        .max(0.0)
}

fn source_evidence_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let recall_confidence = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| evidence.confidence)
        .unwrap_or_default();
    let breakdown = candidate.score_breakdown.as_ref();
    recall_confidence
        .max(breakdown_value(breakdown, "retrievalEvidenceConfidence"))
        .max(breakdown_value(breakdown, "retrievalMultiSourceBonus") * 4.0)
        .max(breakdown_value(breakdown, "retrievalDenseVectorScore"))
        .max(breakdown_value(breakdown, "graphKernelScore"))
        .min(1.0)
}

fn network_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    match (
        candidate.in_network,
        candidate.retrieval_lane.as_deref().unwrap_or_default(),
    ) {
        (Some(true), _) => 1.0,
        (_, IN_NETWORK_LANE) => 0.9,
        (_, SOCIAL_EXPANSION_LANE) => 0.72,
        (_, INTEREST_LANE) => 0.64,
        (_, FALLBACK_LANE) => 0.44,
        _ => 0.5,
    }
}

fn content_kind_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let lane = candidate.retrieval_lane.as_deref().unwrap_or_default();
    let news: f64 = if candidate.is_news == Some(true)
        || candidate.recall_source.as_deref() == Some("NewsAnnSource")
    {
        0.72
    } else {
        0.0
    };
    let media = (candidate.has_image == Some(true)) as i32 as f64 * 0.12
        + (candidate.has_video == Some(true)) as i32 as f64 * 0.18;
    let lane_prior: f64 = match lane {
        IN_NETWORK_LANE => 0.48,
        SOCIAL_EXPANSION_LANE => 0.42,
        INTEREST_LANE => 0.46,
        FALLBACK_LANE => 0.3,
        _ => 0.34,
    };
    clamp01(news.max(lane_prior) + media)
}

fn trend_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    breakdown_value(breakdown, "trendPersonalizationStrength")
        .max(breakdown_value(breakdown, "trendAffinityStrength"))
        .max(breakdown_value(breakdown, "newsTrendLinkStrength"))
        .max(breakdown_value(breakdown, "trendHeat") / 100.0)
        .max(breakdown_value(breakdown, "newsTrendHeat") / 100.0)
        .min(1.0)
}

fn source_quality_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    let recall = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| evidence.confidence)
        .unwrap_or_default();
    let normalized_score = breakdown_value(breakdown, "sourceNormalizedScore");
    let source_prior = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.source.as_deref())
        .map(news_source_prior)
        .unwrap_or(0.52);
    clamp01(
        recall * 0.34
            + normalized_score * 0.2
            + breakdown_value(breakdown, "retrievalSourceDiversityScore") * 0.18
            + source_prior * 0.28,
    )
}

fn news_source_prior(source: &str) -> f64 {
    let key = source.to_lowercase();
    if key.contains("reuters") || key.contains("apnews") || key.contains("associatedpress") {
        0.92
    } else if key.contains("bbc") || key.contains("nytimes") || key.contains("theguardian") {
        0.86
    } else if key.contains("cnn") || key.contains("bloomberg") || key.contains("wsj") {
        0.8
    } else {
        0.56
    }
}

fn negative_feedback_signal(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let mut strength: f64 = 0.0;
    if query
        .user_features
        .as_ref()
        .is_some_and(|features| features.blocked_user_ids.contains(&candidate.author_id))
    {
        strength = strength.max(1.0);
    }
    if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
        || candidate.is_nsfw == Some(true)
    {
        strength = strength.max(0.72);
    }

    let related_ids = related_post_ids(candidate);
    for action in query.user_action_sequence.as_ref().into_iter().flatten() {
        let action_name = action
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let base = match action_name {
            "dismiss" => 0.34,
            "not_interested" => 0.5,
            "mute_author" => 0.68,
            "block_author" => 0.9,
            "report" => 0.84,
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
        .is_some_and(|target| related_ids.iter().any(|id| id == &target));
        let author_match = action_string(action, &["targetAuthorId", "target_author_id"])
            .is_some_and(|target| target == candidate.author_id);
        if post_match || author_match {
            strength = strength.max(if post_match { base } else { base * 0.62 });
        }
    }
    clamp01(strength)
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

fn breakdown_value(breakdown: Option<&HashMap<String, f64>>, key: &str) -> f64 {
    breakdown
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .unwrap_or_default()
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
