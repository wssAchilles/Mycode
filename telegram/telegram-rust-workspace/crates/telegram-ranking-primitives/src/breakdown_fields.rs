pub const SCORE_CONTRACT_VERSION: &str = "recommendation_score_contract_v2";
pub const SCORE_BREAKDOWN_VERSION: &str = "score_breakdown_v2";
pub const RANKING_POLICY_STRATEGY_VERSION: &str = "strategy_policy_v1";

pub const SCORE_CONTRACT_VERSION_FIELD: &str = "scoreContractVersion";
pub const SCORE_BREAKDOWN_VERSION_FIELD: &str = "scoreBreakdownVersion";

pub const AUTHOR_AFFINITY_SCORE_FIELD: &str = "authorAffinityScore";
pub const EXPLORATION_ELIGIBLE_FIELD: &str = "explorationEligible";
pub const SELECTOR_RESCUE_ELIGIBLE_FIELD: &str = "selectorRescueEligible";
pub const TREND_AFFINITY_STRENGTH_FIELD: &str = "trendAffinityStrength";
pub const TREND_PERSONALIZATION_STRENGTH_FIELD: &str = "trendPersonalizationStrength";
pub const FATIGUE_STRENGTH_FIELD: &str = "fatigueStrength";
pub const RANKING_STABLE_INTEREST_FIELD: &str = "rankingStableInterest";
pub const ACTION_NEGATIVE_FIELD: &str = "actionNegative";

pub const NEGATIVE_FEEDBACK_STRENGTH_FIELD: &str = "negativeFeedbackStrength";
pub const INTEREST_DECAY_NEGATIVE_PRESSURE_FIELD: &str = "interestDecayNegativePressure";
pub const FATIGUE_NEGATIVE_FEEDBACK_FIELD: &str = "fatigueNegativeFeedback";

#[cfg(test)]
mod tests {
    use super::{
        AUTHOR_AFFINITY_SCORE_FIELD, EXPLORATION_ELIGIBLE_FIELD, NEGATIVE_FEEDBACK_STRENGTH_FIELD,
        RANKING_POLICY_STRATEGY_VERSION, SCORE_BREAKDOWN_VERSION, SCORE_BREAKDOWN_VERSION_FIELD,
        SCORE_CONTRACT_VERSION, SCORE_CONTRACT_VERSION_FIELD, SELECTOR_RESCUE_ELIGIBLE_FIELD,
        TREND_AFFINITY_STRENGTH_FIELD, TREND_PERSONALIZATION_STRENGTH_FIELD,
    };

    #[test]
    fn exports_selector_visible_ranking_breakdown_fields() {
        assert_eq!(SCORE_CONTRACT_VERSION, "recommendation_score_contract_v2");
        assert_eq!(SCORE_BREAKDOWN_VERSION, "score_breakdown_v2");
        assert_eq!(RANKING_POLICY_STRATEGY_VERSION, "strategy_policy_v1");
        assert_eq!(SCORE_CONTRACT_VERSION_FIELD, "scoreContractVersion");
        assert_eq!(SCORE_BREAKDOWN_VERSION_FIELD, "scoreBreakdownVersion");
        assert_eq!(AUTHOR_AFFINITY_SCORE_FIELD, "authorAffinityScore");
        assert_eq!(EXPLORATION_ELIGIBLE_FIELD, "explorationEligible");
        assert_eq!(SELECTOR_RESCUE_ELIGIBLE_FIELD, "selectorRescueEligible");
        assert_eq!(TREND_AFFINITY_STRENGTH_FIELD, "trendAffinityStrength");
        assert_eq!(
            TREND_PERSONALIZATION_STRENGTH_FIELD,
            "trendPersonalizationStrength"
        );
        assert_eq!(NEGATIVE_FEEDBACK_STRENGTH_FIELD, "negativeFeedbackStrength");
    }
}
