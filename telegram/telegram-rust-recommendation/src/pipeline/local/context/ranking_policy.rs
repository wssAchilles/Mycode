use crate::contracts::RecommendationQueryPayload;
use telegram_ranking_primitives::{
    AUTHOR_SOFT_CAP_POLICY_KEY, BANDIT_EXPLORATION_RATE_POLICY_KEY,
    BANDIT_UNCERTAINTY_WEIGHT_POLICY_KEY, COLD_START_KEYWORDS_POLICY_KEY,
    CROSS_REQUEST_AUTHOR_SOFT_CAP_POLICY_KEY, CROSS_REQUEST_SOURCE_SOFT_CAP_POLICY_KEY,
    CROSS_REQUEST_TOPIC_SOFT_CAP_POLICY_KEY, EXPLORATION_FLOOR_RATIO_POLICY_KEY,
    EXPLORATION_RATE_POLICY_KEY, EXPLORATION_RISK_CEILING_POLICY_KEY,
    FALLBACK_CEILING_RATIO_POLICY_KEY, FALLBACK_FLOOR_RATIO_POLICY_KEY,
    FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY, IN_NETWORK_CEILING_RATIO_POLICY_KEY,
    IN_NETWORK_FLOOR_RATIO_POLICY_KEY, INTEREST_CEILING_RATIO_POLICY_KEY,
    INTEREST_DECAY_HALF_LIFE_HOURS_POLICY_KEY, INTEREST_FLOOR_RATIO_POLICY_KEY,
    MAX_OON_RATIO_POLICY_KEY, NEAR_DUPLICATE_MIN_TOKEN_COUNT_POLICY_KEY,
    NEAR_DUPLICATE_OVERLAP_THRESHOLD_POLICY_KEY, NEGATIVE_FEEDBACK_HALF_LIFE_DAYS_POLICY_KEY,
    NEGATIVE_FEEDBACK_PENALTY_WEIGHT_POLICY_KEY, NEGATIVE_FEEDBACK_PROPAGATION_WEIGHT_POLICY_KEY,
    NEWS_CEILING_RATIO_POLICY_KEY, NEWS_FLOOR_RATIO_POLICY_KEY, NEWS_TREND_LINK_BOOST_POLICY_KEY,
    RANKING_POLICY_STRATEGY_VERSION, SEMANTIC_DEDUP_OVERLAP_THRESHOLD_POLICY_KEY,
    SESSION_TOPIC_SUPPRESSION_WEIGHT_POLICY_KEY, SOCIAL_GRAPH_CEILING_RATIO_POLICY_KEY,
    SOCIAL_GRAPH_FLOOR_RATIO_POLICY_KEY, SOURCE_BATCH_TIMEOUT_MS_POLICY_KEY,
    SOURCE_SOFT_CAP_RATIO_POLICY_KEY, TOPIC_SOFT_CAP_RATIO_POLICY_KEY,
    TREND_BUDGET_BOOST_RATIO_POLICY_KEY, TREND_CEILING_RATIO_POLICY_KEY,
    TREND_FLOOR_RATIO_POLICY_KEY, TREND_KEYWORDS_POLICY_KEY, TREND_SOURCE_BOOST_POLICY_KEY,
};
pub use telegram_ranking_primitives::{SCORE_BREAKDOWN_VERSION, SCORE_CONTRACT_VERSION};

use super::experiment::space_feed_experiment_number;

pub fn ranking_policy_number(query: &RecommendationQueryPayload, key: &str, default: f64) -> f64 {
    let value = match key {
        EXPLORATION_RATE_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.exploration_rate),
        BANDIT_EXPLORATION_RATE_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.bandit_exploration_rate),
        BANDIT_UNCERTAINTY_WEIGHT_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.bandit_uncertainty_weight),
        EXPLORATION_RISK_CEILING_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.exploration_risk_ceiling),
        FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.freshness_half_life_hours),
        NEGATIVE_FEEDBACK_HALF_LIFE_DAYS_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.negative_feedback_half_life_days),
        INTEREST_DECAY_HALF_LIFE_HOURS_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.interest_decay_half_life_hours),
        NEGATIVE_FEEDBACK_PENALTY_WEIGHT_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.negative_feedback_penalty_weight),
        SOURCE_BATCH_TIMEOUT_MS_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.source_batch_timeout_ms),
        MAX_OON_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.max_oon_ratio),
        FALLBACK_CEILING_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.fallback_ceiling_ratio),
        EXPLORATION_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.exploration_floor_ratio),
        SESSION_TOPIC_SUPPRESSION_WEIGHT_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.session_topic_suppression_weight),
        SEMANTIC_DEDUP_OVERLAP_THRESHOLD_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.semantic_dedup_overlap_threshold),
        NEAR_DUPLICATE_OVERLAP_THRESHOLD_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.near_duplicate_overlap_threshold),
        NEGATIVE_FEEDBACK_PROPAGATION_WEIGHT_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.negative_feedback_propagation_weight),
        TREND_SOURCE_BOOST_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_source_boost),
        TREND_BUDGET_BOOST_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_budget_boost_ratio),
        NEWS_TREND_LINK_BOOST_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.news_trend_link_boost),
        TREND_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_floor_ratio),
        TREND_CEILING_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.trend_ceiling_ratio),
        NEWS_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.news_floor_ratio),
        NEWS_CEILING_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.news_ceiling_ratio),
        IN_NETWORK_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.in_network_floor_ratio),
        SOCIAL_GRAPH_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.social_graph_floor_ratio),
        INTEREST_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.interest_floor_ratio),
        FALLBACK_FLOOR_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.fallback_floor_ratio),
        IN_NETWORK_CEILING_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.in_network_ceiling_ratio),
        SOCIAL_GRAPH_CEILING_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.social_graph_ceiling_ratio),
        INTEREST_CEILING_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.interest_ceiling_ratio),
        TOPIC_SOFT_CAP_RATIO_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.topic_soft_cap_ratio),
        SOURCE_SOFT_CAP_RATIO_POLICY_KEY => query
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
        AUTHOR_SOFT_CAP_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.author_soft_cap)
            .unwrap_or(default),
        CROSS_REQUEST_AUTHOR_SOFT_CAP_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cross_request_author_soft_cap)
            .unwrap_or(default),
        CROSS_REQUEST_TOPIC_SOFT_CAP_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cross_request_topic_soft_cap)
            .unwrap_or(default),
        CROSS_REQUEST_SOURCE_SOFT_CAP_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cross_request_source_soft_cap)
            .unwrap_or(default),
        NEAR_DUPLICATE_MIN_TOKEN_COUNT_POLICY_KEY => query
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
        .unwrap_or(RANKING_POLICY_STRATEGY_VERSION)
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
        COLD_START_KEYWORDS_POLICY_KEY => query
            .ranking_policy
            .as_ref()
            .and_then(|policy| policy.cold_start_keywords.as_ref()),
        TREND_KEYWORDS_POLICY_KEY => query
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
