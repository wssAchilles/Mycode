use crate::to_component_names;

pub const AUTHOR_INFO_HYDRATOR: &str = "AuthorInfoHydrator";
pub const USER_INTERACTION_HYDRATOR: &str = "UserInteractionHydrator";
pub const VIDEO_INFO_HYDRATOR: &str = "VideoInfoHydrator";
pub const VF_CANDIDATE_HYDRATOR: &str = "VFCandidateHydrator";

pub const CANDIDATE_HYDRATOR_NAMES: &[&str] = &[
    AUTHOR_INFO_HYDRATOR,
    USER_INTERACTION_HYDRATOR,
    VIDEO_INFO_HYDRATOR,
];

pub const POST_SELECTION_HYDRATOR_NAMES: &[&str] = &[VF_CANDIDATE_HYDRATOR];

pub fn configured_candidate_hydrators() -> Vec<String> {
    to_component_names(CANDIDATE_HYDRATOR_NAMES)
}

pub fn configured_post_selection_hydrators() -> Vec<String> {
    to_component_names(POST_SELECTION_HYDRATOR_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{
        CANDIDATE_HYDRATOR_NAMES, POST_SELECTION_HYDRATOR_NAMES, VF_CANDIDATE_HYDRATOR,
        configured_candidate_hydrators,
    };

    #[test]
    fn exports_stable_candidate_hydrator_order() {
        assert_eq!(configured_candidate_hydrators(), CANDIDATE_HYDRATOR_NAMES);
        assert_eq!(POST_SELECTION_HYDRATOR_NAMES, [VF_CANDIDATE_HYDRATOR]);
    }
}
