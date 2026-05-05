use crate::contracts::{
    RankingSignalsPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::policy::ScoringPolicy;
use super::rule_signals::{
    author_affinity_signal, clamp01, content_kind_signal, freshness_signal,
    negative_feedback_signal, network_signal, popularity_signal, quality_signal,
    source_evidence_signal, source_quality_signal, trend_signal,
};

pub(super) fn compute_ranking_signals(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
    action_profile: &UserActionProfile,
    policy: &ScoringPolicy,
) -> RankingSignalsPayload {
    let action_match = action_profile.match_candidate(candidate);
    let freshness = freshness_signal(candidate, policy);
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
    let weights = policy.relevance;
    let relevance = clamp01(
        source_evidence * weights.source_evidence
            + network * weights.network
            + author_affinity * weights.author_affinity
            + topic_affinity.max(0.0) * weights.topic_affinity
            + source_affinity.max(0.0) * weights.source_affinity
            + conversation_affinity.max(0.0) * weights.conversation_affinity
            + popularity * weights.popularity
            + freshness * weights.freshness
            + quality * weights.quality
            + temporal_interest * weights.temporal_interest
            + content_kind * weights.content_kind
            + trend * weights.trend
            + source_quality * weights.source_quality
            - negative_feedback * weights.negative_feedback_penalty
            - delivery_fatigue * weights.delivery_fatigue_penalty,
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
