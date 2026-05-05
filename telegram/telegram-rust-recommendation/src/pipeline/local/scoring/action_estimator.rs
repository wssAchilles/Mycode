use crate::contracts::{
    ActionScoresPayload, RankingSignalsPayload, RecommendationCandidatePayload,
};
use crate::pipeline::local::context::{IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::policy::{ActionFormulaWeights, ScoringPolicy};
use super::rule_signals::{clamp01, content_kind_signal, source_quality_signal, trend_signal};

pub(super) fn estimate_action_scores(
    candidate: &RecommendationCandidatePayload,
    signals: RankingSignalsPayload,
    action_profile: &UserActionProfile,
    policy: &ScoringPolicy,
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
    let weights = policy.action;
    let negative = clamp01(
        signals.negative_feedback
            + (1.0 - signals.quality) * weights.negative_quality_gap
            + signals.delivery_fatigue * weights.negative_delivery_fatigue
            + (1.0 - source_quality) * weights.negative_source_quality_gap
            + (candidate.is_nsfw == Some(true)) as i32 as f64 * weights.negative_nsfw,
    );
    let score_context = ActionScoreContext {
        signals,
        media_signal,
        content_kind,
        trend,
        social_lane,
        content_signal,
        source_quality,
        stable_interest: temporal.stable_interest(),
        negative,
    };

    ActionScoresPayload {
        click: score_action(weights.click, &score_context),
        like: score_action(weights.like, &score_context),
        reply: score_action(weights.reply, &score_context),
        repost: score_action(weights.repost, &score_context),
        dwell: score_action(weights.dwell, &score_context),
        negative,
    }
}

struct ActionScoreContext {
    signals: RankingSignalsPayload,
    media_signal: f64,
    content_kind: f64,
    trend: f64,
    social_lane: f64,
    content_signal: f64,
    source_quality: f64,
    stable_interest: f64,
    negative: f64,
}

fn score_action(weights: ActionFormulaWeights, context: &ActionScoreContext) -> f64 {
    clamp01(
        weights.base
            + context.signals.relevance * weights.relevance
            + context.signals.source_evidence * weights.source_evidence
            + context.media_signal * weights.media
            + context.content_kind * weights.content_kind
            + context.trend * weights.trend
            + context.signals.author_affinity * weights.author_affinity
            + context.signals.quality * weights.quality
            + context.stable_interest * weights.stable_interest
            + context.signals.network * weights.network
            + context.social_lane * weights.social_lane
            + context.signals.conversation_affinity.max(0.0) * weights.conversation_affinity
            + context.content_signal * weights.content_length
            + context.signals.popularity * weights.popularity
            + context.signals.freshness * weights.freshness
            + context.source_quality * weights.source_quality
            - context.negative * weights.negative_penalty,
    )
}
