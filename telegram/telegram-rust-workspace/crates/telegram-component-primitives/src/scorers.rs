use crate::to_component_names;

pub const PHOENIX_SCORER: &str = "PhoenixScorer";
pub const ENGAGEMENT_SCORER: &str = "EngagementScorer";
pub const LIGHTWEIGHT_PHOENIX_SCORER: &str = "LightweightPhoenixScorer";
pub const WEIGHTED_SCORER: &str = "WeightedScorer";
pub const SCORE_CALIBRATION_SCORER: &str = "ScoreCalibrationScorer";
pub const CONTENT_QUALITY_SCORER: &str = "ContentQualityScorer";
pub const AUTHOR_AFFINITY_SCORER: &str = "AuthorAffinityScorer";
pub const RECENCY_SCORER: &str = "RecencyScorer";
pub const COLD_START_INTEREST_SCORER: &str = "ColdStartInterestScorer";
pub const TREND_AFFINITY_SCORER: &str = "TrendAffinityScorer";
pub const TREND_PERSONALIZATION_SCORER: &str = "TrendPersonalizationScorer";
pub const NEWS_TREND_LINK_SCORER: &str = "NewsTrendLinkScorer";
pub const INTEREST_DECAY_SCORER: &str = "InterestDecayScorer";
pub const EXPLORATION_SCORER: &str = "ExplorationScorer";
pub const BANDIT_EXPLORATION_SCORER: &str = "BanditExplorationScorer";
pub const FATIGUE_SCORER: &str = "FatigueScorer";
pub const SESSION_SUPPRESSION_SCORER: &str = "SessionSuppressionScorer";
pub const OUT_OF_NETWORK_SCORER: &str = "OutOfNetworkScorer";
pub const INTRA_REQUEST_DIVERSITY_SCORER: &str = "IntraRequestDiversityScorer";
pub const AUTHOR_DIVERSITY_SCORER: &str = "AuthorDiversityScorer";
pub const SCORE_CONTRACT_SCORER: &str = "ScoreContractScorer";

pub const MODEL_PROVIDER_SCORER_NAMES: &[&str] = &[PHOENIX_SCORER, ENGAGEMENT_SCORER];

pub const LOCAL_SCORER_STAGE_NAMES: &[&str] = &[
    LIGHTWEIGHT_PHOENIX_SCORER,
    WEIGHTED_SCORER,
    SCORE_CALIBRATION_SCORER,
    CONTENT_QUALITY_SCORER,
    AUTHOR_AFFINITY_SCORER,
    RECENCY_SCORER,
    COLD_START_INTEREST_SCORER,
    TREND_AFFINITY_SCORER,
    TREND_PERSONALIZATION_SCORER,
    NEWS_TREND_LINK_SCORER,
    INTEREST_DECAY_SCORER,
    EXPLORATION_SCORER,
    BANDIT_EXPLORATION_SCORER,
    FATIGUE_SCORER,
    SESSION_SUPPRESSION_SCORER,
    OUT_OF_NETWORK_SCORER,
    INTRA_REQUEST_DIVERSITY_SCORER,
    AUTHOR_DIVERSITY_SCORER,
    SCORE_CONTRACT_SCORER,
];

pub fn configured_model_provider_scorers() -> Vec<String> {
    to_component_names(MODEL_PROVIDER_SCORER_NAMES)
}

pub fn configured_local_scorers() -> Vec<String> {
    to_component_names(LOCAL_SCORER_STAGE_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{
        AUTHOR_DIVERSITY_SCORER, LIGHTWEIGHT_PHOENIX_SCORER, LOCAL_SCORER_STAGE_NAMES,
        MODEL_PROVIDER_SCORER_NAMES, PHOENIX_SCORER, SCORE_CONTRACT_SCORER,
    };

    #[test]
    fn exports_stable_scorer_order() {
        assert_eq!(MODEL_PROVIDER_SCORER_NAMES[0], PHOENIX_SCORER);
        assert_eq!(LOCAL_SCORER_STAGE_NAMES[0], LIGHTWEIGHT_PHOENIX_SCORER);
        assert_eq!(
            LOCAL_SCORER_STAGE_NAMES[LOCAL_SCORER_STAGE_NAMES.len() - 2],
            AUTHOR_DIVERSITY_SCORER
        );
        assert_eq!(
            LOCAL_SCORER_STAGE_NAMES.last(),
            Some(&SCORE_CONTRACT_SCORER)
        );
    }
}
