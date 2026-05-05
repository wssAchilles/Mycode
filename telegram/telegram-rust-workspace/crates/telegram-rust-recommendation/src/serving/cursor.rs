use chrono::{DateTime, Utc};

use crate::contracts::RecommendationCandidatePayload;

pub use telegram_serving_primitives::{CURSOR_MODE, SERVED_STATE_VERSION, SERVING_VERSION};

pub fn build_next_cursor(candidates: &[RecommendationCandidatePayload]) -> Option<DateTime<Utc>> {
    candidates.last().map(|candidate| candidate.created_at)
}
