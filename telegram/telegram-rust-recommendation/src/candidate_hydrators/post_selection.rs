pub const POST_SELECTION_HYDRATOR_NAMES: &[&str] = &["VFCandidateHydrator"];

pub fn configured_post_selection_hydrators() -> Vec<String> {
    POST_SELECTION_HYDRATOR_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
