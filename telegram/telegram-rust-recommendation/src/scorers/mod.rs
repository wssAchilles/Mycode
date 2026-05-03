pub const SCORER_NAMES: &[&str] = &[
    "PhoenixScorer",
    "EngagementScorer",
    "WeightedScorer",
    "ScoreCalibrationScorer",
    "ContentQualityScorer",
    "AuthorAffinityScorer",
    "RecencyScorer",
    "ColdStartInterestScorer",
    "ExplorationScorer",
    "BanditExplorationScorer",
    "FatigueScorer",
    "SessionSuppressionScorer",
    "OutOfNetworkScorer",
    "AuthorDiversityScorer",
    "ScoreContractScorer",
];

pub fn configured_scorers() -> Vec<String> {
    SCORER_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
