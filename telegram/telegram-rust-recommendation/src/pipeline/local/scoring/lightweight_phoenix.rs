use crate::contracts::{
    ActionScoresPayload, PhoenixScoresPayload, RecommendationCandidatePayload,
    RecommendationQueryPayload,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

use super::action_estimator::estimate_action_scores;
use super::feature_builder::compute_ranking_signals;
use super::policy::current_scoring_policy;
use super::rule_signals::{
    clamp01, content_kind_signal, merge_breakdown, source_quality_signal, trend_signal,
};

pub fn apply_lightweight_phoenix_scores_with_profile(
    query: &RecommendationQueryPayload,
    candidate: &mut RecommendationCandidatePayload,
    action_profile: &UserActionProfile,
) {
    let policy = current_scoring_policy();
    let signals = compute_ranking_signals(query, candidate, action_profile, policy);
    let action_scores = candidate
        .phoenix_scores
        .as_ref()
        .map(action_scores_from_phoenix)
        .unwrap_or_else(|| estimate_action_scores(candidate, signals, action_profile, policy));
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
    candidate.score_breakdown_version = Some(policy.version.to_string());
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
