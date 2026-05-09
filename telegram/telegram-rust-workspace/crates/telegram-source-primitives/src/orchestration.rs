use std::collections::HashMap;

use serde_json::Value;

pub const SOURCE_ORCHESTRATION_STAGE: &str = "source_parallel_lane_merge_v6";
pub const SOURCE_LANE_MERGE_STAGE_NAME: &str = "LaneMerge";

pub const SOURCE_MERGE_DETAIL_LANE_COUNTS_FIELD: &str = "laneCounts";
pub const SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD: &str = "duplicateRecallHits";
pub const SOURCE_MERGE_DETAIL_MULTI_SOURCE_CANDIDATES_FIELD: &str = "multiSourceCandidates";
pub const SOURCE_MERGE_DETAIL_SECONDARY_RECALL_EDGES_FIELD: &str = "secondaryRecallEdges";
pub const SOURCE_MERGE_DETAIL_CROSS_LANE_RECALL_EDGES_FIELD: &str = "crossLaneRecallEdges";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SourceMergeTelemetry {
    pub duplicate_recall_hits: usize,
    pub multi_source_candidates: usize,
    pub secondary_recall_edges: usize,
    pub cross_lane_recall_edges: usize,
}

pub fn source_merge_detail(
    lane_counts: &HashMap<String, usize>,
    telemetry: SourceMergeTelemetry,
) -> HashMap<String, Value> {
    HashMap::from([
        (
            SOURCE_MERGE_DETAIL_LANE_COUNTS_FIELD.to_string(),
            serde_json::to_value(lane_counts).unwrap_or(Value::Null),
        ),
        (
            SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD.to_string(),
            Value::from(telemetry.duplicate_recall_hits as u64),
        ),
        (
            SOURCE_MERGE_DETAIL_MULTI_SOURCE_CANDIDATES_FIELD.to_string(),
            Value::from(telemetry.multi_source_candidates as u64),
        ),
        (
            SOURCE_MERGE_DETAIL_SECONDARY_RECALL_EDGES_FIELD.to_string(),
            Value::from(telemetry.secondary_recall_edges as u64),
        ),
        (
            SOURCE_MERGE_DETAIL_CROSS_LANE_RECALL_EDGES_FIELD.to_string(),
            Value::from(telemetry.cross_lane_recall_edges as u64),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{
        SOURCE_LANE_MERGE_STAGE_NAME, SOURCE_MERGE_DETAIL_CROSS_LANE_RECALL_EDGES_FIELD,
        SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD, SOURCE_MERGE_DETAIL_LANE_COUNTS_FIELD,
        SOURCE_MERGE_DETAIL_MULTI_SOURCE_CANDIDATES_FIELD,
        SOURCE_MERGE_DETAIL_SECONDARY_RECALL_EDGES_FIELD, SOURCE_ORCHESTRATION_STAGE,
        SourceMergeTelemetry, source_merge_detail,
    };

    #[test]
    fn exports_stable_source_orchestration_contract() {
        assert_eq!(SOURCE_ORCHESTRATION_STAGE, "source_parallel_lane_merge_v6");
        assert_eq!(SOURCE_LANE_MERGE_STAGE_NAME, "LaneMerge");
        assert_eq!(SOURCE_MERGE_DETAIL_LANE_COUNTS_FIELD, "laneCounts");
        assert_eq!(
            SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD,
            "duplicateRecallHits"
        );
        assert_eq!(
            SOURCE_MERGE_DETAIL_MULTI_SOURCE_CANDIDATES_FIELD,
            "multiSourceCandidates"
        );
        assert_eq!(
            SOURCE_MERGE_DETAIL_SECONDARY_RECALL_EDGES_FIELD,
            "secondaryRecallEdges"
        );
        assert_eq!(
            SOURCE_MERGE_DETAIL_CROSS_LANE_RECALL_EDGES_FIELD,
            "crossLaneRecallEdges"
        );
    }

    #[test]
    fn builds_machine_readable_source_merge_detail() {
        let detail = source_merge_detail(
            &[("interest".to_string(), 2)].into_iter().collect(),
            SourceMergeTelemetry {
                duplicate_recall_hits: 1,
                multi_source_candidates: 1,
                secondary_recall_edges: 2,
                cross_lane_recall_edges: 1,
            },
        );

        assert_eq!(
            detail
                .get(SOURCE_MERGE_DETAIL_DUPLICATE_RECALL_HITS_FIELD)
                .and_then(Value::as_u64),
            Some(1)
        );
        assert_eq!(
            detail
                .get(SOURCE_MERGE_DETAIL_LANE_COUNTS_FIELD)
                .and_then(|value| value.get("interest"))
                .and_then(Value::as_u64),
            Some(2)
        );
    }
}
