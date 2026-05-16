use crate::contracts::{
    RankingSignalsPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::policy::ScoringPolicy;
use super::rule_signals::{
    author_affinity_signal, clamp01, content_kind_signal, content_velocity_signal,
    engagement_penalties, freshness_quality_interaction, freshness_signal,
    graph_authority_signal, language_match_signal, multi_source_evidence_signal,
    negative_feedback_signal, network_signal, popularity_signal, quality_signal,
    source_evidence_signal, source_quality_signal, source_rank_signal, time_of_day_adjustment,
    trend_signal, user_sophistication_factor, visibility_gradient_signal,
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

    // ── 新增信号: 利用 candidate 上已存在但未使用的字段 ──
    let graph_authority = graph_authority_signal(candidate);
    let source_rank = source_rank_signal(candidate);
    let visibility_gradient = visibility_gradient_signal(candidate);
    let engagement_penalty_factor = engagement_penalties(candidate);
    let multi_source = multi_source_evidence_signal(candidate);
    let velocity = content_velocity_signal(candidate);

    // ── P2 信号 ──
    let sophistication = user_sophistication_factor(query);
    let lang_match = language_match_signal(query, candidate);
    let fq_interaction = freshness_quality_interaction(freshness, quality);
    let tod_adjustment = time_of_day_adjustment(query);

    let weights = policy.relevance;
    let base_relevance = clamp01(
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

    // 叠加新信号: 乘法调整避免破坏归一化
    let graph_boost = 1.0 + graph_authority * 0.08;       // 最大 +8%
    let rank_boost = 1.0 + source_rank * 0.06;            // 最大 +6%
    let multi_source_boost = 1.0 + multi_source * 0.05;   // 最大 +5%
    let velocity_boost = 1.0 + velocity * 0.04;           // 最大 +4%
    let fq_boost = 1.0 + (fq_interaction - freshness) * 0.05; // 新鲜度-质量交互微调
    let relevance = clamp01(
        base_relevance
            * graph_boost
            * rank_boost
            * visibility_gradient
            * engagement_penalty_factor
            * multi_source_boost
            * velocity_boost
            * sophistication
            * lang_match
            * fq_boost
            * tod_adjustment,
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
        content_kind,
        trend,
        source_quality,
    }
}
