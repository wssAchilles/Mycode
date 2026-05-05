use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use serde_json::{Map, Value};

use crate::contracts::RecommendationQueryPayload;

use super::cursor::normalize_cursor;

pub fn build_query_fingerprint(query: &RecommendationQueryPayload) -> String {
    let mut payload = serde_json::to_value(query).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut payload {
        map.remove("requestId");
        normalize_string_array(map, "seenIds");
        normalize_string_array(map, "servedIds");
        normalize_case(map, "countryCode", |value| value.to_ascii_uppercase());
        normalize_case(map, "languageCode", |value| value.to_ascii_lowercase());
        normalize_cursor(map, "cursor");
    }

    let mut hasher = DefaultHasher::new();
    hash_json_value(&payload, &mut hasher);
    format!("{:016x}", hasher.finish())
}

fn normalize_string_array(map: &mut Map<String, Value>, key: &str) {
    let Some(Value::Array(entries)) = map.get_mut(key) else {
        return;
    };

    let mut normalized = entries
        .iter()
        .filter_map(|entry| entry.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    normalized.sort_unstable();
    normalized.dedup();

    *entries = normalized.into_iter().map(Value::String).collect();
}

fn normalize_case<F>(map: &mut Map<String, Value>, key: &str, normalize: F)
where
    F: Fn(&str) -> String,
{
    let Some(Value::String(value)) = map.get_mut(key) else {
        return;
    };

    *value = normalize(value.trim());
}

fn hash_json_value(value: &Value, hasher: &mut DefaultHasher) {
    match value {
        Value::Null => {
            "null".hash(hasher);
        }
        Value::Bool(boolean) => {
            "bool".hash(hasher);
            boolean.hash(hasher);
        }
        Value::Number(number) => {
            "number".hash(hasher);
            number.to_string().hash(hasher);
        }
        Value::String(string) => {
            "string".hash(hasher);
            string.hash(hasher);
        }
        Value::Array(values) => {
            "array".hash(hasher);
            values.len().hash(hasher);
            for value in values {
                hash_json_value(value, hasher);
            }
        }
        Value::Object(entries) => {
            "object".hash(hasher);
            let mut keys = entries.keys().cloned().collect::<Vec<_>>();
            keys.sort_unstable();
            for key in keys {
                key.hash(hasher);
                if let Some(value) = entries.get(&key) {
                    hash_json_value(value, hasher);
                }
            }
        }
    }
}
