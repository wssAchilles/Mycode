use std::collections::HashMap;

use chrono::Utc;
use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, related_post_ids,
};

use super::policy::ScoringPolicy;

pub(super) fn freshness_signal(
    candidate: &RecommendationCandidatePayload,
    policy: &ScoringPolicy,
) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_seconds()
        .max(0) as f64
        / 3600.0;
    0.5_f64.powf(age_hours / policy.freshness_half_life_hours)
}

pub(super) fn popularity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let engagement_rate = clamp01((engagements / views) / 0.12);
    let volume = clamp01((engagements + views * 0.02).ln_1p() / 4.0);
    clamp01(engagement_rate * 0.68 + volume * 0.32)
}

pub(super) fn quality_signal(candidate: &RecommendationCandidatePayload) -> f64 {
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

pub(super) fn author_affinity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    ((candidate
        .author_affinity_score
        .unwrap_or_default()
        .clamp(-1.0, 1.0)
        + 1.0)
        / 2.0)
        .max(0.0)
}

pub(super) fn source_evidence_signal(candidate: &RecommendationCandidatePayload) -> f64 {
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

pub(super) fn network_signal(candidate: &RecommendationCandidatePayload) -> f64 {
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

pub(super) fn content_kind_signal(candidate: &RecommendationCandidatePayload) -> f64 {
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

pub(super) fn trend_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    breakdown_value(breakdown, "trendPersonalizationStrength")
        .max(breakdown_value(breakdown, "trendAffinityStrength"))
        .max(breakdown_value(breakdown, "newsTrendLinkStrength"))
        .max(breakdown_value(breakdown, "trendHeat") / 100.0)
        .max(breakdown_value(breakdown, "newsTrendHeat") / 100.0)
        .min(1.0)
}

pub(super) fn source_quality_signal(candidate: &RecommendationCandidatePayload) -> f64 {
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

pub(super) fn negative_feedback_signal(
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

pub(super) fn merge_breakdown(
    candidate: &mut RecommendationCandidatePayload,
    key: &str,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }
    let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
    breakdown.insert(key.to_string(), value);
}

pub(super) fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
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
