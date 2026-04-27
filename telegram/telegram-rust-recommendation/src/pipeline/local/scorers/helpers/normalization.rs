use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use super::super::{NEGATIVE_SCORES_OFFSET, NEGATIVE_WEIGHT_SUM, POSITIVE_WEIGHT_SUM};

pub(in crate::pipeline::local::scorers) fn normalize_weighted_score(raw_score: f64) -> f64 {
    if raw_score < 0.0 {
        (((raw_score + NEGATIVE_WEIGHT_SUM) / POSITIVE_WEIGHT_SUM) * NEGATIVE_SCORES_OFFSET)
            .max(0.0)
    } else {
        raw_score / POSITIVE_WEIGHT_SUM + NEGATIVE_SCORES_OFFSET
    }
}

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
    value.max(0.0).min(1.0)
}
