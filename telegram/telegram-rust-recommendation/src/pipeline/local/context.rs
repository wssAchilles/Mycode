use std::collections::HashSet;

use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

const DEFAULT_SPACE_FEED_EXPERIMENT_ID: &str = "space_feed_recsys";
pub const IN_NETWORK_LANE: &str = "in_network";
pub const SOCIAL_EXPANSION_LANE: &str = "social_expansion";
pub const INTEREST_LANE: &str = "interest";
pub const FALLBACK_LANE: &str = "fallback";

#[derive(Debug, Clone, Copy)]
struct RetrievalLanePolicy {
    enabled: bool,
    candidate_budget: usize,
    mixing_multiplier: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EmbeddingSignalTier {
    Strong,
    Weak,
    Missing,
}

pub fn space_feed_experiment_flag(
    query: &RecommendationQueryPayload,
    key: &str,
    default: bool,
) -> bool {
    space_feed_experiment_config(query, key)
        .and_then(parse_bool)
        .unwrap_or(default)
}

pub fn space_feed_experiment_number(
    query: &RecommendationQueryPayload,
    key: &str,
    default: f64,
) -> f64 {
    space_feed_experiment_config(query, key)
        .and_then(parse_number)
        .unwrap_or(default)
}

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

pub fn source_retrieval_lane(source_name: &str) -> &'static str {
    match source_name {
        "FollowingSource" => IN_NETWORK_LANE,
        "GraphSource" | "GraphKernelSource" => SOCIAL_EXPANSION_LANE,
        "TwoTowerSource" | "EmbeddingAuthorSource" | "NewsAnnSource" => INTEREST_LANE,
        "PopularSource" | "ColdStartSource" => FALLBACK_LANE,
        _ => FALLBACK_LANE,
    }
}

pub fn related_post_ids(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let mut ids = vec![
        candidate.model_post_id.clone(),
        Some(candidate.post_id.clone()),
        candidate.original_post_id.clone(),
        candidate.reply_to_post_id.clone(),
        candidate.conversation_id.clone(),
    ];

    if candidate.is_news == Some(true) {
        if let Some(external_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.external_id.clone())
        {
            ids.push(Some(external_id));
        }
        if let Some(cluster_id) = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
        {
            ids.push(Some(format!("news:cluster:{cluster_id}")));
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids.into_iter().flatten() {
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

pub fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .as_deref()
        .and_then(|value| parse_bool(&Value::String(value.to_string())))
        .unwrap_or(default)
}

fn space_feed_experiment_config<'a>(
    query: &'a RecommendationQueryPayload,
    key: &str,
) -> Option<&'a Value> {
    let experiment_id = std::env::var("SPACE_FEED_EXPERIMENT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SPACE_FEED_EXPERIMENT_ID.to_string());

    query
        .experiment_context
        .as_ref()?
        .assignments
        .iter()
        .find(|assignment| assignment.in_experiment && assignment.experiment_id == experiment_id)
        .and_then(|assignment| assignment.config.get(key))
}

fn user_state<'a>(query: &'a RecommendationQueryPayload) -> &'a str {
    query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("")
}

fn sparse_graph_expansion_enabled(query: &RecommendationQueryPayload) -> bool {
    let Some(context) = query.user_state_context.as_ref() else {
        return false;
    };
    context.state == "sparse"
        && (context.followed_count >= 3 || context.recent_positive_action_count >= 4)
}

