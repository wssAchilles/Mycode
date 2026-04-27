use std::collections::HashMap;

use crate::contracts::RecommendationCandidatePayload;
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, source_retrieval_lane,
};

pub(super) fn candidate_score(candidate: &RecommendationCandidatePayload) -> f64 {
    candidate
        .score
        .or(candidate.weighted_score)
        .or(candidate.pipeline_score)
        .unwrap_or_default()
}

pub fn sort_candidates(candidates: &mut [RecommendationCandidatePayload], in_network_only: bool) {
    candidates.sort_by(|left, right| {
        if in_network_only {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.post_id.cmp(&right.post_id))
                .then_with(|| left.author_id.cmp(&right.author_id))
        } else {
            candidate_score(right)
                .partial_cmp(&candidate_score(left))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.created_at.cmp(&left.created_at))
                .then_with(|| left.post_id.cmp(&right.post_id))
                .then_with(|| left.author_id.cmp(&right.author_id))
        }
    });
}

pub(super) fn candidate_lane(candidate: &RecommendationCandidatePayload) -> &str {
    candidate
        .retrieval_lane
        .as_deref()
        .unwrap_or_else(|| source_retrieval_lane(candidate.recall_source.as_deref().unwrap_or("")))
}

pub(super) fn candidate_source(candidate: &RecommendationCandidatePayload) -> &str {
    candidate
        .recall_source
        .as_deref()
        .or(candidate.retrieval_lane.as_deref())
        .unwrap_or_else(|| source_retrieval_lane(""))
}

pub(super) fn candidate_topic_key(candidate: &RecommendationCandidatePayload) -> Option<String> {
    if let Some(cluster_key) = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
        .map(|cluster_id| format!("news_cluster:{cluster_id}"))
    {
        return Some(cluster_key);
    }

    if let Some(conversation_id) = candidate
        .conversation_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("conversation:{conversation_id}"));
    }

    if let Some(pool_kind) = candidate
        .interest_pool_kind
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("interest_pool:{pool_kind}"));
    }

    Some(format!("format:{}", candidate_format_key(candidate)))
}

fn candidate_format_key(candidate: &RecommendationCandidatePayload) -> &'static str {
    if candidate.is_news == Some(true) {
        "news"
    } else if candidate.has_video == Some(true) {
        "video"
    } else if candidate.has_image == Some(true) {
        "image"
    } else if candidate.is_reply {
        "reply"
    } else if candidate.is_repost {
        "repost"
    } else {
        "text"
    }
}

pub(super) fn is_strong_personalized_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    if candidate.in_network == Some(true) {
        return true;
    }

    let breakdown = candidate.score_breakdown.as_ref();
    let author_affinity = candidate
        .author_affinity_score
        .unwrap_or_default()
        .max(breakdown_value(breakdown, "authorAffinityScore"));
    let evidence_confidence = breakdown_value(breakdown, "retrievalEvidenceConfidence");
    let dense_score = breakdown_value(breakdown, "retrievalDenseVectorScore");
    let topic_score = breakdown_value(breakdown, "retrievalTopicCoverageScore")
        .max(breakdown_value(breakdown, "retrievalCandidateClusterScore"));
    let graph_score = candidate
        .graph_score
        .unwrap_or_default()
        .max(breakdown_value(breakdown, "retrievalAuthorGraphPrior"));

    author_affinity >= 0.18
        || evidence_confidence >= 0.62
        || (candidate_lane(candidate) == INTEREST_LANE && dense_score.max(topic_score) >= 0.25)
        || graph_score >= 0.2
}

pub(super) fn is_exploration_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    let lane = candidate_lane(candidate);
    breakdown_value(candidate.score_breakdown.as_ref(), "explorationEligible") >= 0.5
        || (candidate.in_network != Some(true)
            && (lane == FALLBACK_LANE || lane == INTEREST_LANE)
            && breakdown_value(candidate.score_breakdown.as_ref(), "fatigueStrength") < 0.42)
}

pub(super) fn is_trend_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    breakdown_value(
        candidate.score_breakdown.as_ref(),
        "trendPersonalizationStrength",
    ) >= 0.08
        || breakdown_value(candidate.score_breakdown.as_ref(), "trendAffinityStrength") >= 0.14
}

pub(super) fn is_news_candidate(candidate: &RecommendationCandidatePayload) -> bool {
    candidate.is_news == Some(true) || candidate.recall_source.as_deref() == Some("NewsAnnSource")
}

pub(super) fn candidate_selection_pool(candidate: &RecommendationCandidatePayload) -> &'static str {
    if candidate
        .score_breakdown
        .as_ref()
        .is_some_and(|breakdown| breakdown_value(Some(breakdown), "selectorRescueEligible") >= 0.5)
    {
        return "rescue";
    }
    if is_trend_candidate(candidate) {
        return "trend";
    }
    if is_exploration_candidate(candidate) {
        return "exploration";
    }
    match candidate_lane(candidate) {
        IN_NETWORK_LANE | SOCIAL_EXPANSION_LANE | INTEREST_LANE => "primary",
        _ => "fallback",
    }
}

pub(super) fn selection_reason(candidate: &RecommendationCandidatePayload, pool: &str) -> String {
    match pool {
        "primary" if candidate.in_network == Some(true) => "in_network_primary".to_string(),
        "primary" => format!("{}_primary", candidate_lane(candidate)),
        "trend" => "trend_affinity_primary".to_string(),
        "exploration" => "bandit_or_novelty_exploration".to_string(),
        "rescue" => "underfill_rescue".to_string(),
        _ => format!("{}_fallback", candidate_lane(candidate)),
    }
}

pub(super) fn breakdown_value(breakdown: Option<&HashMap<String, f64>>, key: &str) -> f64 {
    breakdown
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .unwrap_or_default()
}
