use crate::contracts::{
    ActionScoresPayload, PhoenixScoresPayload, RecommendationCandidatePayload,
    RecommendationQueryPayload,
};
use crate::pipeline::local::signals::user_actions::UserActionProfile;
use telegram_ranking_primitives::{ACTION_NEGATIVE_FIELD, RANKING_STABLE_INTEREST_FIELD};

use super::action_estimator::estimate_action_scores;
use super::feature_builder::compute_ranking_signals;
use super::policy::current_scoring_policy;
use super::rule_signals::{
    clamp01, content_velocity_signal, engagement_penalties, graph_authority_signal,
    language_match_signal, merge_breakdown, multi_source_evidence_signal, source_rank_signal,
    time_of_day_adjustment, user_sophistication_factor, visibility_gradient_signal,
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
    merge_breakdown(candidate, "rankingContentKind", signals.content_kind);
    merge_breakdown(candidate, "rankingTrendHeat", signals.trend);
    merge_breakdown(candidate, "rankingSourceQuality", signals.source_quality);
    merge_breakdown(candidate, "rankingShortInterest", temporal.short_interest());
    merge_breakdown(
        candidate,
        RANKING_STABLE_INTEREST_FIELD,
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
    merge_breakdown(candidate, ACTION_NEGATIVE_FIELD, action_scores.negative);
    // ── 新增信号 breakdown (诊断用) ──
    merge_breakdown(
        candidate,
        "graphAuthority",
        graph_authority_signal(candidate),
    );
    merge_breakdown(candidate, "sourceRank", source_rank_signal(candidate));
    merge_breakdown(
        candidate,
        "visibilityGradient",
        visibility_gradient_signal(candidate),
    );
    merge_breakdown(
        candidate,
        "engagementPenalty",
        engagement_penalties(candidate),
    );
    merge_breakdown(
        candidate,
        "multiSourceEvidence",
        multi_source_evidence_signal(candidate),
    );
    merge_breakdown(
        candidate,
        "contentVelocity",
        content_velocity_signal(candidate),
    );
    merge_breakdown(
        candidate,
        "userSophistication",
        user_sophistication_factor(query),
    );
    merge_breakdown(
        candidate,
        "languageMatch",
        language_match_signal(query, candidate),
    );
    merge_breakdown(candidate, "timeOfDay", time_of_day_adjustment(query));
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
