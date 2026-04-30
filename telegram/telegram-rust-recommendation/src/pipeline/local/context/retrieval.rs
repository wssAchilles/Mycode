use crate::contracts::RecommendationQueryPayload;

use super::signals::{
    EmbeddingSignalTier, embedding_signal_tier, social_momentum_boost,
    sparse_graph_expansion_enabled, user_state,
};
pub use crate::sources::{FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE};

#[derive(Debug, Clone, Copy)]
pub(super) struct RetrievalLanePolicy {
    pub(super) enabled: bool,
    pub(super) candidate_budget: usize,
    pub(super) mixing_multiplier: f64,
}

#[derive(Debug, Clone, Copy)]
struct RetrievalLaneContext {
    embedding_tier: EmbeddingSignalTier,
    sparse_graph_enabled: bool,
    social_momentum: f64,
}

pub(super) fn retrieval_lane_policy(
    query: &RecommendationQueryPayload,
    lane: &str,
) -> RetrievalLanePolicy {
    let context = RetrievalLaneContext {
        embedding_tier: embedding_signal_tier(query),
        sparse_graph_enabled: sparse_graph_expansion_enabled(query),
        social_momentum: social_momentum_boost(query),
    };

    match user_state(query) {
        "cold_start" => cold_start_lane_policy(lane),
        "sparse" => sparse_lane_policy(lane, context),
        "warm" => warm_lane_policy(lane, context),
        "heavy" => heavy_lane_policy(lane, context),
        _ => default_lane_policy(query, lane),
    }
}

pub fn source_retrieval_lane(source_name: &str) -> &'static str {
    crate::sources::source_retrieval_lane(source_name)
}

fn cold_start_lane_policy(lane: &str) -> RetrievalLanePolicy {
    match lane {
        FALLBACK_LANE => lane_policy(true, 96, 1.02),
        _ => lane_policy(false, 0, 0.0),
    }
}

fn sparse_lane_policy(lane: &str, context: RetrievalLaneContext) -> RetrievalLanePolicy {
    match lane {
        IN_NETWORK_LANE => lane_policy(
            true,
            if context.sparse_graph_enabled { 72 } else { 80 },
            1.015,
        ),
        SOCIAL_EXPANSION_LANE => sparse_social_expansion_policy(context),
        INTEREST_LANE => sparse_interest_policy(context),
        FALLBACK_LANE => sparse_fallback_policy(context),
        _ => lane_policy(true, 48, 1.0),
    }
}

fn sparse_social_expansion_policy(context: RetrievalLaneContext) -> RetrievalLanePolicy {
    if !context.sparse_graph_enabled {
        return lane_policy(false, 0, 0.0);
    }

    lane_policy(
        true,
        match context.embedding_tier {
            EmbeddingSignalTier::Strong => 48,
            EmbeddingSignalTier::Weak => 42,
            EmbeddingSignalTier::Missing => 34,
        },
        1.02 + context.social_momentum,
    )
}

fn sparse_interest_policy(context: RetrievalLaneContext) -> RetrievalLanePolicy {
    lane_policy(
        true,
        match context.embedding_tier {
            EmbeddingSignalTier::Strong => {
                if context.sparse_graph_enabled {
                    120
                } else {
                    128
                }
            }
            EmbeddingSignalTier::Weak => {
                if context.sparse_graph_enabled {
                    84
                } else {
                    88
                }
            }
            EmbeddingSignalTier::Missing => {
                if context.sparse_graph_enabled {
                    48
                } else {
                    52
                }
            }
        },
        match context.embedding_tier {
            EmbeddingSignalTier::Strong => {
                if context.sparse_graph_enabled {
                    1.045
                } else {
                    1.055
                }
            }
            EmbeddingSignalTier::Weak => 1.0,
            EmbeddingSignalTier::Missing => 0.95,
        },
    )
}