fn social_momentum_boost(query: &RecommendationQueryPayload) -> f64 {
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

fn popular_fallback_still_needed(query: &RecommendationQueryPayload) -> bool {
    let Some(context) = query.user_state_context.as_ref() else {
        return false;
    };

    if context.state != "warm" && context.state != "heavy" {
        return true;
    }

    context.followed_count < 12 || context.recent_positive_action_count < 12
}

fn retrieval_lane_policy(query: &RecommendationQueryPayload, lane: &str) -> RetrievalLanePolicy {
    let embedding_tier = embedding_signal_tier(query);
    let sparse_graph_enabled = sparse_graph_expansion_enabled(query);
    let social_momentum = social_momentum_boost(query);

    match (user_state(query), lane) {
        ("cold_start", FALLBACK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: 96,
            mixing_multiplier: 1.02,
        },
        ("cold_start", _) => RetrievalLanePolicy {
            enabled: false,
            candidate_budget: 0,
            mixing_multiplier: 0.0,
        },
        ("sparse", IN_NETWORK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: if sparse_graph_enabled { 72 } else { 80 },
            mixing_multiplier: 1.015,
        },
        ("sparse", SOCIAL_EXPANSION_LANE) => RetrievalLanePolicy {
            enabled: sparse_graph_enabled,
            candidate_budget: if sparse_graph_enabled {
                match embedding_tier {
                    EmbeddingSignalTier::Strong => 48,
                    EmbeddingSignalTier::Weak => 42,
                    EmbeddingSignalTier::Missing => 34,
                }
            } else {
                0
            },
            mixing_multiplier: if sparse_graph_enabled {
                1.02 + social_momentum
            } else {
                0.0
            },
        },
        ("sparse", INTEREST_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: match embedding_tier {
                EmbeddingSignalTier::Strong => {
                    if sparse_graph_enabled {
                        120
                    } else {
                        128
                    }
                }
                EmbeddingSignalTier::Weak => {
                    if sparse_graph_enabled {
                        84
                    } else {
                        88
                    }
                }
                EmbeddingSignalTier::Missing => {
                    if sparse_graph_enabled {
                        48
                    } else {
                        52
                    }
                }
            },
            mixing_multiplier: match embedding_tier {
                EmbeddingSignalTier::Strong => {
                    if sparse_graph_enabled {
                        1.045
                    } else {
                        1.055
                    }
                }
                EmbeddingSignalTier::Weak => 1.0,
                EmbeddingSignalTier::Missing => 0.95,
            },
        },
        ("sparse", FALLBACK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: match embedding_tier {
                EmbeddingSignalTier::Strong => {
                    if sparse_graph_enabled {
                        24
                    } else {
                        32
                    }
                }
                EmbeddingSignalTier::Weak => {
                    if sparse_graph_enabled {
                        44
                    } else {
                        52
                    }
                }
                EmbeddingSignalTier::Missing => {
                    if sparse_graph_enabled {
                        68
                    } else {
                        80
                    }
                }
            },
            mixing_multiplier: match embedding_tier {
                EmbeddingSignalTier::Strong => {
                    if sparse_graph_enabled {
                        0.94
                    } else {
                        0.97
                    }
                }
                EmbeddingSignalTier::Weak => {
                    if sparse_graph_enabled {
                        0.99
                    } else {
                        1.0
                    }
                }
                EmbeddingSignalTier::Missing => {
                    if sparse_graph_enabled {
                        1.02
                    } else {
                        1.04
                    }
                }
            },
        },
        ("warm", IN_NETWORK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: 120,
            mixing_multiplier: 1.03,
        },
        ("warm", SOCIAL_EXPANSION_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: if social_momentum >= 0.03 { 76 } else { 64 },
            mixing_multiplier: 1.02 + social_momentum,
        },
        ("warm", INTEREST_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: match embedding_tier {
                EmbeddingSignalTier::Strong => 96,
                EmbeddingSignalTier::Weak => 64,
                EmbeddingSignalTier::Missing => 36,
            },
            mixing_multiplier: match embedding_tier {
                EmbeddingSignalTier::Strong => 1.01,
                EmbeddingSignalTier::Weak => 0.97,
                EmbeddingSignalTier::Missing => 0.93,
            },
        },
        ("warm", FALLBACK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: match embedding_tier {
                EmbeddingSignalTier::Strong => 36,
                EmbeddingSignalTier::Weak => 48,
                EmbeddingSignalTier::Missing => 68,
            },
            mixing_multiplier: match embedding_tier {
                EmbeddingSignalTier::Strong => 0.97,
                EmbeddingSignalTier::Weak => 1.0,
                EmbeddingSignalTier::Missing => 1.02,
            },
        },
        ("heavy", IN_NETWORK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: 150,
            mixing_multiplier: 1.06,
        },
        ("heavy", SOCIAL_EXPANSION_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: if social_momentum >= 0.03 { 104 } else { 92 },
            mixing_multiplier: 1.04 + social_momentum,
        },
        ("heavy", INTEREST_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: match embedding_tier {
                EmbeddingSignalTier::Strong => 104,
                EmbeddingSignalTier::Weak => 64,
                EmbeddingSignalTier::Missing => 36,
            },
            mixing_multiplier: match embedding_tier {
                EmbeddingSignalTier::Strong => 1.01,
                EmbeddingSignalTier::Weak => 0.94,
                EmbeddingSignalTier::Missing => 0.9,
            },
        },
        ("heavy", FALLBACK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: match embedding_tier {
                EmbeddingSignalTier::Strong => 22,
                EmbeddingSignalTier::Weak => 36,
                EmbeddingSignalTier::Missing => 64,
            },
            mixing_multiplier: match embedding_tier {
                EmbeddingSignalTier::Strong => 0.92,
                EmbeddingSignalTier::Weak => 0.98,
                EmbeddingSignalTier::Missing => 1.03,
            },
        },
        (_, FALLBACK_LANE) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: 48,
            mixing_multiplier: 1.0,
        },
        (_, _) => RetrievalLanePolicy {
            enabled: true,
            candidate_budget: query.limit.max(available_min_budget(query)),
            mixing_multiplier: 1.0,
        },
    }
}

