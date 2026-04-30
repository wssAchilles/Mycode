use crate::contracts::RecommendationQueryPayload;
use crate::sources::{
    COLD_START_SOURCE, EMBEDDING_AUTHOR_SOURCE, FOLLOWING_SOURCE, GRAPH_KERNEL_SOURCE,
    GRAPH_SOURCE, NEWS_ANN_SOURCE, POPULAR_SOURCE, SourceDescriptor, TWO_TOWER_SOURCE,
    source_descriptor,
};

use super::experiment::space_feed_experiment_number;
use super::ranking_policy::{ranking_policy_keywords, ranking_policy_number};
use super::retrieval::{FALLBACK_LANE, retrieval_lane_policy};
use super::signals::{
    EmbeddingSignalTier, embedding_signal_tier, popular_fallback_still_needed,
    sparse_graph_expansion_enabled, user_state,
};

#[derive(Debug, Clone)]
pub struct SourcePlan {
    pub source_id: String,
    pub lane: &'static str,
    pub enabled: bool,
    pub disabled_reason: Option<&'static str>,
    pub budget: usize,
    pub lane_budget: usize,
    pub mixing_multiplier: f64,
    pub trend_boost_ratio: f64,
    pub ml_cost_guard: &'static str,
    pub descriptor: Option<&'static SourceDescriptor>,
}

impl SourcePlan {
    fn disabled(
        source_name: &str,
        descriptor: Option<&'static SourceDescriptor>,
        reason: &'static str,
    ) -> Self {
        Self {
            source_id: source_name.to_string(),
            lane: descriptor
                .map(|descriptor| descriptor.lane)
                .unwrap_or(FALLBACK_LANE),
            enabled: false,
            disabled_reason: Some(reason),
            budget: 0,
            lane_budget: 0,
            mixing_multiplier: 0.0,
            trend_boost_ratio: 0.0,
            ml_cost_guard: ml_cost_guard(descriptor),
            descriptor,
        }
    }
}

pub fn source_mixing_multiplier(query: &RecommendationQueryPayload, source_name: &str) -> f64 {
    source_plan(query, source_name, usize::MAX).mixing_multiplier
}

pub fn source_candidate_budget(
    query: &RecommendationQueryPayload,
    source_name: &str,
    available_count: usize,
) -> usize {
    source_plan(query, source_name, available_count).budget
}

pub fn source_enabled_for_query(query: &RecommendationQueryPayload, source_name: &str) -> bool {
    source_plan(query, source_name, usize::MAX).enabled
}

pub fn source_plan(
    query: &RecommendationQueryPayload,
    source_name: &str,
    available_count: usize,
) -> SourcePlan {
    let Some(descriptor) = source_descriptor(source_name) else {
        return SourcePlan::disabled(source_name, None, "unknownSource");
    };

    if query.in_network_only {
        if source_name == FOLLOWING_SOURCE {
            return enabled_source_plan(query, descriptor, available_count);
        }
        return SourcePlan::disabled(source_name, Some(descriptor), "inNetworkOnly");
    }

    if !descriptor.online_allowed {
        return SourcePlan::disabled(source_name, Some(descriptor), "offlineOnlySource");
    }

    if source_name == POPULAR_SOURCE && !popular_fallback_still_needed(query) {
        return SourcePlan::disabled(source_name, Some(descriptor), "fallbackNotNeeded");
    }

    let lane_policy = retrieval_lane_policy(query, descriptor.lane);
    if !lane_policy.enabled {
        return SourcePlan::disabled(source_name, Some(descriptor), "laneDisabled");
    }

    if descriptor.requires_embedding && embedding_signal_tier(query) != EmbeddingSignalTier::Strong
    {
        return SourcePlan::disabled(source_name, Some(descriptor), "embeddingSignalTooWeak");
    }

    match user_state(query) {
        "cold_start" if source_name != COLD_START_SOURCE => {
            SourcePlan::disabled(source_name, Some(descriptor), "coldStartBootstrapOnly")
        }
        "sparse" => {
            if source_name == COLD_START_SOURCE {
                SourcePlan::disabled(source_name, Some(descriptor), "sparseSkipsColdStart")
            } else if source_name == GRAPH_SOURCE && !sparse_graph_expansion_enabled(query) {
                SourcePlan::disabled(source_name, Some(descriptor), "sparseGraphDisabled")
            } else {
                enabled_source_plan(query, descriptor, available_count)
            }
        }
        "warm" | "heavy" if source_name == COLD_START_SOURCE => {
            SourcePlan::disabled(source_name, Some(descriptor), "warmSkipsColdStart")
        }
        _ => enabled_source_plan(query, descriptor, available_count),
    }
}

