use chrono::{DateTime, Utc};

use crate::contracts::RecommendationCandidatePayload;

pub const SERVING_VERSION: &str = "rust_serving_v1";
pub const CURSOR_MODE: &str = "created_at_desc_v1";
pub const SERVED_STATE_VERSION: &str = "related_ids_v1";

pub fn build_next_cursor(candidates: &[RecommendationCandidatePayload]) -> Option<DateTime<Utc>> {
    candidates.last().map(|candidate| candidate.created_at)
}
