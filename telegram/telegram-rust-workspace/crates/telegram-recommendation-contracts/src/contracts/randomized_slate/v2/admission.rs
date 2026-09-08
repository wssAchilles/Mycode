use std::collections::HashSet;

use serde::de::{self, DeserializeSeed, Error as DeError, MapAccess, SeqAccess, Visitor};

use super::DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES;

pub const DEVELOPMENT_V2_MAX_JSON_DEPTH: usize = 64;
pub const DEVELOPMENT_V2_MAX_JSON_OBJECT_ENTRIES: usize = 1024;
pub const DEVELOPMENT_V2_MAX_JSON_ARRAY_ITEMS: usize = 4096;
pub const DEVELOPMENT_V2_MAX_JSON_STRING_BYTES: usize = 1024 * 1024;
pub const DEVELOPMENT_V2_MAX_JSON_TOTAL_STRING_BYTES: usize = 8 * 1024 * 1024;
pub const DEVELOPMENT_V2_MAX_JSON_NODES: usize = 131_072;
const RESOURCE_LIMIT_MARKER: &str = "development_resource_limit:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevelopmentInputAdmissionErrorV1 {
    ResourceLimitExceeded,
    InvalidJson,
}

/// Rejects resource-shaped JSON before the typed input and nested `Value` are materialized.
pub fn admit_development_input_raw_v1(
    raw_input: &[u8],
) -> Result<(), DevelopmentInputAdmissionErrorV1> {
    if raw_input.len() > DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES {
        return Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded);
    }

    let mut deserializer = serde_json::Deserializer::from_slice(raw_input);
    let mut limits = JsonAdmissionLimits::default();
    JsonAdmissionSeed {
        limits: &mut limits,
        depth: 0,
    }
    .deserialize(&mut deserializer)
    .map_err(classify_json_error)?;
    deserializer
        .end()
        .map_err(|_| DevelopmentInputAdmissionErrorV1::InvalidJson)
}

fn classify_json_error(error: serde_json::Error) -> DevelopmentInputAdmissionErrorV1 {
    if error.to_string().contains(RESOURCE_LIMIT_MARKER) {
        DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded
    } else {
        DevelopmentInputAdmissionErrorV1::InvalidJson
    }
}

fn resource_limit_error<E: de::Error>(message: &str) -> E {
    E::custom(format_args!("{RESOURCE_LIMIT_MARKER}{message}"))
}

#[derive(Default)]
struct JsonAdmissionLimits {
    nodes: usize,
    total_string_bytes: usize,
}

impl JsonAdmissionLimits {
    fn enter_value<E: de::Error>(&mut self, depth: usize) -> Result<(), E> {
        if depth > DEVELOPMENT_V2_MAX_JSON_DEPTH {
            return Err(resource_limit_error(
                "JSON nesting depth exceeds development limit",
            ));
        }
        self.nodes = self
            .nodes
            .checked_add(1)
            .ok_or_else(|| resource_limit_error("JSON node count overflow"))?;
        if self.nodes > DEVELOPMENT_V2_MAX_JSON_NODES {
            return Err(resource_limit_error(
                "JSON node count exceeds development limit",
            ));
        }
        Ok(())
    }

    fn observe_string<E: de::Error>(&mut self, value: &str) -> Result<(), E> {
        if value.len() > DEVELOPMENT_V2_MAX_JSON_STRING_BYTES {
            return Err(resource_limit_error(
                "JSON string exceeds development limit",
            ));
        }
        self.total_string_bytes = self
            .total_string_bytes
            .checked_add(value.len())
            .ok_or_else(|| resource_limit_error("JSON string byte count overflow"))?;
        if self.total_string_bytes > DEVELOPMENT_V2_MAX_JSON_TOTAL_STRING_BYTES {
            return Err(resource_limit_error(
                "JSON total string bytes exceed development limit",
            ));
        }
        Ok(())
    }
}

struct JsonAdmissionSeed<'a> {
    limits: &'a mut JsonAdmissionLimits,
    depth: usize,
}

impl<'de, 'a> DeserializeSeed<'de> for JsonAdmissionSeed<'a> {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(JsonAdmissionVisitor {
            limits: self.limits,
            depth: self.depth,
        })
    }
}

struct JsonAdmissionVisitor<'a> {
    limits: &'a mut JsonAdmissionLimits,
    depth: usize,
}

