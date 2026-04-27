use crate::contracts::RecommendationQueryPayload;

use super::experiment::space_feed_experiment_number;

pub const SCORE_CONTRACT_VERSION: &str = "recommendation_score_contract_v2";
pub const SCORE_BREAKDOWN_VERSION: &str = "score_breakdown_v2";

pub fn ranking_policy_number(query: &RecommendationQueryPayload, key: &str, default: f64) -> f64 {
    let value = match key {
        "exploration_rate" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.exploration_rate),
        "bandit_exploration_rate" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.bandit_exploration_rate),
        "bandit_uncertainty_weight" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.bandit_uncertainty_weight),
        "exploration_risk_ceiling" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.exploration_risk_ceiling),
        "freshness_half_life_hours" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.freshness_half_life_hours),
        "negative_feedback_half_life_days" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.negative_feedback_half_life_days),
        "interest_decay_half_life_hours" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.interest_decay_half_life_hours),
        "negative_feedback_penalty_weight" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.negative_feedback_penalty_weight),
        "source_batch_timeout_ms" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.source_batch_timeout_ms),
        "max_oon_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.max_oon_ratio),
        "fallback_ceiling_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.fallback_ceiling_ratio),
        "exploration_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.exploration_floor_ratio),
        "session_topic_suppression_weight" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.session_topic_suppression_weight),
        "semantic_dedup_overlap_threshold" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.semantic_dedup_overlap_threshold),
        "near_duplicate_overlap_threshold" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.near_duplicate_overlap_threshold),
        "negative_feedback_propagation_weight" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.negative_feedback_propagation_weight),
        "trend_source_boost" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_source_boost),
        "trend_budget_boost_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_budget_boost_ratio),
        "news_trend_link_boost" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.news_trend_link_boost),
        "trend_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_floor_ratio),
        "trend_ceiling_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_ceiling_ratio),
        "news_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.news_floor_ratio),
        "news_ceiling_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.news_ceiling_ratio),
        "in_network_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.in_network_floor_ratio),
        "social_graph_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.social_graph_floor_ratio),
        "interest_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.interest_floor_ratio),
        "fallback_floor_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.fallback_floor_ratio),
        "in_network_ceiling_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.in_network_ceiling_ratio),
        "social_graph_ceiling_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.social_graph_ceiling_ratio),
        "interest_ceiling_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.interest_ceiling_ratio),
        "topic_soft_cap_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.topic_soft_cap_ratio),
        "source_soft_cap_ratio" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.source_soft_cap_ratio),
        _ => None,
    };

    value
        .filter(|value| value.is_finite())
        .unwrap_or_else(|| space_feed_experiment_number(query, key, default))
}

pub fn ranking_policy_usize(
    query: &RecommendationQueryPayload,
    key: &str,
    default: usize,
) -> usize {
    match key {
        "author_soft_cap" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.author_soft_cap)
            .unwrap_or(default),
        "cross_request_author_soft_cap" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cross_request_author_soft_cap)
            .unwrap_or(default),
        "cross_request_topic_soft_cap" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cross_request_topic_soft_cap)
            .unwrap_or(default),
        "cross_request_source_soft_cap" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cross_request_source_soft_cap)
            .unwrap_or(default),
        "near_duplicate_min_token_count" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.near_duplicate_min_token_count)
            .unwrap_or(default),
        _ => space_feed_experiment_number(query, key, default as f64)
            .max(1.0)
            .round() as usize,
    }
}

pub fn ranking_policy_contract_version(query: &RecommendationQueryPayload) -> &str {
    query
        .ranking_policy
        .as_ref()
        .and_then(|policy| policy.contract_version.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(SCORE_CONTRACT_VERSION)
}

pub fn ranking_policy_strategy_version(query: &RecommendationQueryPayload) -> &str {
    query
        .ranking_policy
        .as_ref()
        .and_then(|policy| policy.strategy_version.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("strategy_policy_v1")
}

pub fn ranking_policy_score_breakdown_version(query: &RecommendationQueryPayload) -> &str {
    query
        .ranking_policy
        .as_ref()
        .and_then(|policy| policy.score_breakdown_version.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(SCORE_BREAKDOWN_VERSION)
}

pub fn ranking_policy_keywords(query: &RecommendationQueryPayload, key: &str) -> Vec<String> {
    let values = match key {
        "cold_start_keywords" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cold_start_keywords.as_ref()),
        "trend_keywords" => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_keywords.as_ref()),
        _ => None,
    };

    values
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}
