pub const SERVE_CACHE_POLICY_REASON_PENDING_EVALUATION: &str = "pending_evaluation";
pub const SERVE_CACHE_POLICY_REASON_FIRST_PAGE_STABLE: &str = "first_page_stable";
pub const SERVE_CACHE_POLICY_REASON_CURSOR_REPLAY_STABLE: &str = "cursor_replay_stable";
pub const SERVE_CACHE_POLICY_REASON_SERVED_STATE_REPLAY_STABLE: &str = "served_state_replay_stable";
pub const SERVE_CACHE_POLICY_REASON_BOUNDED_REPLAY_STABLE: &str = "bounded_replay_stable";

pub const SERVE_CACHE_POLICY_REASON_CACHE_DISABLED: &str = "cache_disabled";
pub const SERVE_CACHE_POLICY_REASON_EMPTY_RESULT: &str = "empty_result";
pub const SERVE_CACHE_POLICY_REASON_SELF_POST_RESCUE_APPLIED: &str = "self_post_rescue_applied";
pub const SERVE_CACHE_POLICY_REASON_TIMEOUT_DEGRADED: &str = "timeout_degraded";

#[cfg(test)]
mod tests {
    use super::{
        SERVE_CACHE_POLICY_REASON_CACHE_DISABLED, SERVE_CACHE_POLICY_REASON_CURSOR_REPLAY_STABLE,
        SERVE_CACHE_POLICY_REASON_FIRST_PAGE_STABLE, SERVE_CACHE_POLICY_REASON_TIMEOUT_DEGRADED,
    };

    #[test]
    fn exports_stable_serve_cache_policy_reasons() {
        assert_eq!(
            SERVE_CACHE_POLICY_REASON_FIRST_PAGE_STABLE,
            "first_page_stable"
        );
        assert_eq!(
            SERVE_CACHE_POLICY_REASON_CURSOR_REPLAY_STABLE,
            "cursor_replay_stable"
        );
        assert_eq!(SERVE_CACHE_POLICY_REASON_CACHE_DISABLED, "cache_disabled");
        assert_eq!(
            SERVE_CACHE_POLICY_REASON_TIMEOUT_DEGRADED,
            "timeout_degraded"
        );
    }
}
