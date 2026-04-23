pub const QUERY_HYDRATOR_NAMES: &[&str] = &[
    "UserFeaturesQueryHydrator",
    "UserEmbeddingQueryHydrator",
    "UserActionSeqQueryHydrator",
    "UserStateQueryHydrator",
    "NewsModelContextQueryHydrator",
    "ExperimentQueryHydrator",
];

pub fn configured_query_hydrators() -> Vec<String> {
    QUERY_HYDRATOR_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
