use crate::to_component_names;

pub const USER_FEATURES_QUERY_HYDRATOR: &str = "UserFeaturesQueryHydrator";
pub const USER_EMBEDDING_QUERY_HYDRATOR: &str = "UserEmbeddingQueryHydrator";
pub const USER_ACTION_SEQ_QUERY_HYDRATOR: &str = "UserActionSeqQueryHydrator";
pub const USER_STATE_QUERY_HYDRATOR: &str = "UserStateQueryHydrator";
pub const NEWS_MODEL_CONTEXT_QUERY_HYDRATOR: &str = "NewsModelContextQueryHydrator";
pub const EXPERIMENT_QUERY_HYDRATOR: &str = "ExperimentQueryHydrator";
pub const MUTUAL_FOLLOW_QUERY_HYDRATOR: &str = "MutualFollowQueryHydrator";
pub const DEMOGRAPHICS_QUERY_HYDRATOR: &str = "DemographicsQueryHydrator";
pub const SUBSCRIBED_USER_IDS_QUERY_HYDRATOR: &str = "SubscribedUserIdsQueryHydrator";
pub const PAST_REQUEST_TIMESTAMPS_QUERY_HYDRATOR: &str = "PastRequestTimestampsQueryHydrator";
pub const IMPRESSED_POSTS_QUERY_HYDRATOR: &str = "ImpressedPostsQueryHydrator";
pub const IP_QUERY_HYDRATOR: &str = "IpQueryHydrator";

pub const QUERY_HYDRATOR_NAMES: &[&str] = &[
    USER_FEATURES_QUERY_HYDRATOR,
    USER_EMBEDDING_QUERY_HYDRATOR,
    USER_ACTION_SEQ_QUERY_HYDRATOR,
    USER_STATE_QUERY_HYDRATOR,
    NEWS_MODEL_CONTEXT_QUERY_HYDRATOR,
    EXPERIMENT_QUERY_HYDRATOR,
    MUTUAL_FOLLOW_QUERY_HYDRATOR,
    DEMOGRAPHICS_QUERY_HYDRATOR,
    SUBSCRIBED_USER_IDS_QUERY_HYDRATOR,
    PAST_REQUEST_TIMESTAMPS_QUERY_HYDRATOR,
    IMPRESSED_POSTS_QUERY_HYDRATOR,
    IP_QUERY_HYDRATOR,
];

pub fn configured_query_hydrators() -> Vec<String> {
    to_component_names(QUERY_HYDRATOR_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{
        DEMOGRAPHICS_QUERY_HYDRATOR, MUTUAL_FOLLOW_QUERY_HYDRATOR, QUERY_HYDRATOR_NAMES,
        USER_FEATURES_QUERY_HYDRATOR, configured_query_hydrators,
    };

    #[test]
    fn exports_stable_query_hydrator_order() {
        assert_eq!(QUERY_HYDRATOR_NAMES[0], USER_FEATURES_QUERY_HYDRATOR);
        assert_eq!(QUERY_HYDRATOR_NAMES[6], MUTUAL_FOLLOW_QUERY_HYDRATOR);
        assert_eq!(QUERY_HYDRATOR_NAMES[7], DEMOGRAPHICS_QUERY_HYDRATOR);
        assert_eq!(configured_query_hydrators().len(), 12);
    }
}
