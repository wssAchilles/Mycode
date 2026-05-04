pub const SELF_POST_RESCUE_STAGE_NAME: &str = "SelfPostRescueSource";
pub const SELF_POST_RESCUE_LATENCY_KEY: &str = "selfPostRescue";
pub const SELF_POST_RESCUE_PROVIDER_KEY: &str = "providers/self-posts";
pub const SELF_POST_RESCUE_PROVIDER_PATH: &str = "/providers/self-posts";
pub const SELF_POST_RESCUE_PROVIDER_NAME: &str = "node_self_post_rescue_provider";
pub const SELF_POST_RESCUE_MODE: &str = "selection_empty_fallback";

pub const SELF_POST_RESCUE_DETAIL_MODE_FIELD: &str = "rescueMode";
pub const SELF_POST_RESCUE_DETAIL_PROVIDER_FIELD: &str = "provider";
pub const SELF_POST_RESCUE_DETAIL_LOOKBACK_DAYS_FIELD: &str = "lookbackDays";

pub const SELF_POST_RESCUE_APPLIED_DEGRADED_REASON: &str = "selection:self_post_rescue_applied";
pub const SELF_POST_RESCUE_FAILED_DEGRADED_REASON: &str = "selection:self_post_rescue_failed";
pub const SELF_POST_RESCUE_POLICY_REASON_TOKEN: &str = "self_post_rescue";

#[cfg(test)]
mod tests {
    use super::{
        SELF_POST_RESCUE_APPLIED_DEGRADED_REASON, SELF_POST_RESCUE_LATENCY_KEY,
        SELF_POST_RESCUE_PROVIDER_KEY, SELF_POST_RESCUE_STAGE_NAME,
    };

    #[test]
    fn exports_stable_self_post_rescue_contract() {
        assert_eq!(SELF_POST_RESCUE_STAGE_NAME, "SelfPostRescueSource");
        assert_eq!(SELF_POST_RESCUE_LATENCY_KEY, "selfPostRescue");
        assert_eq!(SELF_POST_RESCUE_PROVIDER_KEY, "providers/self-posts");
        assert_eq!(
            SELF_POST_RESCUE_APPLIED_DEGRADED_REASON,
            "selection:self_post_rescue_applied"
        );
    }
}