impl<'de, 'a> Visitor<'de> for JsonAdmissionVisitor<'a> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a bounded JSON value")
    }

    fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.limits.enter_value(self.depth)
    }

    fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.limits.enter_value(self.depth)
    }

    fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.limits.enter_value(self.depth)
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.limits.enter_value(self.depth)
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.limits.enter_value(self.depth)?;
        self.limits.observe_string(value)
    }

    fn visit_borrowed_str<E>(self, value: &'de str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_str(value)
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_str(&value)
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_unit()
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.limits.enter_value(self.depth)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        self.limits.enter_value(self.depth)?;
        let child_depth = self
            .depth
            .checked_add(1)
            .ok_or_else(|| resource_limit_error("JSON nesting depth overflow"))?;
        let mut item_count = 0_usize;
        while sequence
            .next_element_seed(JsonAdmissionSeed {
                limits: self.limits,
                depth: child_depth,
            })?
            .is_some()
        {
            item_count = item_count
                .checked_add(1)
                .ok_or_else(|| resource_limit_error("JSON array item count overflow"))?;
            if item_count > DEVELOPMENT_V2_MAX_JSON_ARRAY_ITEMS {
                return Err(resource_limit_error(
                    "JSON array item count exceeds development limit",
                ));
            }
        }
        Ok(())
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        self.limits.enter_value(self.depth)?;
        let child_depth = self
            .depth
            .checked_add(1)
            .ok_or_else(|| resource_limit_error("JSON nesting depth overflow"))?;
        let mut keys = HashSet::<&'de str>::new();
        let mut member_count = 0_usize;
        while let Some(key) = map.next_key::<&'de str>()? {
            self.limits.observe_string(key)?;
            member_count = member_count
                .checked_add(1)
                .ok_or_else(|| resource_limit_error("JSON object member count overflow"))?;
            if member_count > DEVELOPMENT_V2_MAX_JSON_OBJECT_ENTRIES {
                return Err(resource_limit_error(
                    "JSON object member count exceeds development limit",
                ));
            }
            if !keys.insert(key) {
                return Err(A::Error::custom("duplicate JSON object key"));
            }
            map.next_value_seed(JsonAdmissionSeed {
                limits: self.limits,
                depth: child_depth,
            })?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_keys_and_trailing_values() {
        assert_eq!(
            admit_development_input_raw_v1(br#"{"key":1,"key":2}"#),
            Err(DevelopmentInputAdmissionErrorV1::InvalidJson)
        );
        assert_eq!(
            admit_development_input_raw_v1(br#"{} {}"#),
            Err(DevelopmentInputAdmissionErrorV1::InvalidJson)
        );
    }

    #[test]
    fn rejects_depth_collection_and_node_overflow() {
        let mut deep = "[".repeat(DEVELOPMENT_V2_MAX_JSON_DEPTH + 1);
        deep.push('0');
        deep.push_str(&"]".repeat(DEVELOPMENT_V2_MAX_JSON_DEPTH + 1));
        assert_eq!(
            admit_development_input_raw_v1(deep.as_bytes()),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );

        let wide = format!(
            "[{}]",
            vec!["0"; DEVELOPMENT_V2_MAX_JSON_ARRAY_ITEMS + 1].join(",")
        );
        assert_eq!(
            admit_development_input_raw_v1(wide.as_bytes()),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );

        let object = format!(
            "{{{}}}",
            (0..=DEVELOPMENT_V2_MAX_JSON_OBJECT_ENTRIES)
                .map(|index| format!("\"key{index}\":0"))
                .collect::<Vec<_>>()
                .join(",")
        );
        assert_eq!(
            admit_development_input_raw_v1(object.as_bytes()),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );

        let nested = format!("[{}]", vec!["0"; 32].join(","));
        let nodes = format!(
            "[{}]",
            vec![nested.as_str(); DEVELOPMENT_V2_MAX_JSON_ARRAY_ITEMS].join(",")
        );
        assert!(nodes.len() < DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES);
        assert_eq!(
            admit_development_input_raw_v1(nodes.as_bytes()),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );
    }

    #[test]
    fn rejects_string_and_raw_byte_overflow() {
        let value = format!(
            "\"{}\"",
            "x".repeat(DEVELOPMENT_V2_MAX_JSON_STRING_BYTES + 1)
        );
        assert_eq!(
            admit_development_input_raw_v1(value.as_bytes()),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );

        let key = format!(
            "{{\"{}\":0}}",
            "k".repeat(DEVELOPMENT_V2_MAX_JSON_STRING_BYTES + 1)
        );
        assert_eq!(
            admit_development_input_raw_v1(key.as_bytes()),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );

        let mut raw = vec![b' '; DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES];
        raw[..4].copy_from_slice(b"null");
        admit_development_input_raw_v1(&raw).unwrap();
        raw.push(b' ');
        assert_eq!(
            admit_development_input_raw_v1(&raw),
            Err(DevelopmentInputAdmissionErrorV1::ResourceLimitExceeded)
        );
    }
}
