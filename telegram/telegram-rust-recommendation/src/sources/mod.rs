pub mod contracts;
pub mod graph_source;
pub mod orchestrator;

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
    pub fn as_str(self) -> &'static str {
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
    pub fn as_str(self) -> &'static str {
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
