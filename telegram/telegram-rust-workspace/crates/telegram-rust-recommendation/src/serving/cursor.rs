use chrono::{DateTime, Utc};

use crate::contracts::RecommendationCandidatePayload;

pub use telegram_serving_primitives::{
    CURSOR_MODE, RANKED_CURSOR_ABSTENTION_MODE, SERVED_STATE_VERSION, SERVING_VERSION,
};

pub fn build_next_cursor(candidates: &[RecommendationCandidatePayload]) -> Option<DateTime<Utc>> {
    candidates.last().map(|candidate| candidate.created_at)
}

pub fn ranked_cursor_requires_abstention(in_network_only: bool, has_cursor: bool) -> bool {
    !in_network_only && has_cursor
}

#[cfg(test)]
mod tests {
    use super::ranked_cursor_requires_abstention;

    #[test]
    fn ranked_cursor_abstains_only_on_general_feed_continuations() {
        assert!(ranked_cursor_requires_abstention(false, true));
        assert!(!ranked_cursor_requires_abstention(false, false));
        assert!(!ranked_cursor_requires_abstention(true, true));
    }
}
