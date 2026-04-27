use crate::contracts::RecommendationQueryPayload;

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
    context.state == "sparse"
        && (context.followed_count >= 3 || context.recent_positive_action_count >= 4)
}

pub(super) fn social_momentum_boost(query: &RecommendationQueryPayload) -> f64 {
    let recent_positive_action_count = query
        .user_state_context
        .as_ref()
        .map(|context| context.recent_positive_action_count)
        .unwrap_or(0);
    if recent_positive_action_count >= 24 {
        0.06
    } else if recent_positive_action_count >= 12 {
        0.03
    } else if recent_positive_action_count >= 6 {
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

    context.followed_count < 12 || context.recent_positive_action_count < 12
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
