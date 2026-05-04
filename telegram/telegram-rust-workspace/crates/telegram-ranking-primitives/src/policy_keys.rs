pub const AUTHOR_SOFT_CAP_POLICY_KEY: &str = "author_soft_cap";
pub const TOPIC_SOFT_CAP_RATIO_POLICY_KEY: &str = "topic_soft_cap_ratio";
pub const SOURCE_SOFT_CAP_RATIO_POLICY_KEY: &str = "source_soft_cap_ratio";
pub const DOMAIN_SOFT_CAP_RATIO_POLICY_KEY: &str = "domain_soft_cap_ratio";
pub const MEDIA_SOFT_CAP_RATIO_POLICY_KEY: &str = "media_soft_cap_ratio";

pub const IN_NETWORK_FLOOR_RATIO_POLICY_KEY: &str = "in_network_floor_ratio";
pub const SOCIAL_GRAPH_FLOOR_RATIO_POLICY_KEY: &str = "social_graph_floor_ratio";
pub const INTEREST_FLOOR_RATIO_POLICY_KEY: &str = "interest_floor_ratio";
pub const FALLBACK_FLOOR_RATIO_POLICY_KEY: &str = "fallback_floor_ratio";
pub const IN_NETWORK_CEILING_RATIO_POLICY_KEY: &str = "in_network_ceiling_ratio";
pub const SOCIAL_GRAPH_CEILING_RATIO_POLICY_KEY: &str = "social_graph_ceiling_ratio";
pub const INTEREST_CEILING_RATIO_POLICY_KEY: &str = "interest_ceiling_ratio";
pub const FALLBACK_CEILING_RATIO_POLICY_KEY: &str = "fallback_ceiling_ratio";
pub const TREND_FLOOR_RATIO_POLICY_KEY: &str = "trend_floor_ratio";
pub const NEWS_FLOOR_RATIO_POLICY_KEY: &str = "news_floor_ratio";
pub const EXPLORATION_FLOOR_RATIO_POLICY_KEY: &str = "exploration_floor_ratio";
pub const MAX_OON_RATIO_POLICY_KEY: &str = "max_oon_ratio";
pub const TREND_CEILING_RATIO_POLICY_KEY: &str = "trend_ceiling_ratio";
pub const NEWS_CEILING_RATIO_POLICY_KEY: &str = "news_ceiling_ratio";

pub const TREND_KEYWORDS_POLICY_KEY: &str = "trend_keywords";
pub const COLD_START_KEYWORDS_POLICY_KEY: &str = "cold_start_keywords";

pub const SOURCE_BATCH_TIMEOUT_MS_POLICY_KEY: &str = "source_batch_timeout_ms";
pub const TREND_BUDGET_BOOST_RATIO_POLICY_KEY: &str = "trend_budget_boost_ratio";
pub const SEMANTIC_DEDUP_OVERLAP_THRESHOLD_POLICY_KEY: &str = "semantic_dedup_overlap_threshold";
pub const SESSION_TOPIC_SUPPRESSION_WEIGHT_POLICY_KEY: &str = "session_topic_suppression_weight";
pub const EXPLORATION_RATE_POLICY_KEY: &str = "exploration_rate";
pub const EXPLORATION_RISK_CEILING_POLICY_KEY: &str = "exploration_risk_ceiling";
pub const BANDIT_EXPLORATION_RATE_POLICY_KEY: &str = "bandit_exploration_rate";
pub const BANDIT_UNCERTAINTY_WEIGHT_POLICY_KEY: &str = "bandit_uncertainty_weight";
pub const INTEREST_DECAY_HALF_LIFE_HOURS_POLICY_KEY: &str = "interest_decay_half_life_hours";
pub const NEGATIVE_FEEDBACK_PENALTY_WEIGHT_POLICY_KEY: &str = "negative_feedback_penalty_weight";
pub const NEWS_TREND_LINK_BOOST_POLICY_KEY: &str = "news_trend_link_boost";
pub const TREND_SOURCE_BOOST_POLICY_KEY: &str = "trend_source_boost";
pub const FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY: &str = "freshness_half_life_hours";
pub const NEGATIVE_FEEDBACK_HALF_LIFE_DAYS_POLICY_KEY: &str = "negative_feedback_half_life_days";
pub const NEGATIVE_FEEDBACK_PROPAGATION_WEIGHT_POLICY_KEY: &str =
    "negative_feedback_propagation_weight";

pub const CROSS_REQUEST_AUTHOR_SOFT_CAP_POLICY_KEY: &str = "cross_request_author_soft_cap";
pub const CROSS_REQUEST_SOURCE_SOFT_CAP_POLICY_KEY: &str = "cross_request_source_soft_cap";
pub const CROSS_REQUEST_TOPIC_SOFT_CAP_POLICY_KEY: &str = "cross_request_topic_soft_cap";
pub const NEAR_DUPLICATE_MIN_TOKEN_COUNT_POLICY_KEY: &str = "near_duplicate_min_token_count";
pub const NEAR_DUPLICATE_OVERLAP_THRESHOLD_POLICY_KEY: &str = "near_duplicate_overlap_threshold";

#[cfg(test)]
mod tests {
    use super::{
        AUTHOR_SOFT_CAP_POLICY_KEY, BANDIT_EXPLORATION_RATE_POLICY_KEY,
        CROSS_REQUEST_AUTHOR_SOFT_CAP_POLICY_KEY, FALLBACK_CEILING_RATIO_POLICY_KEY,
        FALLBACK_FLOOR_RATIO_POLICY_KEY, FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY,
        NEAR_DUPLICATE_OVERLAP_THRESHOLD_POLICY_KEY, TREND_KEYWORDS_POLICY_KEY,
    };

    #[test]
    fn exports_stable_ranking_policy_keys() {
        assert_eq!(AUTHOR_SOFT_CAP_POLICY_KEY, "author_soft_cap");
        assert_eq!(FALLBACK_FLOOR_RATIO_POLICY_KEY, "fallback_floor_ratio");
        assert_eq!(FALLBACK_CEILING_RATIO_POLICY_KEY, "fallback_ceiling_ratio");
        assert_eq!(TREND_KEYWORDS_POLICY_KEY, "trend_keywords");
        assert_eq!(
            CROSS_REQUEST_AUTHOR_SOFT_CAP_POLICY_KEY,
            "cross_request_author_soft_cap"
        );
        assert_eq!(
            NEAR_DUPLICATE_OVERLAP_THRESHOLD_POLICY_KEY,
            "near_duplicate_overlap_threshold"
        );
        assert_eq!(
            BANDIT_EXPLORATION_RATE_POLICY_KEY,
            "bandit_exploration_rate"
        );
        assert_eq!(
            FRESHNESS_HALF_LIFE_HOURS_POLICY_KEY,
            "freshness_half_life_hours"
        );
    }
}
