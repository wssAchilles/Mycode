pub const QUERY_HYDRATOR_NAMES: &[&str] = &[
    "UserFeaturesHydrator",
    "UserActionSequenceHydrator",
    "ExperimentContextHydrator",
    "NewsModelContextHydrator",
];

pub fn configured_query_hydrators() -> Vec<String> {
    QUERY_HYDRATOR_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
