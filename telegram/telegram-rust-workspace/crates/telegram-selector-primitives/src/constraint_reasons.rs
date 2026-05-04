pub const CONSTRAINT_REASON_PASS: &str = "pass";
pub const CONSTRAINT_REASON_REQUIRED_LANE_MISMATCH: &str = "required_lane_mismatch";
pub const CONSTRAINT_REASON_AUTHOR_SOFT_CAP: &str = "author_soft_cap";
pub const CONSTRAINT_REASON_TREND_CEILING: &str = "trend_ceiling";
pub const CONSTRAINT_REASON_NEWS_CEILING: &str = "news_ceiling";
pub const CONSTRAINT_REASON_DOMAIN_SOFT_CAP: &str = "domain_soft_cap";
pub const CONSTRAINT_REASON_MEDIA_SOFT_CAP: &str = "media_soft_cap";
pub const CONSTRAINT_REASON_SOURCE_SOFT_CAP: &str = "source_soft_cap";
pub const CONSTRAINT_REASON_OON_CEILING: &str = "oon_ceiling";
pub const CONSTRAINT_REASON_LANE_CEILING: &str = "lane_ceiling";
pub const CONSTRAINT_REASON_TOPIC_SOFT_CAP: &str = "topic_soft_cap";

#[cfg(test)]
mod tests {
    use super::{
        CONSTRAINT_REASON_AUTHOR_SOFT_CAP, CONSTRAINT_REASON_LANE_CEILING, CONSTRAINT_REASON_PASS,
        CONSTRAINT_REASON_REQUIRED_LANE_MISMATCH, CONSTRAINT_REASON_TOPIC_SOFT_CAP,
    };

    #[test]
    fn exports_stable_constraint_reason_contract() {
        assert_eq!(CONSTRAINT_REASON_PASS, "pass");
        assert_eq!(
            CONSTRAINT_REASON_REQUIRED_LANE_MISMATCH,
            "required_lane_mismatch"
        );
        assert_eq!(CONSTRAINT_REASON_AUTHOR_SOFT_CAP, "author_soft_cap");
        assert_eq!(CONSTRAINT_REASON_LANE_CEILING, "lane_ceiling");
        assert_eq!(CONSTRAINT_REASON_TOPIC_SOFT_CAP, "topic_soft_cap");
    }
}
