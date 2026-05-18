use crate::contracts::{Demographics, RecommendationQueryPayload};
use crate::pipeline::local::hydrators::build_hydrator_stage;

use super::RecommendationStagePayload;

const HYDRATOR_NAME: &str = "DemographicsHydrator";

/// Injects user demographic information into the query for downstream
/// content relevance and regionalization scoring.
///
/// Reads age range, region, and language from the user profile and
/// stores them in `query.demographics`. When the backend provides a
/// richer demographic payload, this hydrator defers to it.
pub fn demographics_hydrator(
    query: &RecommendationQueryPayload,
) -> (RecommendationQueryPayload, RecommendationStagePayload) {
    let mut hydrated = query.clone();
    let input_count = 1;

    // If demographics is already set (e.g. from the backend hydrator),
    // preserve it and skip computation.
    if hydrated.demographics.is_some() {
        let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, input_count, None);
        return (hydrated, stage);
    }

    // Derive demographics from available query fields.
    let region = hydrated.country_code.clone();
    let language = hydrated.language_code.clone();

    // Age range is not directly available in the current payload contract.
    // The backend DemographicsQueryHydrator fills this when available.
    let demographics = Demographics {
        age_range: None,
        region,
        language,
    };

    hydrated.demographics = Some(demographics);
    let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, input_count, None);
    (hydrated, stage)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn base_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-demographics".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: Some("US".to_string()),
            language_code: Some("en".to_string()),
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: None,
            mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
        }
    }

    #[test]
    fn sets_demographics_from_query_fields() {
        let query = base_query();
        let (hydrated, stage) = demographics_hydrator(&query);

        assert_eq!(stage.name, HYDRATOR_NAME);
        let demo = hydrated.demographics.as_ref().expect("demographics set");
        assert_eq!(demo.region.as_deref(), Some("US"));
        assert_eq!(demo.language.as_deref(), Some("en"));
        assert!(demo.age_range.is_none());
    }

    #[test]
    fn preserves_existing_demographics() {
        let mut query = base_query();
        query.demographics = Some(Demographics {
            age_range: Some((18, 35)),
            region: Some("JP".to_string()),
            language: Some("ja".to_string()),
        });

        let (hydrated, stage) = demographics_hydrator(&query);

        assert_eq!(stage.name, HYDRATOR_NAME);
        let demo = hydrated.demographics.as_ref().expect("demographics set");
        assert_eq!(demo.age_range, Some((18, 35)));
        assert_eq!(demo.region.as_deref(), Some("JP"));
    }

    #[test]
    fn handles_missing_country_and_language() {
        let mut query = base_query();
        query.country_code = None;
        query.language_code = None;

        let (hydrated, _) = demographics_hydrator(&query);

        let demo = hydrated.demographics.as_ref().expect("demographics set");
        assert!(demo.region.is_none());
        assert!(demo.language.is_none());
    }
}
