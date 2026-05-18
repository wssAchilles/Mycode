use crate::contracts::RecommendationQueryPayload;
use crate::pipeline::local::hydrators::build_hydrator_stage;

use super::RecommendationStagePayload;

const HYDRATOR_NAME: &str = "MutualFollowHydrator";

/// Computes mutual follow IDs by intersecting the user's followed list
/// with their follower list, then patches the query with the result.
///
/// Mutual follow IDs are used downstream for social-graph-aware scoring
/// (e.g. boosting content from mutual connections).
pub fn mutual_follow_hydrator(
    query: &RecommendationQueryPayload,
) -> (RecommendationQueryPayload, RecommendationStagePayload) {
    let mut hydrated = query.clone();
    let input_count = 1;

    // If mutual_follow_ids is already set (e.g. from a prior hydrator or
    // the backend), preserve it and skip computation.
    if hydrated.mutual_follow_ids.is_some() {
        let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, input_count, None);
        return (hydrated, stage);
    }

    let features = hydrated.user_features.as_ref();
    let followed: std::collections::HashSet<&str> = features
        .map(|f| f.followed_user_ids.iter().map(String::as_str).collect())
        .unwrap_or_default();

    // The follower list is not directly available in the current payload
    // contract. We derive mutual follow IDs from the followed list for
    // now. When the backend hydrator provides the follower list, the
    // intersection can be computed here.
    //
    // For local scoring purposes, we treat the followed list as a proxy:
    // candidates whose author_id is in followed_user_ids are already
    // boosted by in-network scoring. The mutual_follow_ids field is
    // reserved for the stricter intersection once the follower list
    // becomes available.
    let mutual_ids: Vec<String> = if followed.is_empty() {
        Vec::new()
    } else {
        // Placeholder: no follower list available locally, return empty.
        // The backend MutualFollowQueryHydrator fills this when available.
        Vec::new()
    };

    hydrated.mutual_follow_ids = Some(mutual_ids);
    let stage = build_hydrator_stage(HYDRATOR_NAME, input_count, input_count, None);
    (hydrated, stage)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn base_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-mutual-follow".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
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
    fn sets_mutual_follow_ids_when_absent() {
        let query = base_query();
        let (hydrated, stage) = mutual_follow_hydrator(&query);

        assert_eq!(stage.name, HYDRATOR_NAME);
        assert!(hydrated.mutual_follow_ids.is_some());
    }

    #[test]
    fn preserves_existing_mutual_follow_ids() {
        let mut query = base_query();
        query.mutual_follow_ids = Some(vec!["user-42".to_string()]);

        let (hydrated, stage) = mutual_follow_hydrator(&query);

        assert_eq!(stage.name, HYDRATOR_NAME);
        assert_eq!(
            hydrated.mutual_follow_ids,
            Some(vec!["user-42".to_string()])
        );
    }

    #[test]
    fn returns_empty_ids_when_no_features() {
        let query = base_query();
        let (hydrated, _) = mutual_follow_hydrator(&query);

        assert_eq!(hydrated.mutual_follow_ids, Some(Vec::new()));
    }
}
