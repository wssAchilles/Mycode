use crate::{FALLBACK_LANE, SourceDescriptor};

pub const SOURCE_PLAN_VERSION: &str = "source_plan_v1";

pub const SOURCE_ML_COST_GUARD_OFFLINE_ONLY: &str = "offline_only_guard";
pub const SOURCE_ML_COST_GUARD_ONLINE_ALLOWED: &str = "online_ml_allowed_by_registry";
pub const SOURCE_ML_COST_GUARD_NOT_ML_BACKED: &str = "not_ml_backed";
pub const SOURCE_ML_COST_GUARD_UNKNOWN_SOURCE: &str = "unknown_source";

#[derive(Debug, Clone)]
pub struct SourcePlan {
    pub source_id: String,
    pub lane: &'static str,
    pub enabled: bool,
    pub disabled_reason: Option<&'static str>,
    pub budget: usize,
    pub lane_budget: usize,
    pub mixing_multiplier: f64,
    pub trend_boost_ratio: f64,
    pub ml_cost_guard: &'static str,
    pub descriptor: Option<&'static SourceDescriptor>,
}

impl SourcePlan {
    pub fn disabled(
        source_name: &str,
        descriptor: Option<&'static SourceDescriptor>,
        reason: &'static str,
    ) -> Self {
        Self {
            source_id: source_name.to_string(),
            lane: descriptor
                .map(|descriptor| descriptor.lane)
                .unwrap_or(FALLBACK_LANE),
            enabled: false,
            disabled_reason: Some(reason),
            budget: 0,
            lane_budget: 0,
            mixing_multiplier: 0.0,
            trend_boost_ratio: 0.0,
            ml_cost_guard: source_ml_cost_guard(descriptor),
            descriptor,
        }
    }

    pub fn enabled(
        descriptor: &'static SourceDescriptor,
        budget: usize,
        lane_budget: usize,
        mixing_multiplier: f64,
        trend_boost_ratio: f64,
    ) -> Self {
        Self {
            source_id: descriptor.id.to_string(),
            lane: descriptor.lane,
            enabled: true,
            disabled_reason: None,
            budget,
            lane_budget,
            mixing_multiplier,
            trend_boost_ratio,
            ml_cost_guard: source_ml_cost_guard(Some(descriptor)),
            descriptor: Some(descriptor),
        }
    }
}

pub fn source_ml_cost_guard(descriptor: Option<&SourceDescriptor>) -> &'static str {
    match descriptor {
        Some(descriptor) if descriptor.is_ml_backed && !descriptor.online_allowed => {
            SOURCE_ML_COST_GUARD_OFFLINE_ONLY
        }
        Some(descriptor) if descriptor.is_ml_backed => SOURCE_ML_COST_GUARD_ONLINE_ALLOWED,
        Some(_) => SOURCE_ML_COST_GUARD_NOT_ML_BACKED,
        None => SOURCE_ML_COST_GUARD_UNKNOWN_SOURCE,
    }
}

#[cfg(test)]
mod tests {
    use crate::{NEWS_ANN_SOURCE, POPULAR_SOURCE, source_descriptor};

    use super::{
        SOURCE_ML_COST_GUARD_NOT_ML_BACKED, SOURCE_ML_COST_GUARD_OFFLINE_ONLY, SOURCE_PLAN_VERSION,
        SourcePlan, source_ml_cost_guard,
    };

    #[test]
    fn source_plan_preserves_disabled_contract() {
        let plan = SourcePlan::disabled("UnknownSource", None, "unknownSource");

        assert_eq!(SOURCE_PLAN_VERSION, "source_plan_v1");
        assert!(!plan.enabled);
        assert_eq!(plan.disabled_reason, Some("unknownSource"));
        assert_eq!(plan.ml_cost_guard, "unknown_source");
    }

    #[test]
    fn source_ml_cost_guard_follows_source_registry() {
        assert_eq!(
            source_ml_cost_guard(source_descriptor(NEWS_ANN_SOURCE)),
            SOURCE_ML_COST_GUARD_OFFLINE_ONLY
        );
        assert_eq!(
            source_ml_cost_guard(source_descriptor(POPULAR_SOURCE)),
            SOURCE_ML_COST_GUARD_NOT_ML_BACKED
        );
    }
}
