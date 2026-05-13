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

pub const WEIGHTED_RAW_SCORE_FIELD: &str = "weightedRawScore";
pub const WEIGHTED_BASE_RAW_SCORE_FIELD: &str = "weightedBaseRawScore";
pub const WEIGHTED_POSITIVE_SCORE_FIELD: &str = "weightedPositiveScore";
pub const WEIGHTED_NEGATIVE_SCORE_FIELD: &str = "weightedNegativeScore";
pub const WEIGHTED_EVIDENCE_PRIOR_FIELD: &str = "weightedEvidencePrior";
pub const WEIGHTED_SIGNAL_PRIOR_FIELD: &str = "weightedSignalPrior";
pub const WEIGHTED_EVIDENCE_LIFT_FIELD: &str = "weightedEvidenceLift";
pub const WEIGHTED_ACTION_SCORES_USED_FIELD: &str = "weightedActionScoresUsed";
pub const WEIGHTED_HEURISTIC_FALLBACK_USED_FIELD: &str = "weightedHeuristicFallbackUsed";
pub const WEIGHTED_POSITIVE_WEIGHT_SUM_FIELD: &str = "positiveWeightSum";
pub const WEIGHTED_NEGATIVE_WEIGHT_SUM_FIELD: &str = "negativeWeightSum";
pub const NORMALIZED_WEIGHTED_SCORE_FIELD: &str = "normalizedWeightedScore";

#[cfg(test)]
mod tests {
    use super::{
        AUTHOR_AFFINITY_SCORE_FIELD, EXPLORATION_ELIGIBLE_FIELD, NEGATIVE_FEEDBACK_STRENGTH_FIELD,
        RANKING_POLICY_STRATEGY_VERSION, SCORE_BREAKDOWN_VERSION, SCORE_BREAKDOWN_VERSION_FIELD,
        SCORE_CONTRACT_VERSION, SCORE_CONTRACT_VERSION_FIELD, SELECTOR_RESCUE_ELIGIBLE_FIELD,
        TREND_AFFINITY_STRENGTH_FIELD, TREND_PERSONALIZATION_STRENGTH_FIELD,
        WEIGHTED_ACTION_SCORES_USED_FIELD, WEIGHTED_BASE_RAW_SCORE_FIELD,
        WEIGHTED_EVIDENCE_LIFT_FIELD, WEIGHTED_HEURISTIC_FALLBACK_USED_FIELD,
        WEIGHTED_NEGATIVE_SCORE_FIELD, WEIGHTED_POSITIVE_SCORE_FIELD, WEIGHTED_RAW_SCORE_FIELD,
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
        assert_eq!(WEIGHTED_RAW_SCORE_FIELD, "weightedRawScore");
        assert_eq!(WEIGHTED_BASE_RAW_SCORE_FIELD, "weightedBaseRawScore");
        assert_eq!(WEIGHTED_POSITIVE_SCORE_FIELD, "weightedPositiveScore");
        assert_eq!(WEIGHTED_NEGATIVE_SCORE_FIELD, "weightedNegativeScore");
        assert_eq!(WEIGHTED_EVIDENCE_LIFT_FIELD, "weightedEvidenceLift");
        assert_eq!(
            WEIGHTED_ACTION_SCORES_USED_FIELD,
            "weightedActionScoresUsed"
        );
        assert_eq!(
            WEIGHTED_HEURISTIC_FALLBACK_USED_FIELD,
            "weightedHeuristicFallbackUsed"
        );
    }
}
