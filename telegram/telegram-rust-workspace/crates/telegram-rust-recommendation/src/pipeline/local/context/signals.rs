use crate::contracts::RecommendationQueryPayload;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EmbeddingSignalTier {
    Strong,
    Weak,
    Missing,
}

pub(super) fn user_state(query: &RecommendationQueryPayload) -> &str {
    query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("")
}

pub(super) fn sparse_graph_expansion_enabled(query: &RecommendationQueryPayload) -> bool {
    let Some(context) = query.user_state_context.as_ref() else {
        return false;
    };
    if context.state != "sparse" {
        return false;
    }

    let sequence_positive_actions = positive_action_count_from_sequences(query);
    let embedding_tier = embedding_signal_tier(query);
    context.followed_count >= 2
        || context.recent_positive_action_count >= 2
        || sequence_positive_actions >= 2
        || embedding_tier == EmbeddingSignalTier::Strong
        || (embedding_tier == EmbeddingSignalTier::Weak
            && (context.followed_count >= 1 || sequence_positive_actions >= 1))
}

pub(super) fn social_momentum_boost(query: &RecommendationQueryPayload) -> f64 {
    let recent_positive_action_count = query
        .user_state_context
        .as_ref()
        .map(|context| context.recent_positive_action_count)
        .unwrap_or(0)
        .max(positive_action_count_from_sequences(query) as i64);

    // UserSignal explicit score provides additional signal for momentum
    let explicit_signal = user_signal_explicit_score(query);
    let effective_count = if explicit_signal > 20.0 {
        recent_positive_action_count + 4
    } else if explicit_signal > 10.0 {
        recent_positive_action_count + 2
    } else {
        recent_positive_action_count
    };

    if effective_count >= 24 {
        0.06
    } else if effective_count >= 12 {
        0.03
    } else if effective_count >= 6 {
        0.015
    } else {
        0.0
    }
}

pub(super) fn popular_fallback_still_needed(query: &RecommendationQueryPayload) -> bool {
    let Some(context) = query.user_state_context.as_ref() else {
        return false;
    };

    if context.state != "warm" && context.state != "heavy" {
        return true;
    }

    let sequence_positive_actions = positive_action_count_from_sequences(query) as i64;
    let positive_actions = context
        .recent_positive_action_count
        .max(sequence_positive_actions);
    let strong_embedding = embedding_signal_tier(query) == EmbeddingSignalTier::Strong;
    let dense_social_graph = context.followed_count >= 12 && positive_actions >= 8;
    let dense_interest_graph =
        strong_embedding && context.followed_count >= 8 && positive_actions >= 6;

    // High engagement users with strong signal data don't need popular fallback
    let engagement = user_signal_engagement_score(query);
    let high_signal_engagement = engagement > 50.0 && positive_actions >= 4;

    !(dense_social_graph || dense_interest_graph || high_signal_engagement)
}

pub(super) fn embedding_signal_tier(query: &RecommendationQueryPayload) -> EmbeddingSignalTier {
    let Some(embedding_context) = query.embedding_context.as_ref() else {
        return EmbeddingSignalTier::Missing;
    };
    if !embedding_context.usable
        || query
            .user_state_context
            .as_ref()
            .map(|context| !context.usable_embedding)
            .unwrap_or(false)
        || embedding_context.interested_in_clusters.is_empty()
    {
        return EmbeddingSignalTier::Missing;
    }

    let quality_score = embedding_context.quality_score.unwrap_or_default();
    if embedding_context.stale.unwrap_or(false) || quality_score < 0.45 {
        return EmbeddingSignalTier::Weak;
    }

    EmbeddingSignalTier::Strong
}

/// Pre-computed engagement score from UserSignal aggregation (0.0 if unavailable).
pub(super) fn user_signal_engagement_score(query: &RecommendationQueryPayload) -> f64 {
    query
        .user_signal_features
        .as_ref()
        .map(|f| f.engagement_score)
        .unwrap_or(0.0)
}

/// Pre-computed explicit signal score (likes, retweets, replies, quotes, follows).
pub(super) fn user_signal_explicit_score(query: &RecommendationQueryPayload) -> f64 {
    query
        .user_signal_features
        .as_ref()
        .map(|f| f.explicit_score)
        .unwrap_or(0.0)
}

/// Pre-computed implicit signal score (clicks, video views, dwell time).
pub(super) fn user_signal_implicit_score(query: &RecommendationQueryPayload) -> f64 {
    query
        .user_signal_features
        .as_ref()
        .map(|f| f.implicit_score)
        .unwrap_or(0.0)
}

fn positive_action_count_from_sequences(query: &RecommendationQueryPayload) -> usize {
    query
        .user_action_sequence
        .as_ref()
        .or(query.model_user_action_sequence.as_ref())
        .into_iter()
        .flatten()
        .filter(|action| is_positive_action(action))
        .count()
}

fn is_positive_action(action: &std::collections::HashMap<String, Value>) -> bool {
    action
        .get("action")
        .and_then(Value::as_str)
        .map(|action_name| {
            matches!(
                action_name,
                "click"
                    | "tweet_click"
                    | "open"
                    | "like"
                    | "favorite"
                    | "reply"
                    | "comment"
                    | "repost"
                    | "retweet"
                    | "quote"
                    | "share"
                    | "dwell"
                    | "profile_click"
                    | "follow_author"
            )
        })
        .unwrap_or(false)
}
