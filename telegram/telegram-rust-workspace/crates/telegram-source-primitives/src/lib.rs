use std::collections::HashMap;

use serde_json::Value;

pub mod graph_detail;
pub mod graph_kernel;
pub mod orchestration;
pub mod policy_reasons;
pub mod policy_signals;
pub mod retrieval_signals;
pub mod source_plan;
pub use graph_detail::*;
pub use orchestration::*;
pub use policy_reasons::*;
pub use policy_signals::*;
pub use retrieval_signals::*;
pub use source_plan::*;

pub const SOURCE_CONTRACT_VERSION: &str = "source_candidate_contract_v1";

pub const SOURCE_STAGE_ERROR_FIELD: &str = "error";
pub const SOURCE_STAGE_EXECUTION_MODE_FIELD: &str = "executionMode";
pub const SOURCE_STAGE_DEGRADE_MODE_FIELD: &str = "degradeMode";
pub const SOURCE_STAGE_TIMED_OUT_FIELD: &str = "timedOut";
pub const SOURCE_STAGE_TIMEOUT_MS_FIELD: &str = "timeoutMs";
pub const SOURCE_STAGE_ERROR_CLASS_FIELD: &str = "errorClass";
pub const SOURCE_STAGE_CONTRACT_VERSION_FIELD: &str = "sourceStageContractVersion";
pub const SOURCE_STAGE_SOURCE_NAME_FIELD: &str = "sourceName";
pub const SOURCE_STAGE_ENABLED_FIELD: &str = "sourceEnabled";
pub const SOURCE_STAGE_CANDIDATE_COUNT_FIELD: &str = "sourceCandidateCount";
pub const SOURCE_STAGE_RETRIEVAL_LANE_FIELD: &str = "sourceRetrievalLane";
pub const SOURCE_STAGE_DEGRADED_REASON_FIELD: &str = "sourceDegradedReason";

pub const SOURCE_STAGE_EXECUTION_MODE_PARALLEL_BOUNDED: &str = "parallel_bounded";
pub const SOURCE_STAGE_DEGRADE_MODE_FAIL_OPEN: &str = "fail_open";
pub const SOURCE_STAGE_CONTRACT_VERSION: &str = "source_stage_contract_v1";

pub const FOLLOWING_SOURCE: &str = "FollowingSource";
pub const GRAPH_SOURCE: &str = "GraphSource";
pub const GRAPH_KERNEL_SOURCE: &str = "GraphKernelSource";
pub const EMBEDDING_AUTHOR_SOURCE: &str = "EmbeddingAuthorSource";
pub const POPULAR_SOURCE: &str = "PopularSource";
pub const TWO_TOWER_SOURCE: &str = "TwoTowerSource";
pub const NEWS_ANN_SOURCE: &str = "NewsAnnSource";
pub const COLD_START_SOURCE: &str = "ColdStartSource";
pub const RECENT_HOT_STORE_SOURCE: &str = "RecentHotStore";
pub const RECENT_HOT_DETAIL_FIELD: &str = "recentHot";

pub const SOURCE_DETAIL_POLICY_STATE_FIELD: &str = "policyState";
pub const SOURCE_DETAIL_SOURCE_ID_FIELD: &str = "sourceId";
pub const SOURCE_DETAIL_RETRIEVAL_LANE_FIELD: &str = "retrievalLane";
pub const SOURCE_DETAIL_SOURCE_BUDGET_FIELD: &str = "sourceBudget";
pub const SOURCE_DETAIL_SOURCE_LANE_BUDGET_FIELD: &str = "sourceLaneBudget";
pub const SOURCE_DETAIL_PRE_POLICY_COUNT_FIELD: &str = "prePolicyCount";
pub const SOURCE_DETAIL_MIXING_MULTIPLIER_FIELD: &str = "sourceMixingMultiplier";
pub const SOURCE_DETAIL_TREND_BOOST_RATIO_FIELD: &str = "sourceTrendBoostRatio";
pub const SOURCE_DETAIL_ML_COST_GUARD_FIELD: &str = "sourceMlCostGuard";
pub const SOURCE_DETAIL_COST_CLASS_FIELD: &str = "sourceCostClass";
pub const SOURCE_DETAIL_READINESS_IMPACT_FIELD: &str = "sourceReadinessImpact";
pub const SOURCE_DETAIL_ONLINE_ALLOWED_FIELD: &str = "sourceOnlineAllowed";
pub const SOURCE_DETAIL_POLICY_TRUNCATED_COUNT_FIELD: &str = "policyTruncatedCount";

