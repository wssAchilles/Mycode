use serde_json::Value;

use crate::contracts::RecommendationQueryPayload;

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
