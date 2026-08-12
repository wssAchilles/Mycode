use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn canonical_json<T>(value: &T) -> Result<String, serde_json::Error>
where
    T: Serialize + ?Sized,
{
    serde_json::to_string(&canonical_value(serde_json::to_value(value)?))
}

pub fn canonical_wire_json<T>(value: &T) -> Result<String, serde_json::Error>
where
    T: Serialize + ?Sized,
{
    let first = serde_json::to_string(&canonical_wire_value(serde_json::to_value(value)?))?;
    let normalized: Value = serde_json::from_str(&first)?;
    serde_json::to_string(&canonical_wire_value(normalized))
}

pub fn canonical_ndjson_sha256<T>(values: &[T]) -> Result<String, serde_json::Error>
where
    T: Serialize,
{
    let mut hasher = Sha256::new();
    for value in values {
        hasher.update(canonical_json(value)?);
        hasher.update(b"\n");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn candidate_pool_sha256<T>(candidates: &[T]) -> Result<String, serde_json::Error>
where
    T: Serialize,
{
    canonical_ndjson_sha256(candidates)
}

pub fn sha256_hex(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}

fn canonical_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_value).collect()),
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_unstable_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonical_value(value)))
                    .collect(),
            )
        }
        Value::Number(value) => {
            let number = value
                .as_f64()
                .expect("JSON numbers are representable as f64");
            let bits = if number == 0.0 { 0 } else { number.to_bits() };
            serde_json::json!({ "$f64": format!("{bits:016x}") })
        }
        value => value,
    }
}

fn canonical_wire_value(value: Value) -> Value {
    match value {
        Value::Array(values) => {
            Value::Array(values.into_iter().map(canonical_wire_value).collect())
        }
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_unstable_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonical_wire_value(value)))
                    .collect(),
            )
        }
        value => value,
    }
}