pub const SOURCE_SIGNAL_RANK_FIELD: &str = "sourceRank";
pub const SOURCE_SIGNAL_RANK_SCORE_FIELD: &str = "sourceRankScore";
pub const SOURCE_SIGNAL_SCORE_FIELD: &str = "sourceScore";
pub const SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD: &str = "sourceNormalizedScore";
pub const SOURCE_SIGNAL_BUDGET_PRESSURE_FIELD: &str = "sourceBudgetPressure";
pub const SOURCE_SIGNAL_POLICY_SURVIVAL_RATE_FIELD: &str = "sourcePolicySurvivalRate";

pub const IN_NETWORK_LANE: &str = "in_network";
pub const SOCIAL_EXPANSION_LANE: &str = "social_expansion";
pub const INTEREST_LANE: &str = "interest";
pub const FALLBACK_LANE: &str = "fallback";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceCostClass {
    Backend,
    GraphKernel,
    MlOffline,
}

impl SourceCostClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Backend => "backend",
            Self::GraphKernel => "graph_kernel",
            Self::MlOffline => "ml_offline",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceReadinessImpact {
    Critical,
    Important,
    OfflineOnly,
}

impl SourceReadinessImpact {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Critical => "critical",
            Self::Important => "important",
            Self::OfflineOnly => "offline_only",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceDescriptor {
    pub id: &'static str,
    pub lane: &'static str,
    pub is_ml_backed: bool,
    pub online_allowed: bool,
    pub requires_embedding: bool,
    pub cost_class: SourceCostClass,
    pub readiness_impact: SourceReadinessImpact,
}

impl SourceDescriptor {
    pub const fn new(
        id: &'static str,
        lane: &'static str,
        is_ml_backed: bool,
        online_allowed: bool,
        requires_embedding: bool,
        cost_class: SourceCostClass,
        readiness_impact: SourceReadinessImpact,
    ) -> Self {
        Self {
            id,
            lane,
            is_ml_backed,
            online_allowed,
            requires_embedding,
            cost_class,
            readiness_impact,
        }
    }
}

pub const SOURCE_REGISTRY: &[SourceDescriptor] = &[
    SourceDescriptor::new(
        FOLLOWING_SOURCE,
        IN_NETWORK_LANE,
        false,
        true,
        false,
        SourceCostClass::Backend,
        SourceReadinessImpact::Critical,
    ),
    SourceDescriptor::new(
        GRAPH_SOURCE,
        SOCIAL_EXPANSION_LANE,
        false,
        true,
        false,
        SourceCostClass::GraphKernel,
        SourceReadinessImpact::Critical,
    ),
    SourceDescriptor::new(
        GRAPH_KERNEL_SOURCE,
        SOCIAL_EXPANSION_LANE,
        false,
        true,
        false,
        SourceCostClass::GraphKernel,
        SourceReadinessImpact::Critical,
    ),
    SourceDescriptor::new(
        EMBEDDING_AUTHOR_SOURCE,
        INTEREST_LANE,
        true,
        true,
        true,
        SourceCostClass::Backend,
        SourceReadinessImpact::Important,
    ),
    SourceDescriptor::new(
        POPULAR_SOURCE,
        FALLBACK_LANE,
        false,
        true,
        false,
        SourceCostClass::Backend,
        SourceReadinessImpact::Important,
    ),
    SourceDescriptor::new(
        TWO_TOWER_SOURCE,
        INTEREST_LANE,
        true,
        true,
        false,
        SourceCostClass::Backend,
        SourceReadinessImpact::Important,
    ),
    SourceDescriptor::new(
        NEWS_ANN_SOURCE,
        INTEREST_LANE,
        true,
        false,
        true,
        SourceCostClass::MlOffline,
        SourceReadinessImpact::OfflineOnly,
    ),
    SourceDescriptor::new(
        COLD_START_SOURCE,
        FALLBACK_LANE,
        false,
        true,
        false,
        SourceCostClass::Backend,
        SourceReadinessImpact::Important,
    ),
];

pub const SOURCE_NAMES: &[&str] = &[
    FOLLOWING_SOURCE,
    GRAPH_SOURCE,
    EMBEDDING_AUTHOR_SOURCE,
    POPULAR_SOURCE,
    TWO_TOWER_SOURCE,
    NEWS_ANN_SOURCE,
    COLD_START_SOURCE,
];

pub fn source_descriptor(source_name: &str) -> Option<&'static SourceDescriptor> {
    SOURCE_REGISTRY
        .iter()
        .find(|descriptor| descriptor.id == source_name)
}

