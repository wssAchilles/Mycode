use std::collections::HashMap;

use crate::{
    SOURCE_STAGE_OUTCOME_DISABLED, SOURCE_STAGE_OUTCOME_FAILED, SOURCE_STAGE_OUTCOME_SUCCESS,
    SOURCE_STAGE_OUTCOME_SUCCESS_EMPTY,
};

pub const SOURCE_SUMMARY_TOTAL_CANDIDATES_FIELD: &str = "totalCandidates";
pub const SOURCE_SUMMARY_SOURCE_COUNTS_FIELD: &str = "sourceCounts";
pub const SOURCE_SUMMARY_SOURCE_OUTCOME_COUNTS_FIELD: &str = "sourceOutcomeCounts";
pub const SOURCE_SUMMARY_SOURCE_FAILURE_COUNTS_FIELD: &str = "sourceFailureCounts";
pub const SOURCE_SUMMARY_SOURCE_DISABLED_COUNTS_FIELD: &str = "sourceDisabledCounts";
pub const SOURCE_SUMMARY_LANE_COUNTS_FIELD: &str = "laneCounts";

pub struct SourceSummaryContractInput<'a> {
    pub total_candidates: usize,
    pub source_counts: &'a HashMap<String, usize>,
    pub source_outcome_counts: &'a HashMap<String, usize>,
    pub source_failure_counts: &'a HashMap<String, usize>,
    pub source_disabled_counts: &'a HashMap<String, usize>,
    pub lane_counts: &'a HashMap<String, usize>,
}

pub fn source_summary_contract_violations(input: SourceSummaryContractInput<'_>) -> Vec<String> {
    let mut violations = Vec::new();
    let source_count_total = input.source_counts.values().copied().sum::<usize>();
    let lane_count_total = input.lane_counts.values().copied().sum::<usize>();
    let outcome_total = input.source_outcome_counts.values().copied().sum::<usize>();
    let failure_total = input.source_failure_counts.values().copied().sum::<usize>();
    let disabled_total = input
        .source_disabled_counts
        .values()
        .copied()
        .sum::<usize>();

    for outcome in input.source_outcome_counts.keys() {
        if !SOURCE_STAGE_OUTCOMES.contains(&outcome.as_str()) {
            violations.push(format!("source_summary_unknown_outcome: outcome={outcome}"));
        }
    }

    if outcome_total != input.source_counts.len() {
        violations.push(format!(
            "source_summary_outcome_total_mismatch: outcomes={outcome_total} sources={}",
            input.source_counts.len()
        ));
    }
    if source_count_total < input.total_candidates {
        violations.push(format!(
            "source_summary_source_total_less_than_output: sourceTotal={source_count_total} totalCandidates={}",
            input.total_candidates
        ));
    }
    if lane_count_total != input.total_candidates {
        violations.push(format!(
            "source_summary_lane_total_mismatch: laneTotal={lane_count_total} totalCandidates={}",
            input.total_candidates
        ));
    }
    if failure_total
        != input
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_FAILED)
            .copied()
            .unwrap_or_default()
    {
        violations.push(format!(
            "source_summary_failure_total_mismatch: failureCounts={failure_total} failedOutcomes={}",
            input
                .source_outcome_counts
                .get(SOURCE_STAGE_OUTCOME_FAILED)
                .copied()
                .unwrap_or_default()
        ));
    }
    if disabled_total
        != input
            .source_outcome_counts
            .get(SOURCE_STAGE_OUTCOME_DISABLED)
            .copied()
            .unwrap_or_default()
    {
        violations.push(format!(
            "source_summary_disabled_total_mismatch: disabledCounts={disabled_total} disabledOutcomes={}",
            input
                .source_outcome_counts
                .get(SOURCE_STAGE_OUTCOME_DISABLED)
                .copied()
                .unwrap_or_default()
        ));
    }

    violations
}

