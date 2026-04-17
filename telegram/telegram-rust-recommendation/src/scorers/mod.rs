pub const SCORER_NAMES: &[&str] = &[
    "PhoenixScorer",
    "WeightedScorer",
    "ContentQualityScorer",
    "AuthorAffinityScorer",
    "RecencyScorer",
    "AuthorDiversityScorer",
    "OutOfNetworkScorer",
];

pub fn configured_scorers() -> Vec<String> {
    SCORER_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
