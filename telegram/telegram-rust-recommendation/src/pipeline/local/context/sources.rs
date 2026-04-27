use crate::contracts::RecommendationQueryPayload;

use super::experiment::space_feed_experiment_number;
use super::ranking_policy::{ranking_policy_keywords, ranking_policy_number};
use super::retrieval::{retrieval_lane_policy, source_retrieval_lane};
use super::signals::{
    EmbeddingSignalTier, embedding_signal_tier, popular_fallback_still_needed,
    sparse_graph_expansion_enabled, user_state,
};

pub fn source_mixing_multiplier(query: &RecommendationQueryPayload, source_name: &str) -> f64 {
    let lane_policy = retrieval_lane_policy(query, source_retrieval_lane(source_name));
    if !lane_policy.enabled {
        return 0.0;
    }

    let source_adjustment = match source_name {
        "FollowingSource" => 1.0,
        "GraphSource" => 1.0,
        "TwoTowerSource" => 1.03,
        "EmbeddingAuthorSource" => 1.01,
        "NewsAnnSource" => 0.97,
        "PopularSource" => 1.0,
        "ColdStartSource" => 1.02,
        _ => 1.0,
    };

    lane_policy.mixing_multiplier * source_adjustment
}

pub fn source_candidate_budget(
    query: &RecommendationQueryPayload,
    source_name: &str,
    available_count: usize,
) -> usize {
    if !source_enabled_for_query(query, source_name) {
        return 0;
    }

    let lane_policy = retrieval_lane_policy(query, source_retrieval_lane(source_name));
    let lane_budget = space_feed_experiment_number(
        query,
        &format!("lane_budget_{}", source_retrieval_lane(source_name)),
        lane_policy.candidate_budget as f64,
    )
    .max(1.0) as usize;
    let policy_budget =
        ((lane_budget as f64) * source_lane_share(query, source_name)).ceil() as usize;
    let policy_budget = policy_budget.max(query.limit.min(lane_budget));
    let policy_budget = dynamic_topup_source_budget(query, source_name, policy_budget);
    let policy_budget = apply_trend_source_budget_boost(query, source_name, policy_budget);

    let experiment_budget = space_feed_experiment_number(
        query,
        &format!("source_budget_{}", source_name.to_lowercase()),
        policy_budget as f64,
    )
    .max(1.0) as usize;

    available_count.min(experiment_budget)
}

pub fn source_enabled_for_query(query: &RecommendationQueryPayload, source_name: &str) -> bool {
    if query.in_network_only {
        return source_name == "FollowingSource";
    }

    if source_name == "PopularSource" && !popular_fallback_still_needed(query) {
        return false;
    }

    let lane_policy = retrieval_lane_policy(query, source_retrieval_lane(source_name));
    if !lane_policy.enabled {
        return false;
    }

    if source_name == "EmbeddingAuthorSource"
        && embedding_signal_tier(query) != EmbeddingSignalTier::Strong
    {
        return false;
    }

    match user_state(query) {
        "cold_start" => source_name == "ColdStartSource",
        "sparse" => {
            if source_name == "ColdStartSource" {
                false
            } else if source_name == "GraphSource" {
                sparse_graph_expansion_enabled(query)
            } else {
                true
            }
        }
        "warm" | "heavy" => source_name != "ColdStartSource",
        _ => true,
    }
}

fn dynamic_topup_source_budget(
    query: &RecommendationQueryPayload,
    source_name: &str,
    policy_budget: usize,
) -> usize {
    let limit = query.limit.max(1);
    let embedding_tier = embedding_signal_tier(query);
    match (user_state(query), source_name) {
        ("cold_start", "ColdStartSource") => policy_budget.max(limit.saturating_mul(6)),
        ("sparse", "PopularSource") => match embedding_tier {
            EmbeddingSignalTier::Strong => policy_budget.max(limit.saturating_mul(2)),
            EmbeddingSignalTier::Weak => policy_budget.max(limit.saturating_mul(3)),
            EmbeddingSignalTier::Missing => policy_budget.max(limit.saturating_mul(4)),
        },
        ("sparse", "GraphSource") | ("sparse", "GraphKernelSource") => {
            policy_budget.max(limit.saturating_mul(2))
        }
        ("warm", "PopularSource") => match embedding_tier {
            EmbeddingSignalTier::Strong => policy_budget,
            EmbeddingSignalTier::Weak => policy_budget.max(limit.saturating_mul(2)),
            EmbeddingSignalTier::Missing => policy_budget.max(limit.saturating_mul(3)),
        },
        ("warm", "GraphSource") | ("warm", "GraphKernelSource") => {
            policy_budget.max(limit.saturating_mul(3))
        }
        ("heavy", "GraphSource") | ("heavy", "GraphKernelSource") => {
            policy_budget.max(limit.saturating_mul(3))
        }
        ("heavy", "PopularSource") => match embedding_tier {
            EmbeddingSignalTier::Strong => policy_budget,
            EmbeddingSignalTier::Weak | EmbeddingSignalTier::Missing => {
                policy_budget.max(limit.saturating_mul(2))
            }
        },
        _ => policy_budget,
    }
}

fn apply_trend_source_budget_boost(
    query: &RecommendationQueryPayload,
    source_name: &str,
    policy_budget: usize,
) -> usize {
    if ranking_policy_keywords(query, "trend_keywords").is_empty() {
        return policy_budget;
    }

    let configured_boost =
        ranking_policy_number(query, "trend_budget_boost_ratio", 0.16).clamp(0.0, 0.5);
    let source_weight = match source_name {
        "NewsAnnSource" => 1.0,
        "TwoTowerSource" => 0.72,
        "GraphSource" | "GraphKernelSource" => 0.48,
        "ColdStartSource" => 0.36,
        "PopularSource" => 0.28,
        _ => 0.0,
    };
    if source_weight <= 0.0 || configured_boost <= 0.0 {
        return policy_budget;
    }

    ((policy_budget as f64) * (1.0 + configured_boost * source_weight)).ceil() as usize
}

fn source_lane_share(query: &RecommendationQueryPayload, source_name: &str) -> f64 {
    let embedding_tier = embedding_signal_tier(query);
    let sparse_graph_enabled = sparse_graph_expansion_enabled(query);
    match source_name {
        "FollowingSource" | "PopularSource" | "ColdStartSource" => 1.0,
        "GraphSource" => match user_state(query) {
            "sparse" if sparse_graph_enabled => 1.0,
            "warm" => 1.0,
            "heavy" => 1.0,
            _ => 1.0,
        },
        "TwoTowerSource" => match embedding_tier {
            EmbeddingSignalTier::Strong => {
                if sparse_graph_enabled {
                    0.38
                } else {
                    0.40
                }
            }
            EmbeddingSignalTier::Weak => 0.58,
            EmbeddingSignalTier::Missing => 0.64,
        },
        "EmbeddingAuthorSource" => match embedding_tier {
            EmbeddingSignalTier::Strong => {
                if sparse_graph_enabled {
                    0.30
                } else {
                    0.34
                }
            }
            EmbeddingSignalTier::Weak | EmbeddingSignalTier::Missing => 0.0,
        },
        "NewsAnnSource" => match embedding_tier {
            EmbeddingSignalTier::Strong => {
                if sparse_graph_enabled {
                    0.24
                } else {
                    0.26
                }
            }
            EmbeddingSignalTier::Weak => 0.42,
            EmbeddingSignalTier::Missing => 0.36,
        },
        _ => 1.0,
    }
}
