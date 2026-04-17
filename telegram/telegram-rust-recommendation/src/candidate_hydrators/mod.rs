pub const CANDIDATE_HYDRATOR_NAMES: &[&str] = &[
    "AuthorInfoHydrator",
    "UserInteractionHydrator",
    "VideoInfoHydrator",
    "VisibilityFeaturesHydrator",
];

pub fn configured_candidate_hydrators() -> Vec<String> {
    CANDIDATE_HYDRATOR_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