pub fn source_retrieval_lane(source_name: &str) -> &'static str {
    source_descriptor(source_name)
        .map(|descriptor| descriptor.lane)
        .unwrap_or(FALLBACK_LANE)
}

pub fn configured_sources(configured_order: &[String]) -> Vec<String> {
    let mut resolved = Vec::new();

    for name in configured_order {
        if source_descriptor(name).is_some() {
            resolved.push(name.clone());
        }
    }

    if resolved.is_empty() {
        SOURCE_NAMES
            .iter()
            .map(|name| (*name).to_string())
            .collect()
    } else {
        resolved
    }
}

pub fn fail_open_source_stage_detail(error: &str) -> HashMap<String, Value> {
    HashMap::from([
        (
            SOURCE_STAGE_ERROR_FIELD.to_string(),
            Value::String(error.to_string()),
        ),
        (
            SOURCE_STAGE_EXECUTION_MODE_FIELD.to_string(),
            Value::String(SOURCE_STAGE_EXECUTION_MODE_PARALLEL_BOUNDED.to_string()),
        ),
        (
            SOURCE_STAGE_DEGRADE_MODE_FIELD.to_string(),
            Value::String(SOURCE_STAGE_DEGRADE_MODE_FAIL_OPEN.to_string()),
        ),
    ])
}

pub fn annotate_source_stage_detail(
    detail: &mut HashMap<String, Value>,
    source_name: &str,
    enabled: bool,
    candidate_count: usize,
) {
    detail.insert(
        SOURCE_STAGE_CONTRACT_VERSION_FIELD.to_string(),
        Value::String(SOURCE_STAGE_CONTRACT_VERSION.to_string()),
    );
    detail.insert(
        SOURCE_STAGE_SOURCE_NAME_FIELD.to_string(),
        Value::String(source_name.to_string()),
    );
    detail.insert(SOURCE_STAGE_ENABLED_FIELD.to_string(), Value::Bool(enabled));
    detail.insert(
        SOURCE_STAGE_CANDIDATE_COUNT_FIELD.to_string(),
        Value::from(candidate_count as u64),
    );
    detail.insert(
        SOURCE_STAGE_RETRIEVAL_LANE_FIELD.to_string(),
        Value::String(source_retrieval_lane(source_name).to_string()),
    );
    if let Some(error) = detail
        .get(SOURCE_STAGE_ERROR_FIELD)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    {
        detail.insert(
            SOURCE_STAGE_DEGRADED_REASON_FIELD.to_string(),
            Value::String(error),
        );
    }
}