fn sparse_fallback_policy(context: RetrievalLaneContext) -> RetrievalLanePolicy {
    lane_policy(
        true,
        match context.embedding_tier {
            EmbeddingSignalTier::Strong => {
                if context.sparse_graph_enabled {
                    24
                } else {
                    32
                }
            }
            EmbeddingSignalTier::Weak => {
                if context.sparse_graph_enabled {
                    44
                } else {
                    52
                }
            }
            EmbeddingSignalTier::Missing => {
                if context.sparse_graph_enabled {
                    68
                } else {
                    80
                }
            }
        },
        match context.embedding_tier {
            EmbeddingSignalTier::Strong => {
                if context.sparse_graph_enabled {
                    0.94
                } else {
                    0.97
                }
            }
            EmbeddingSignalTier::Weak => {
                if context.sparse_graph_enabled {
                    0.99
                } else {
                    1.0
                }
            }
            EmbeddingSignalTier::Missing => {
                if context.sparse_graph_enabled {
                    1.02
                } else {
                    1.04
                }
            }
        },
    )
}

fn warm_lane_policy(lane: &str, context: RetrievalLaneContext) -> RetrievalLanePolicy {
    match lane {
        IN_NETWORK_LANE => lane_policy(true, 120, 1.03),
        SOCIAL_EXPANSION_LANE => lane_policy(
            true,
            if context.social_momentum >= 0.03 {
                76
            } else {
                64
            },
            1.02 + context.social_momentum,
        ),
        INTEREST_LANE => lane_policy(
            true,
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 96,
                EmbeddingSignalTier::Weak => 64,
                EmbeddingSignalTier::Missing => 36,
            },
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 1.01,
                EmbeddingSignalTier::Weak => 0.97,
                EmbeddingSignalTier::Missing => 0.93,
            },
        ),
        FALLBACK_LANE => lane_policy(
            true,
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 36,
                EmbeddingSignalTier::Weak => 48,
                EmbeddingSignalTier::Missing => 68,
            },
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 0.97,
                EmbeddingSignalTier::Weak => 1.0,
                EmbeddingSignalTier::Missing => 1.02,
            },
        ),
        _ => lane_policy(true, 48, 1.0),
    }
}

fn heavy_lane_policy(lane: &str, context: RetrievalLaneContext) -> RetrievalLanePolicy {
    match lane {
        IN_NETWORK_LANE => lane_policy(true, 150, 1.06),
        SOCIAL_EXPANSION_LANE => lane_policy(
            true,
            if context.social_momentum >= 0.03 {
                104
            } else {
                92
            },
            1.04 + context.social_momentum,
        ),
        INTEREST_LANE => lane_policy(
            true,
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 104,
                EmbeddingSignalTier::Weak => 64,
                EmbeddingSignalTier::Missing => 36,
            },
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 1.01,
                EmbeddingSignalTier::Weak => 0.94,
                EmbeddingSignalTier::Missing => 0.9,
            },
        ),
        FALLBACK_LANE => lane_policy(
            true,
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 22,
                EmbeddingSignalTier::Weak => 36,
                EmbeddingSignalTier::Missing => 64,
            },
            match context.embedding_tier {
                EmbeddingSignalTier::Strong => 0.92,
                EmbeddingSignalTier::Weak => 0.98,
                EmbeddingSignalTier::Missing => 1.03,
            },
        ),
        _ => lane_policy(true, 48, 1.0),
    }
}

fn default_lane_policy(query: &RecommendationQueryPayload, lane: &str) -> RetrievalLanePolicy {
    match lane {
        FALLBACK_LANE => lane_policy(true, 48, 1.0),
        _ => lane_policy(true, query.limit.max(available_min_budget(query)), 1.0),
    }
}

fn lane_policy(
    enabled: bool,
    candidate_budget: usize,
    mixing_multiplier: f64,
) -> RetrievalLanePolicy {
    RetrievalLanePolicy {
        enabled,
        candidate_budget,
        mixing_multiplier,
    }
}

fn available_min_budget(query: &RecommendationQueryPayload) -> usize {
    query.limit.max(24)
}
