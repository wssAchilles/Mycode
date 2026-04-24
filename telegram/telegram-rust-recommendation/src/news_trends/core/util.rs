use chrono::{TimeZone, Utc};

pub fn stable_hash_u64(input: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub fn stable_numeric_cluster_id(key: &str) -> i64 {
    9_000_000 + (stable_hash_u64(key) % 900_000) as i64
}

pub fn slug_from_display_name(display_name: &str) -> String {
    let mut slug = String::new();
    let mut previous_sep = false;
    for c in display_name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
            previous_sep = false;
        } else if !previous_sep && !slug.is_empty() {
            slug.push('_');
            previous_sep = true;
        }
    }
    slug.trim_matches('_').to_string()
}

pub fn iso_from_ms(ms: i64) -> Option<String> {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|date_time| date_time.to_rfc3339())
}

pub fn bounded_limit(limit: usize) -> usize {
    limit.clamp(1, 50)
}