pub fn annotate_source_batch_stage_detail(
    detail: &mut HashMap<String, Value>,
    timed_out: bool,
    timeout_ms: Option<u64>,
    error_class: Option<&str>,
) {
    if timed_out {
        detail.insert(SOURCE_STAGE_TIMED_OUT_FIELD.to_string(), Value::Bool(true));
    }
    if let Some(timeout_ms) = timeout_ms {
        detail.insert(
            SOURCE_STAGE_TIMEOUT_MS_FIELD.to_string(),
            Value::from(timeout_ms),
        );
    }
    if let Some(error_class) = error_class {
        detail.insert(
            SOURCE_STAGE_ERROR_CLASS_FIELD.to_string(),
            Value::String(error_class.to_string()),
        );
        detail
            .entry(SOURCE_STAGE_ERROR_FIELD.to_string())
            .or_insert_with(|| Value::String(error_class.to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FALLBACK_LANE, GRAPH_KERNEL_SOURCE, GRAPH_SOURCE, IN_NETWORK_LANE, INTEREST_LANE,
        NEWS_ANN_SOURCE, POPULAR_SOURCE, RECENT_HOT_DETAIL_FIELD, RECENT_HOT_STORE_SOURCE,
        SOCIAL_EXPANSION_LANE, SOURCE_CONTRACT_VERSION, SOURCE_DETAIL_PRE_POLICY_COUNT_FIELD,
        SOURCE_DETAIL_RETRIEVAL_LANE_FIELD, SOURCE_DETAIL_SOURCE_BUDGET_FIELD,
        SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD, SOURCE_SIGNAL_POLICY_SURVIVAL_RATE_FIELD,
        SOURCE_STAGE_CANDIDATE_COUNT_FIELD, SOURCE_STAGE_CONTRACT_VERSION,
        SOURCE_STAGE_CONTRACT_VERSION_FIELD, SOURCE_STAGE_ENABLED_FIELD,
        SOURCE_STAGE_ERROR_CLASS_FIELD, SOURCE_STAGE_ERROR_FIELD,
        SOURCE_STAGE_RETRIEVAL_LANE_FIELD, SOURCE_STAGE_SOURCE_NAME_FIELD,
        SOURCE_STAGE_TIMED_OUT_FIELD, SOURCE_STAGE_TIMEOUT_MS_FIELD, SourceCostClass,
        SourceReadinessImpact, annotate_source_batch_stage_detail, annotate_source_stage_detail,
        fail_open_source_stage_detail, source_descriptor, source_retrieval_lane,
    };

    #[test]
    fn maps_stable_sources_to_retrieval_lanes() {
        assert_eq!(source_retrieval_lane("FollowingSource"), IN_NETWORK_LANE);
        assert_eq!(source_retrieval_lane(GRAPH_SOURCE), SOCIAL_EXPANSION_LANE);
        assert_eq!(
            source_retrieval_lane(GRAPH_KERNEL_SOURCE),
            SOCIAL_EXPANSION_LANE
        );
        assert_eq!(source_retrieval_lane("TwoTowerSource"), INTEREST_LANE);
        assert_eq!(
            source_retrieval_lane("EmbeddingAuthorSource"),
            INTEREST_LANE
        );
        assert_eq!(source_retrieval_lane(NEWS_ANN_SOURCE), INTEREST_LANE);
        assert_eq!(source_retrieval_lane(POPULAR_SOURCE), FALLBACK_LANE);
        assert_eq!(source_retrieval_lane("UnknownSource"), FALLBACK_LANE);
    }

    #[test]
    fn exports_recent_hot_topup_source_contract() {
        assert_eq!(RECENT_HOT_STORE_SOURCE, "RecentHotStore");
        assert_eq!(RECENT_HOT_DETAIL_FIELD, "recentHot");
    }

    #[test]
    fn exports_source_policy_detail_and_signal_fields() {
        assert_eq!(SOURCE_DETAIL_RETRIEVAL_LANE_FIELD, "retrievalLane");
        assert_eq!(SOURCE_DETAIL_SOURCE_BUDGET_FIELD, "sourceBudget");
        assert_eq!(SOURCE_DETAIL_PRE_POLICY_COUNT_FIELD, "prePolicyCount");
        assert_eq!(
            SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD,
            "sourceNormalizedScore"
        );
        assert_eq!(
            SOURCE_SIGNAL_POLICY_SURVIVAL_RATE_FIELD,
            "sourcePolicySurvivalRate"
        );
    }

    #[test]
    fn marks_offline_ml_sources_explicitly() {
        let descriptor = source_descriptor(NEWS_ANN_SOURCE).expect("news source descriptor");

        assert!(descriptor.is_ml_backed);
        assert!(!descriptor.online_allowed);
        assert_eq!(descriptor.cost_class, SourceCostClass::MlOffline);
        assert_eq!(
            descriptor.readiness_impact,
            SourceReadinessImpact::OfflineOnly
        );
    }

    #[test]
    fn exports_source_stage_detail_contract() {
        assert_eq!(SOURCE_CONTRACT_VERSION, "source_candidate_contract_v1");
        assert_eq!(SOURCE_STAGE_CONTRACT_VERSION, "source_stage_contract_v1");

        let detail = fail_open_source_stage_detail("upstream_timeout");
        assert_eq!(
            detail
                .get(SOURCE_STAGE_ERROR_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("upstream_timeout")
        );

        let mut detail = std::collections::HashMap::new();
        annotate_source_batch_stage_detail(&mut detail, true, Some(1200), Some("source_timeout"));
        assert_eq!(
            detail
                .get(SOURCE_STAGE_TIMED_OUT_FIELD)
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_TIMEOUT_MS_FIELD)
                .and_then(serde_json::Value::as_u64),
            Some(1200)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_ERROR_CLASS_FIELD)
                .and_then(serde_json::Value::as_str),
            Some("source_timeout")
        );

        annotate_source_stage_detail(&mut detail, GRAPH_SOURCE, true, 3);
        assert_eq!(
            detail
                .get(SOURCE_STAGE_CONTRACT_VERSION_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(SOURCE_STAGE_CONTRACT_VERSION)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_SOURCE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(GRAPH_SOURCE)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_ENABLED_FIELD)
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_CANDIDATE_COUNT_FIELD)
                .and_then(serde_json::Value::as_u64),
            Some(3)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_RETRIEVAL_LANE_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(SOCIAL_EXPANSION_LANE)
        );
    }
}
