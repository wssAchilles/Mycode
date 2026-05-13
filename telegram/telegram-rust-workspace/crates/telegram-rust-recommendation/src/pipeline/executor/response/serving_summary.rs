use std::collections::HashMap;

use chrono::{DateTime, Utc};
use telegram_serving_primitives::SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION;

use crate::contracts::RecommendationServingSummaryPayload;
use crate::serving::cursor::{CURSOR_MODE, SERVED_STATE_VERSION, SERVING_VERSION};
use crate::serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE};

pub(super) struct LiveServingSummaryInput {
    pub(super) cursor: Option<DateTime<Utc>>,
    pub(super) next_cursor: Option<DateTime<Utc>>,
    pub(super) has_more: bool,
    pub(super) stable_order_key: String,
    pub(super) duplicate_suppressed_count: usize,
    pub(super) cross_page_duplicate_count: usize,
    pub(super) suppression_reasons: HashMap<String, usize>,
    pub(super) page_remaining_count: usize,
    pub(super) page_underfilled: bool,
    pub(super) page_underfill_reason: Option<String>,
}

pub(super) fn build_live_serving_summary(
    input: LiveServingSummaryInput,
) -> RecommendationServingSummaryPayload {
    RecommendationServingSummaryPayload {
        serving_version: SERVING_VERSION.to_string(),
        cursor_mode: CURSOR_MODE.to_string(),
        cursor: input.cursor,
        next_cursor: input.next_cursor,
        has_more: input.has_more,
        served_state_version: SERVED_STATE_VERSION.to_string(),
        stable_order_key: input.stable_order_key,
        duplicate_suppressed_count: input.duplicate_suppressed_count,
        cross_page_duplicate_count: input.cross_page_duplicate_count,
        suppression_reasons: input.suppression_reasons,
        serve_cache_hit: false,
        stable_order_drifted: false,
        cache_key_mode: CACHE_KEY_MODE.to_string(),
        cache_policy: CACHE_POLICY_MODE.to_string(),
        cache_policy_reason: SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION.to_string(),
        page_remaining_count: input.page_remaining_count,
        page_underfilled: input.page_underfilled,
        page_underfill_reason: input.page_underfill_reason,
    }
}