fn enabled_source_plan(
    query: &RecommendationQueryPayload,
    descriptor: &'static SourceDescriptor,
    available_count: usize,
) -> SourcePlan {
    let lane_policy = retrieval_lane_policy(query, descriptor.lane);
    let lane_budget = space_feed_experiment_number(
        query,
        &format!("lane_budget_{}", descriptor.lane),
        lane_policy.candidate_budget as f64,
    )
    .max(1.0) as usize;
    let policy_budget =
        ((lane_budget as f64) * source_lane_share(query, descriptor.id)).ceil() as usize;
    let policy_budget = policy_budget.max(query.limit.min(lane_budget));
    let policy_budget = dynamic_topup_source_budget(query, descriptor.id, policy_budget);
    let (policy_budget, trend_boost_ratio) =
        apply_trend_source_budget_boost(query, descriptor.id, policy_budget);

    let experiment_budget = space_feed_experiment_number(
        query,
        &format!("source_budget_{}", descriptor.id.to_lowercase()),
        policy_budget as f64,
    )
    .max(1.0) as usize;

    SourcePlan {
        source_id: descriptor.id.to_string(),
        lane: descriptor.lane,
        enabled: true,
        disabled_reason: None,
        budget: available_count.min(experiment_budget),
        lane_budget,
        mixing_multiplier: lane_policy.mixing_multiplier * source_adjustment(descriptor.id),
        trend_boost_ratio,
        ml_cost_guard: ml_cost_guard(Some(descriptor)),
        descriptor: Some(descriptor),
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
        ("cold_start", COLD_START_SOURCE) => policy_budget.max(limit.saturating_mul(6)),
        ("sparse", POPULAR_SOURCE) => match embedding_tier {
            EmbeddingSignalTier::Strong => policy_budget.max(limit.saturating_mul(2)),
            EmbeddingSignalTier::Weak => policy_budget.max(limit.saturating_mul(3)),
            EmbeddingSignalTier::Missing => policy_budget.max(limit.saturating_mul(4)),
        },
        ("sparse", GRAPH_SOURCE) | ("sparse", GRAPH_KERNEL_SOURCE) => {
            policy_budget.max(limit.saturating_mul(2))
        }
        ("warm", POPULAR_SOURCE) => match embedding_tier {
            EmbeddingSignalTier::Strong => policy_budget,
            EmbeddingSignalTier::Weak => policy_budget.max(limit.saturating_mul(2)),
            EmbeddingSignalTier::Missing => policy_budget.max(limit.saturating_mul(3)),
        },
        ("warm", GRAPH_SOURCE) | ("warm", GRAPH_KERNEL_SOURCE) => {
            policy_budget.max(limit.saturating_mul(3))
        }
        ("heavy", GRAPH_SOURCE) | ("heavy", GRAPH_KERNEL_SOURCE) => {
            policy_budget.max(limit.saturating_mul(3))
        }
        ("heavy", POPULAR_SOURCE) => match embedding_tier {
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
) -> (usize, f64) {
    if ranking_policy_keywords(query, "trend_keywords").is_empty() {
        return (policy_budget, 0.0);
    }

    let configured_boost =
        ranking_policy_number(query, "trend_budget_boost_ratio", 0.16).clamp(0.0, 0.5);
    let source_weight = match source_name {
        NEWS_ANN_SOURCE => 1.0,
        TWO_TOWER_SOURCE => 0.72,
        GRAPH_SOURCE | GRAPH_KERNEL_SOURCE => 0.48,
        COLD_START_SOURCE => 0.36,
        POPULAR_SOURCE => 0.28,
        _ => 0.0,
    };
    if source_weight <= 0.0 || configured_boost <= 0.0 {
        return (policy_budget, 0.0);
    }

    let boost_ratio = configured_boost * source_weight;
    (
        ((policy_budget as f64) * (1.0 + boost_ratio)).ceil() as usize,
        boost_ratio,
    )
}

fn source_lane_share(query: &RecommendationQueryPayload, source_name: &str) -> f64 {
    let embedding_tier = embedding_signal_tier(query);
    let sparse_graph_enabled = sparse_graph_expansion_enabled(query);
    match source_name {
        FOLLOWING_SOURCE | POPULAR_SOURCE | COLD_START_SOURCE => 1.0,
        GRAPH_SOURCE => 1.0,
        TWO_TOWER_SOURCE => match embedding_tier {
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
        EMBEDDING_AUTHOR_SOURCE => match embedding_tier {
            EmbeddingSignalTier::Strong => {
                if sparse_graph_enabled {
                    0.30
                } else {
                    0.34
                }
            }
            EmbeddingSignalTier::Weak | EmbeddingSignalTier::Missing => 0.0,
        },
        NEWS_ANN_SOURCE => match embedding_tier {
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

fn source_adjustment(source_name: &str) -> f64 {
    match source_name {
        FOLLOWING_SOURCE => 1.0,
        GRAPH_SOURCE => 1.0,
        TWO_TOWER_SOURCE => 1.03,
        EMBEDDING_AUTHOR_SOURCE => 1.01,
        NEWS_ANN_SOURCE => 0.97,
        POPULAR_SOURCE => 1.0,
        COLD_START_SOURCE => 1.02,
        _ => 1.0,
    }
}

fn ml_cost_guard(descriptor: Option<&SourceDescriptor>) -> &'static str {
    match descriptor {
        Some(descriptor) if descriptor.is_ml_backed && !descriptor.online_allowed => {
            "offline_only_guard"
        }
        Some(descriptor) if descriptor.is_ml_backed => "online_ml_allowed_by_registry",
        Some(_) => "not_ml_backed",
        None => "unknown_source",
    }
}
