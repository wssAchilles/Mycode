use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

const DEFAULT_SPACE_FEED_EXPERIMENT_ID: &str = "space_feed_recsys";

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
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");

    let policy = match state {
        "cold_start" => HashMap::from([
            ("FollowingSource", 1.01),
            ("ColdStartSource", 1.05),
            ("PopularSource", 0.92),
            ("GraphSource", 0.88),
            ("TwoTowerSource", 0.90),
            ("EmbeddingAuthorSource", 0.88),
            ("NewsAnnSource", 0.97),
        ]),
        "sparse" => HashMap::from([
            ("FollowingSource", 1.02),
            ("ColdStartSource", 0.96),
            ("PopularSource", 1.02),
            ("GraphSource", 0.95),
            ("TwoTowerSource", 1.04),
            ("EmbeddingAuthorSource", 0.99),
            ("NewsAnnSource", 1.01),
        ]),
        "warm" => HashMap::from([
            ("FollowingSource", 1.03),
            ("ColdStartSource", 0.95),
            ("PopularSource", 0.98),
            ("GraphSource", 1.02),
            ("TwoTowerSource", 1.01),
            ("EmbeddingAuthorSource", 1.02),
            ("NewsAnnSource", 1.0),
        ]),
        "heavy" => HashMap::from([
            ("FollowingSource", 1.03),
            ("ColdStartSource", 0.92),
            ("PopularSource", 0.96),
            ("GraphSource", 1.04),
            ("TwoTowerSource", 1.03),
            ("EmbeddingAuthorSource", 1.05),
            ("NewsAnnSource", 0.99),
        ]),
        _ => return 1.0,
    };

    policy.get(source_name).copied().unwrap_or(1.0)
}

pub fn source_candidate_budget(
    query: &RecommendationQueryPayload,
    source_name: &str,
    available_count: usize,
) -> usize {
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");

    let fallback_budget = available_count.max(query.limit);
    let policy_budget = match state {
        "cold_start" => match source_name {
            "ColdStartSource" => Some(60),
            "NewsAnnSource" => Some(24),
            _ => None,
        },
        "sparse" => match source_name {
            "FollowingSource" => Some(80),
            "PopularSource" => Some(48),
            "TwoTowerSource" => Some(40),
            "EmbeddingAuthorSource" => Some(36),
            "NewsAnnSource" => Some(28),
            _ => None,
        },
        "warm" => match source_name {
            "FollowingSource" => Some(120),
            "GraphSource" => Some(64),
            "PopularSource" => Some(36),
            "TwoTowerSource" => Some(40),
            "EmbeddingAuthorSource" => Some(48),
            "NewsAnnSource" => Some(24),
            _ => None,
        },
        "heavy" => match source_name {
            "FollowingSource" => Some(140),
            "GraphSource" => Some(80),
            "PopularSource" => Some(28),
            "TwoTowerSource" => Some(48),
            "EmbeddingAuthorSource" => Some(56),
            "NewsAnnSource" => Some(20),
            _ => None,
        },
        _ => None,
    }
    .unwrap_or(fallback_budget);

    let experiment_budget = space_feed_experiment_number(
        query,
        &format!("source_budget_{}", source_name.to_lowercase()),
        policy_budget as f64,
    )
    .max(1.0) as usize;

    available_count.min(experiment_budget)
}

pub fn source_enabled_for_query(query: &RecommendationQueryPayload, source_name: &str) -> bool {
    let state = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.as_str())
        .unwrap_or("");

    let enabled = match state {
        "cold_start" => HashSet::from(["ColdStartSource"]),
        "sparse" => HashSet::from([
            "FollowingSource",
            "PopularSource",
            "TwoTowerSource",
            "EmbeddingAuthorSource",
            "NewsAnnSource",
        ]),
        "warm" | "heavy" => HashSet::from([
            "FollowingSource",
            "PopularSource",
            "GraphSource",
            "TwoTowerSource",
            "EmbeddingAuthorSource",
            "NewsAnnSource",
        ]),
        _ => return true,
    };

    enabled.contains(source_name)
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
        ExperimentAssignmentPayload, ExperimentContextPayload, RecommendationQueryPayload,
        UserStateContextPayload,
    };

    use super::{source_candidate_budget, source_enabled_for_query};

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
        assert_eq!(source_candidate_budget(&query, "ColdStartSource", 100), 60);
    }

    #[test]
    fn source_budget_honors_experiment_override() {
        let mut query = query("heavy");
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
}
