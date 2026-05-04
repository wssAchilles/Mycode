use crate::to_component_names;

pub const USER_FEATURES_QUERY_HYDRATOR: &str = "UserFeaturesQueryHydrator";
pub const USER_EMBEDDING_QUERY_HYDRATOR: &str = "UserEmbeddingQueryHydrator";
pub const USER_ACTION_SEQ_QUERY_HYDRATOR: &str = "UserActionSeqQueryHydrator";
pub const USER_STATE_QUERY_HYDRATOR: &str = "UserStateQueryHydrator";
pub const NEWS_MODEL_CONTEXT_QUERY_HYDRATOR: &str = "NewsModelContextQueryHydrator";
pub const EXPERIMENT_QUERY_HYDRATOR: &str = "ExperimentQueryHydrator";

pub const QUERY_HYDRATOR_NAMES: &[&str] = &[
    USER_FEATURES_QUERY_HYDRATOR,
    USER_EMBEDDING_QUERY_HYDRATOR,
    USER_ACTION_SEQ_QUERY_HYDRATOR,
    USER_STATE_QUERY_HYDRATOR,
    NEWS_MODEL_CONTEXT_QUERY_HYDRATOR,
    EXPERIMENT_QUERY_HYDRATOR,
];

pub fn configured_query_hydrators() -> Vec<String> {
    to_component_names(QUERY_HYDRATOR_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{QUERY_HYDRATOR_NAMES, USER_FEATURES_QUERY_HYDRATOR, configured_query_hydrators};

    #[test]
    fn exports_stable_query_hydrator_order() {
        assert_eq!(QUERY_HYDRATOR_NAMES[0], USER_FEATURES_QUERY_HYDRATOR);
        assert_eq!(configured_query_hydrators().len(), 6);
    }
}