const SOURCE_STAGE_OUTCOMES: &[&str] = &[
    SOURCE_STAGE_OUTCOME_SUCCESS,
    SOURCE_STAGE_OUTCOME_SUCCESS_EMPTY,
    SOURCE_STAGE_OUTCOME_FAILED,
    SOURCE_STAGE_OUTCOME_DISABLED,
];

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        SOURCE_SUMMARY_LANE_COUNTS_FIELD, SOURCE_SUMMARY_SOURCE_COUNTS_FIELD,
        SOURCE_SUMMARY_SOURCE_DISABLED_COUNTS_FIELD, SOURCE_SUMMARY_SOURCE_FAILURE_COUNTS_FIELD,
        SOURCE_SUMMARY_SOURCE_OUTCOME_COUNTS_FIELD, SOURCE_SUMMARY_TOTAL_CANDIDATES_FIELD,
        SourceSummaryContractInput, source_summary_contract_violations,
    };
    use crate::{SOURCE_STAGE_OUTCOME_FAILED, SOURCE_STAGE_OUTCOME_SUCCESS};

    #[test]
    fn exports_source_summary_contract_fields() {
        assert_eq!(SOURCE_SUMMARY_TOTAL_CANDIDATES_FIELD, "totalCandidates");
        assert_eq!(SOURCE_SUMMARY_SOURCE_COUNTS_FIELD, "sourceCounts");
        assert_eq!(
            SOURCE_SUMMARY_SOURCE_OUTCOME_COUNTS_FIELD,
            "sourceOutcomeCounts"
        );
        assert_eq!(
            SOURCE_SUMMARY_SOURCE_FAILURE_COUNTS_FIELD,
            "sourceFailureCounts"
        );
        assert_eq!(
            SOURCE_SUMMARY_SOURCE_DISABLED_COUNTS_FIELD,
            "sourceDisabledCounts"
        );
        assert_eq!(SOURCE_SUMMARY_LANE_COUNTS_FIELD, "laneCounts");
    }

    #[test]
    fn validates_source_summary_output_invariants() {
        let source_counts = HashMap::from([
            ("FollowingSource".to_string(), 2),
            ("PopularSource".to_string(), 0),
        ]);
        let source_outcome_counts = HashMap::from([
            (SOURCE_STAGE_OUTCOME_SUCCESS.to_string(), 1),
            (SOURCE_STAGE_OUTCOME_FAILED.to_string(), 1),
        ]);
        let source_failure_counts = HashMap::from([("PopularSource".to_string(), 1)]);
        let lane_counts = HashMap::from([("in_network".to_string(), 2)]);

        assert!(
            source_summary_contract_violations(SourceSummaryContractInput {
                total_candidates: 2,
                source_counts: &source_counts,
                source_outcome_counts: &source_outcome_counts,
                source_failure_counts: &source_failure_counts,
                source_disabled_counts: &HashMap::new(),
                lane_counts: &lane_counts,
            })
            .is_empty()
        );
    }

    #[test]
    fn reports_source_summary_output_drift() {
        let source_counts = HashMap::from([("FollowingSource".to_string(), 0)]);
        let source_outcome_counts = HashMap::from([("unknown".to_string(), 1)]);

        let violations = source_summary_contract_violations(SourceSummaryContractInput {
            total_candidates: 2,
            source_counts: &source_counts,
            source_outcome_counts: &source_outcome_counts,
            source_failure_counts: &HashMap::new(),
            source_disabled_counts: &HashMap::new(),
            lane_counts: &HashMap::new(),
        });

        assert!(
            violations
                .iter()
                .any(|violation| violation.starts_with("source_summary_unknown_outcome"))
        );
        assert!(violations.iter().any(|violation| {
            violation.starts_with("source_summary_source_total_less_than_output")
        }));
        assert!(
            violations
                .iter()
                .any(|violation| violation.starts_with("source_summary_lane_total_mismatch"))
        );
    }
}
