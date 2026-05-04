use std::collections::HashMap;

use serde_json::Value;

pub mod graph_detail;
pub use graph_detail::*;

pub const SOURCE_CONTRACT_VERSION: &str = "source_candidate_contract_v1";

pub const SOURCE_STAGE_ERROR_FIELD: &str = "error";
pub const SOURCE_STAGE_EXECUTION_MODE_FIELD: &str = "executionMode";
pub const SOURCE_STAGE_DEGRADE_MODE_FIELD: &str = "degradeMode";
pub const SOURCE_STAGE_TIMED_OUT_FIELD: &str = "timedOut";
pub const SOURCE_STAGE_TIMEOUT_MS_FIELD: &str = "timeoutMs";
pub const SOURCE_STAGE_ERROR_CLASS_FIELD: &str = "errorClass";

pub const SOURCE_STAGE_EXECUTION_MODE_PARALLEL_BOUNDED: &str = "parallel_bounded";
pub const SOURCE_STAGE_DEGRADE_MODE_FAIL_OPEN: &str = "fail_open";

pub const FOLLOWING_SOURCE: &str = "FollowingSource";
pub const GRAPH_SOURCE: &str = "GraphSource";
pub const GRAPH_KERNEL_SOURCE: &str = "GraphKernelSource";
pub const EMBEDDING_AUTHOR_SOURCE: &str = "EmbeddingAuthorSource";
pub const POPULAR_SOURCE: &str = "PopularSource";
pub const TWO_TOWER_SOURCE: &str = "TwoTowerSource";
pub const NEWS_ANN_SOURCE: &str = "NewsAnnSource";
pub const COLD_START_SOURCE: &str = "ColdStartSource";

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
        NEWS_ANN_SOURCE, POPULAR_SOURCE, SOCIAL_EXPANSION_LANE, SOURCE_CONTRACT_VERSION,
        SOURCE_STAGE_ERROR_CLASS_FIELD, SOURCE_STAGE_ERROR_FIELD, SOURCE_STAGE_TIMED_OUT_FIELD,
        SOURCE_STAGE_TIMEOUT_MS_FIELD, SourceCostClass, SourceReadinessImpact,
        annotate_source_batch_stage_detail, fail_open_source_stage_detail, source_descriptor,
        source_retrieval_lane,
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
    }
}
