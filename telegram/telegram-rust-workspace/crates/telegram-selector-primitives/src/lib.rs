use std::collections::HashMap;

pub const SELECTOR_POLICY_VERSION: &str = "rust_top_k_selector_policy_v1";
pub const SELECTOR_AUDIT_VERSION: &str = "selector_lane_source_pool_audit_v1";
pub const SELECTOR_CONSTRAINT_VERSION: &str = "constraint_verdict_v1";
pub const SELECTOR_SCORE_SOURCE_VERSION: &str = "selector_final_score_source_v1";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectorPolicySnapshot {
    pub target_size: usize,
    pub window_factor: usize,
    pub lane_floors: HashMap<String, usize>,
    pub lane_ceilings: HashMap<String, usize>,
    pub max_oon_count: usize,
    pub trend_ceiling: usize,
    pub news_ceiling: usize,
    pub exploration_floor: usize,
    pub lane_order: Vec<String>,
    pub author_soft_cap: usize,
    pub topic_soft_cap: usize,
    pub source_soft_cap: usize,
    pub domain_soft_cap: usize,
    pub media_soft_cap: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectorSelectionReport {
    pub target_size: usize,
    pub window_size: usize,
    pub selected_count: usize,
    pub first_blocking_reason: Option<String>,
    pub deferred_reason_counts: HashMap<String, usize>,
    pub policy_snapshot: Option<SelectorPolicySnapshot>,
}

#[derive(Debug, Clone, Copy)]
pub struct SelectionLimits {
    pub author_soft_cap: usize,
    pub topic_soft_cap: usize,
    pub source_soft_cap: usize,
    pub domain_soft_cap: usize,
    pub media_soft_cap: usize,
    pub enforce_constraints: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConstraintVerdict {
    pub pass: bool,
    pub reason: &'static str,
    pub relaxable: bool,
    pub priority: u8,
}

impl ConstraintVerdict {
    pub const fn pass() -> Self {
        Self {
            pass: true,
            reason: "pass",
            relaxable: false,
            priority: 0,
        }
    }

    pub const fn block(reason: &'static str, relaxable: bool, priority: u8) -> Self {
        Self {
            pass: false,
            reason,
            relaxable,
            priority,
        }
    }
}

pub fn selector_target_size(limit: usize, oversample_factor: usize, max_size: usize) -> usize {
    let base = limit.max(1);
    let oversampled = base.saturating_mul(oversample_factor.max(1));
    oversampled.min(max_size.max(1))
}

pub fn first_blocking_reason(reason_counts: &HashMap<String, usize>) -> Option<String> {
    reason_counts
        .iter()
        .max_by(|(left_reason, left_count), (right_reason, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_reason.cmp(left_reason))
        })
        .map(|(reason, _)| reason.clone())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        ConstraintVerdict, SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION,
        SELECTOR_POLICY_VERSION, SELECTOR_SCORE_SOURCE_VERSION, first_blocking_reason,
        selector_target_size,
    };

    #[test]
    fn selector_target_size_uses_limit_oversample_and_maximum() {
        assert_eq!(selector_target_size(20, 5, 60), 60);
        assert_eq!(selector_target_size(8, 3, 60), 24);
        assert_eq!(selector_target_size(0, 0, 0), 1);
    }

    #[test]
    fn first_blocking_reason_uses_count_then_lexicographic_tie_break() {
        let reason_counts = HashMap::from([
            ("topic_soft_cap".to_string(), 2),
            ("author_soft_cap".to_string(), 2),
            ("source_soft_cap".to_string(), 1),
        ]);

        assert_eq!(
            first_blocking_reason(&reason_counts).as_deref(),
            Some("author_soft_cap")
        );
    }

    #[test]
    fn constraint_verdict_preserves_machine_readable_reason() {
        let verdict = ConstraintVerdict::block("author_soft_cap", true, 80);

        assert!(!verdict.pass);
        assert_eq!(verdict.reason, "author_soft_cap");
        assert!(verdict.relaxable);
        assert_eq!(verdict.priority, 80);
        assert!(ConstraintVerdict::pass().pass);
    }

    #[test]
    fn exports_stable_selector_contract_versions() {
        assert_eq!(SELECTOR_POLICY_VERSION, "rust_top_k_selector_policy_v1");
        assert_eq!(SELECTOR_AUDIT_VERSION, "selector_lane_source_pool_audit_v1");
        assert_eq!(SELECTOR_CONSTRAINT_VERSION, "constraint_verdict_v1");
        assert_eq!(
            SELECTOR_SCORE_SOURCE_VERSION,
            "selector_final_score_source_v1"
        );
    }
}
