use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub(in crate::pipeline::local::scorers) fn stable_unit_interval(
    request_id: &str,
    post_id: &str,
) -> f64 {
    let mut hasher = DefaultHasher::new();
    request_id.hash(&mut hasher);
    post_id.hash(&mut hasher);
    (hasher.finish() % 10_000) as f64 / 10_000.0
}

pub(in crate::pipeline::local::scorers) fn clamp01(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}
