//! 64-bit 跨语言数值安全反序列化工具。
//!
//! 兼容 JavaScript `Number` 浮点进位（如靠近 `u64::MAX` 时舍入为 `18446744073709552000`）、
//! 十进制/十六进制字符串以及有符号/无符号 64-bit 哈希位模式互转，彻底防止 `422` 溢出报错。

use std::fmt;

use serde::de::{self, Deserializer, SeqAccess, Visitor};

/// 安全将 `f64` 钳制转换为 `u64`（非有限值或负数归零，超出上限饱和截断至 `u64::MAX`）。
fn clamp_f64_to_u64(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    if value >= u64::MAX as f64 {
        return u64::MAX;
    }
    value.trunc() as u64
}

/// 安全将 `f64` 钳制转换为 `i64`（非有限值归零，超出范围饱和截断至 `i64::MIN..=i64::MAX`）。
fn clamp_f64_to_i64(value: f64) -> i64 {
    if !value.is_finite() {
        return 0;
    }
    if value >= i64::MAX as f64 {
        return i64::MAX;
    }
    if value <= i64::MIN as f64 {
        return i64::MIN;
    }
    value.trunc() as i64
}

/// 解析字符串形式的 64-bit 无符号槽位值（兼容十进制、有符号整数位模式、`0x` 十六进制与浮点科学计数法）。
fn parse_str_to_u64<E: de::Error>(raw: &str) -> Result<u64, E> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16).map_err(E::custom);
    }
    if let Ok(unsigned) = trimmed.parse::<u64>() {
        return Ok(unsigned);
    }
    if let Ok(signed) = trimmed.parse::<i64>() {
        return Ok(signed as u64);
    }
    if let Ok(float_val) = trimmed.parse::<f64>() {
        return Ok(clamp_f64_to_u64(float_val));
    }
    Err(E::custom(format!("invalid 64-bit unsigned value: {raw}")))
}

/// 解析字符串形式的 64-bit 有符号哈希值（兼容有符号/无符号十进制、`0x` 十六进制与浮点科学计数法）。
fn parse_str_to_i64<E: de::Error>(raw: &str) -> Result<i64, E> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16)
            .map(|v| v as i64)
            .map_err(E::custom);
    }
    if let Ok(signed) = trimmed.parse::<i64>() {
        return Ok(signed);
    }
    if let Ok(unsigned) = trimmed.parse::<u64>() {
        return Ok(unsigned as i64);
    }
    if let Ok(float_val) = trimmed.parse::<f64>() {
        return Ok(clamp_f64_to_i64(float_val));
    }
    Err(E::custom(format!(
        "invalid 64-bit signed hash value: {raw}"
    )))
}

struct FlexibleU64Element;

impl<'de> serde::Deserialize<'de> for FlexibleU64Element {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserialize_flexible_u64(deserializer)
            .map(FlexibleU64Wrapper)
            .map(|w| {
                let _ = w;
                Self
            })
    }
}

struct FlexibleU64Wrapper(u64);

impl<'de> serde::Deserialize<'de> for FlexibleU64Wrapper {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserialize_flexible_u64(deserializer).map(Self)
    }
}

/// 反序列化单个兼容字符串、数字及浮点进位截断的 `u64`。
pub fn deserialize_flexible_u64<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    struct U64Visitor;

    impl Visitor<'_> for U64Visitor {
        type Value = u64;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a 64-bit integer or numeric string")
        }

        fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
            Ok(value)
        }

        fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
            Ok(value as u64)
        }

        fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
            Ok(clamp_f64_to_u64(value))
        }

        fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
            parse_str_to_u64(value)
        }

        fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
            parse_str_to_u64(&value)
        }
    }

    deserializer.deserialize_any(U64Visitor)
}

/// 反序列化兼容字符串、数字、`null` 及 JS 浮点进位截断的 `Vec<u64>`（用于布隆过滤器槽位数组）。
pub fn deserialize_flexible_u64_vec<'de, D>(deserializer: D) -> Result<Vec<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    struct U64VecVisitor;

    impl<'de> Visitor<'de> for U64VecVisitor {
        type Value = Vec<u64>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a sequence of 64-bit integers or numeric strings")
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut items = Vec::with_capacity(seq.size_hint().unwrap_or(0));
            while let Some(FlexibleU64Wrapper(value)) = seq.next_element()? {
                items.push(value);
            }
            Ok(items)
        }
    }

    let _ = FlexibleU64Element;
    deserializer.deserialize_any(U64VecVisitor)
}

/// 反序列化兼容字符串、无符号 64-bit 哈希及 JS 浮点进位截断的 `i64`（用于 `postIdHash` / `authorHash`）。
pub fn deserialize_flexible_i64<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    struct I64Visitor;

    impl Visitor<'_> for I64Visitor {
        type Value = i64;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a 64-bit signed/unsigned integer or numeric string")
        }

        fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
            Ok(value)
        }

        fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
            Ok(value as i64)
        }

        fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
            Ok(clamp_f64_to_i64(value))
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(0)
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(0)
        }

        fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
            parse_str_to_i64(value)
        }

        fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
            parse_str_to_i64(&value)
        }
    }

    deserializer.deserialize_any(I64Visitor)
}
