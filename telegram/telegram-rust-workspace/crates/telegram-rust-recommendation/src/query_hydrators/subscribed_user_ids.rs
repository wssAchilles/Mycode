use crate::contracts::RecommendationQueryPayload;

/// Hydrator that populates `subscribed_user_ids` from user features.
///
/// Reads the user's subscription list from the user features payload
/// and ensures it is available for downstream filters (e.g. SubscriptionFilter).
pub struct SubscribedUserIdsQueryHydrator;

impl SubscribedUserIdsQueryHydrator {
    pub fn name() -> &'static str {
        "SubscribedUserIdsQueryHydrator"
    }

    /// Copy subscribed_user_ids from user_features into the query-level field
    /// if not already populated.
    pub fn hydrate(query: &mut RecommendationQueryPayload) {
        if !query.subscribed_user_ids.is_empty() {
            return;
        }
        if let Some(ref features) = query.user_features {
            query.subscribed_user_ids = features.subscribed_user_ids.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::contracts::UserFeaturesPayload;

    fn make_query(subscribed: Vec<String>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-sub-test".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            subscribed_user_ids: subscribed,
            ..Default::default()
        }
    }

    #[test]
    fn copies_from_user_features_when_empty() {
        let mut query = make_query(Vec::new());
        query.user_features = Some(UserFeaturesPayload {
            subscribed_user_ids: vec!["author-a".to_string(), "author-b".to_string()],
            ..Default::default()
        });
        SubscribedUserIdsQueryHydrator::hydrate(&mut query);
        assert_eq!(query.subscribed_user_ids, vec!["author-a", "author-b"]);
    }

    #[test]
    fn preserves_existing_subscribed_ids() {
        let mut query = make_query(vec!["existing".to_string()]);
        query.user_features = Some(UserFeaturesPayload {
            subscribed_user_ids: vec!["author-a".to_string()],
            ..Default::default()
        });
        SubscribedUserIdsQueryHydrator::hydrate(&mut query);
        assert_eq!(query.subscribed_user_ids, vec!["existing"]);
    }

    #[test]
    fn handles_no_user_features() {
        let mut query = make_query(Vec::new());
        SubscribedUserIdsQueryHydrator::hydrate(&mut query);
        assert!(query.subscribed_user_ids.is_empty());
    }
}
