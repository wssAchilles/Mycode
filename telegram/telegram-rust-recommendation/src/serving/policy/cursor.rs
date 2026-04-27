use chrono::{DateTime, Utc};
use serde_json::{Map, Value};

pub(super) fn normalize_cursor(map: &mut Map<String, Value>, key: &str) {
    let Some(Value::String(value)) = map.get_mut(key) else {
        return;
    };

    let trimmed = value.trim();
    if trimmed.is_empty() {
        *value = String::new();
        return;
    }

    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        *value = parsed
            .with_timezone(&Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    } else {
        *value = trimmed.to_string();
    }
}
