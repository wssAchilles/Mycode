use crate::to_component_names;

pub const USER_FEATURES_QUERY_HYDRATOR: &str = "UserFeaturesQueryHydrator";
pub const USER_EMBEDDING_QUERY_HYDRATOR: &str = "UserEmbeddingQueryHydrator";
pub const USER_ACTION_SEQ_QUERY_HYDRATOR: &str = "UserActionSeqQueryHydrator";
pub const USER_STATE_QUERY_HYDRATOR: &str = "UserStateQueryHydrator";
pub const NEWS_MODEL_CONTEXT_QUERY_HYDRATOR: &str = "NewsModelContextQueryHydrator";
pub const USER_SIGNAL_QUERY_HYDRATOR: &str = "UserSignalQueryHydrator";
pub const INTERESTED_TOPICS_QUERY_HYDRATOR: &str = "InterestedTopicsQueryHydrator";
pub const EXPERIMENT_QUERY_HYDRATOR: &str = "ExperimentQueryHydrator";
pub const MUTUAL_FOLLOW_QUERY_HYDRATOR: &str = "MutualFollowQueryHydrator";
pub const DEMOGRAPHICS_QUERY_HYDRATOR: &str = "DemographicsQueryHydrator";
pub const SUBSCRIBED_USER_IDS_QUERY_HYDRATOR: &str = "SubscribedUserIdsQueryHydrator";
pub const PAST_REQUEST_TIMESTAMPS_QUERY_HYDRATOR: &str = "PastRequestTimestampsQueryHydrator";
pub const IMPRESSED_POSTS_QUERY_HYDRATOR: &str = "ImpressedPostsQueryHydrator";
pub const IP_QUERY_HYDRATOR: &str = "IpQueryHydrator";

pub const QUERY_HYDRATOR_BASE_STAGE: usize = 0;
pub const QUERY_HYDRATOR_DEPENDENT_STAGE: usize = 1;

pub const QUERY_HYDRATOR_NAMES: &[&str] = &[
    USER_FEATURES_QUERY_HYDRATOR,
    MUTUAL_FOLLOW_QUERY_HYDRATOR,
    INTERESTED_TOPICS_QUERY_HYDRATOR,
    DEMOGRAPHICS_QUERY_HYDRATOR,
    USER_EMBEDDING_QUERY_HYDRATOR,
    USER_ACTION_SEQ_QUERY_HYDRATOR,
    USER_STATE_QUERY_HYDRATOR,
    NEWS_MODEL_CONTEXT_QUERY_HYDRATOR,
    USER_SIGNAL_QUERY_HYDRATOR,
    PAST_REQUEST_TIMESTAMPS_QUERY_HYDRATOR,
    EXPERIMENT_QUERY_HYDRATOR,
];

pub fn configured_query_hydrators() -> Vec<String> {
    to_component_names(QUERY_HYDRATOR_NAMES)
}

pub fn query_hydrator_stage(hydrator_name: &str) -> usize {
    match hydrator_name {
        MUTUAL_FOLLOW_QUERY_HYDRATOR | EXPERIMENT_QUERY_HYDRATOR | USER_STATE_QUERY_HYDRATOR => {
            QUERY_HYDRATOR_DEPENDENT_STAGE
        }
        _ => QUERY_HYDRATOR_BASE_STAGE,
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::{
        DEMOGRAPHICS_QUERY_HYDRATOR, EXPERIMENT_QUERY_HYDRATOR, MUTUAL_FOLLOW_QUERY_HYDRATOR,
        QUERY_HYDRATOR_BASE_STAGE, QUERY_HYDRATOR_DEPENDENT_STAGE, QUERY_HYDRATOR_NAMES,
        USER_FEATURES_QUERY_HYDRATOR, USER_STATE_QUERY_HYDRATOR, configured_query_hydrators,
        query_hydrator_stage,
    };

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct QueryHydratorContract {
        contract_version: String,
        hydrators: Vec<QueryHydratorContractEntry>,
    }

    #[derive(Deserialize)]
    struct QueryHydratorContractEntry {
        name: String,
        stage: String,
    }

    #[test]
    fn exports_stable_query_hydrator_order() {
        assert_eq!(QUERY_HYDRATOR_NAMES[0], USER_FEATURES_QUERY_HYDRATOR);
        assert_eq!(QUERY_HYDRATOR_NAMES[1], MUTUAL_FOLLOW_QUERY_HYDRATOR);
        assert_eq!(QUERY_HYDRATOR_NAMES[3], DEMOGRAPHICS_QUERY_HYDRATOR);
        assert_eq!(configured_query_hydrators().len(), 11);
        assert_eq!(
            query_hydrator_stage(USER_FEATURES_QUERY_HYDRATOR),
            QUERY_HYDRATOR_BASE_STAGE,
        );
        for name in [
            MUTUAL_FOLLOW_QUERY_HYDRATOR,
            EXPERIMENT_QUERY_HYDRATOR,
            USER_STATE_QUERY_HYDRATOR,
        ] {
            assert_eq!(query_hydrator_stage(name), QUERY_HYDRATOR_DEPENDENT_STAGE);
        }
    }

    #[test]
    fn matches_shared_query_hydrator_contract() {
        let contract: QueryHydratorContract = serde_json::from_str(include_str!(
            "../../telegram-recommendation-fixtures/fixtures/query_hydrator_contract.json"
        ))
        .expect("parse shared query hydrator contract");

        assert_eq!(
            contract.contract_version,
            "recommendation_query_hydrator_contract_v1"
        );
        assert_eq!(
            configured_query_hydrators(),
            contract
                .hydrators
                .iter()
                .map(|entry| entry.name.clone())
                .collect::<Vec<_>>()
        );
        for entry in contract.hydrators {
            let expected_stage = match entry.stage.as_str() {
                "base" => QUERY_HYDRATOR_BASE_STAGE,
                "dependent" => QUERY_HYDRATOR_DEPENDENT_STAGE,
                stage => panic!("unknown query hydrator stage: {stage}"),
            };
            assert_eq!(
                query_hydrator_stage(&entry.name),
                expected_stage,
                "{}",
                entry.name
            );
        }
    }
}