fn available_min_budget(query: &RecommendationQueryPayload) -> usize {
    query.limit.max(24)
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

fn embedding_signal_tier(query: &RecommendationQueryPayload) -> EmbeddingSignalTier {
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

fn parse_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::String(value) => match value.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => None,
        },
        Value::Number(value) => value.as_i64().map(|value| value != 0),
        _ => None,
    }
}

fn parse_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.parse::<f64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::Value;

    use crate::contracts::{
        EmbeddingContextPayload, ExperimentAssignmentPayload, ExperimentContextPayload,
        RecommendationQueryPayload, SparseEmbeddingEntryPayload, UserStateContextPayload,
    };

    use super::{
        FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE,
        source_candidate_budget, source_enabled_for_query, source_retrieval_lane,
    };

    fn query(state: &str) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-source-policy".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: state.to_string(),
                reason: "test".to_string(),
                followed_count: 0,
                recent_action_count: 0,
                recent_positive_action_count: 0,
                usable_embedding: state != "cold_start",
                account_age_days: Some(1),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        }
    }

    #[test]
    fn source_policy_restricts_cold_start_to_bootstrap_lanes() {
        let query = query("cold_start");
        assert!(source_enabled_for_query(&query, "ColdStartSource"));
        assert!(!source_enabled_for_query(&query, "GraphSource"));
        assert!(!source_enabled_for_query(&query, "EmbeddingAuthorSource"));
        assert_eq!(source_candidate_budget(&query, "ColdStartSource", 100), 96);
    }

    #[test]
    fn source_policy_disables_popular_before_user_state_is_known() {
        let mut query = query("warm");
        query.user_state_context = None;

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
    }

    #[test]
    fn source_policy_skips_popular_for_dense_heavy_users() {
        let mut query = query("heavy");
        query.user_state_context = Some(UserStateContextPayload {
            state: "heavy".to_string(),
            reason: "dense_recent_activity".to_string(),
            followed_count: 24,
            recent_action_count: 100,
            recent_positive_action_count: 30,
            usable_embedding: true,
            account_age_days: Some(16),
        });

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
        assert!(source_enabled_for_query(&query, "GraphSource"));
    }

    #[test]
    fn source_policy_skips_popular_for_warm_users_with_social_evidence() {
        let mut query = query("warm");
        query.user_state_context = Some(UserStateContextPayload {
            state: "warm".to_string(),
            reason: "stable_but_not_dense".to_string(),
            followed_count: 24,
            recent_action_count: 50,
            recent_positive_action_count: 29,
            usable_embedding: true,
            account_age_days: Some(17),
        });

        assert!(!source_enabled_for_query(&query, "PopularSource"));
        assert_eq!(source_candidate_budget(&query, "PopularSource", 100), 0);
        assert!(source_enabled_for_query(&query, "GraphSource"));
    }

    #[test]
    fn maps_sources_into_stable_retrieval_lanes() {
        assert_eq!(source_retrieval_lane("FollowingSource"), IN_NETWORK_LANE);
        assert_eq!(source_retrieval_lane("GraphSource"), SOCIAL_EXPANSION_LANE);
        assert_eq!(
            source_retrieval_lane("GraphKernelSource"),
            SOCIAL_EXPANSION_LANE
        );
        assert_eq!(source_retrieval_lane("TwoTowerSource"), INTEREST_LANE);
        assert_eq!(
            source_retrieval_lane("EmbeddingAuthorSource"),
            INTEREST_LANE
        );
        assert_eq!(source_retrieval_lane("NewsAnnSource"), INTEREST_LANE);
        assert_eq!(source_retrieval_lane("PopularSource"), FALLBACK_LANE);
    }

    #[test]
    fn source_budget_honors_experiment_override() {
        let mut query = query("heavy");
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 7,
                score: 0.9,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.8),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(false),
        });
        query.experiment_context = Some(ExperimentContextPayload {
            user_id: "viewer-1".to_string(),
            assignments: vec![ExperimentAssignmentPayload {
                experiment_id: "space_feed_recsys".to_string(),
                experiment_name: "space feed".to_string(),
                bucket: "treatment".to_string(),
                config: HashMap::from([("source_budget_graphsource".to_string(), Value::from(12))]),
                in_experiment: true,
            }],
        });

        assert!(source_enabled_for_query(&query, "GraphSource"));
        assert_eq!(source_candidate_budget(&query, "GraphSource", 50), 12);
    }

    #[test]
    fn sparse_users_with_positive_actions_unlock_graph_expansion_lane() {
        let mut query = query("sparse");
        query.user_state_context = Some(UserStateContextPayload {
            state: "sparse".to_string(),
            reason: "light_positive_activity".to_string(),
            followed_count: 3,
            recent_action_count: 9,
            recent_positive_action_count: 5,
            usable_embedding: true,
            account_age_days: Some(6),
        });
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 11,
                score: 0.72,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.74),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(false),
        });

        assert!(source_enabled_for_query(&query, "GraphSource"));
        assert!(source_candidate_budget(&query, "GraphSource", 100) >= 40);
    }

    #[test]
    fn weak_embedding_disables_embedding_author_and_expands_fallback_budget() {
        let mut query = query("warm");
        query.embedding_context = Some(EmbeddingContextPayload {
            interested_in_clusters: vec![SparseEmbeddingEntryPayload {
                cluster_id: 11,
                score: 0.7,
            }],
            producer_embedding: vec![],
            known_for_cluster: None,
            known_for_score: None,
            quality_score: Some(0.2),
            computed_at: None,
            version: None,
            usable: true,
            stale: Some(true),
        });

        assert!(!source_enabled_for_query(&query, "EmbeddingAuthorSource"));
        assert!(source_candidate_budget(&query, "PopularSource", 100) >= 48);
        assert!(source_candidate_budget(&query, "TwoTowerSource", 100) >= 36);
    }
}
