use std::collections::HashSet;

use crate::contracts::{RecommendationQueryPatchPayload, RecommendationQueryPayload};

pub(crate) fn apply_query_patch(
    query: &mut RecommendationQueryPayload,
    patch: &RecommendationQueryPatchPayload,
    seen_fields: &mut HashSet<&'static str>,
) -> std::result::Result<(), String> {
    if let Some(user_features) = patch.user_features.clone() {
        if !seen_fields.insert("userFeatures") {
            return Err("query_patch_field_conflict:userFeatures".to_string());
        }
        query.user_features = Some(user_features);
    }
    if let Some(embedding_context) = patch.embedding_context.clone() {
        if !seen_fields.insert("embeddingContext") {
            return Err("query_patch_field_conflict:embeddingContext".to_string());
        }
        query.embedding_context = Some(embedding_context);
    }
    if let Some(user_state_context) = patch.user_state_context.clone() {
        if !seen_fields.insert("userStateContext") {
            return Err("query_patch_field_conflict:userStateContext".to_string());
        }
        query.user_state_context = Some(user_state_context);
    }
    if let Some(user_action_sequence) = patch.user_action_sequence.clone() {
        if !seen_fields.insert("userActionSequence") {
            return Err("query_patch_field_conflict:userActionSequence".to_string());
        }
        query.user_action_sequence = Some(user_action_sequence);
    }
    if let Some(news_history_external_ids) = patch.news_history_external_ids.clone() {
        if !seen_fields.insert("newsHistoryExternalIds") {
            return Err("query_patch_field_conflict:newsHistoryExternalIds".to_string());
        }
        query.news_history_external_ids = Some(news_history_external_ids);
    }
    if let Some(model_user_action_sequence) = patch.model_user_action_sequence.clone() {
        if !seen_fields.insert("modelUserActionSequence") {
            return Err("query_patch_field_conflict:modelUserActionSequence".to_string());
        }
        query.model_user_action_sequence = Some(model_user_action_sequence);
    }
    if let Some(experiment_context) = patch.experiment_context.clone() {
        if !seen_fields.insert("experimentContext") {
            return Err("query_patch_field_conflict:experimentContext".to_string());
        }
        query.experiment_context = Some(experiment_context);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use crate::contracts::{
        ExperimentContextPayload, RecommendationQueryPatchPayload, RecommendationQueryPayload,
        UserFeaturesPayload,
    };

    use super::apply_query_patch;

    #[test]
    fn applies_disjoint_query_patches_and_rejects_conflicts() {
        let mut query = RecommendationQueryPayload {
            request_id: "req-query-patch".to_string(),
            user_id: "viewer-1".to_string(),
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
        };
        let mut seen_fields = HashSet::new();

        let user_features_patch = RecommendationQueryPatchPayload {
            user_features: Some(UserFeaturesPayload {
                followed_user_ids: vec!["author-1".to_string()],
                blocked_user_ids: Vec::new(),
                muted_keywords: Vec::new(),
                seen_post_ids: Vec::new(),
                follower_count: Some(42),
                account_created_at: None,
            }),
            ..RecommendationQueryPatchPayload::default()
        };
        apply_query_patch(&mut query, &user_features_patch, &mut seen_fields)
            .expect("disjoint user features patch should merge");
        assert_eq!(
            query
                .user_features
                .as_ref()
                .and_then(|value| value.follower_count),
            Some(42)
        );

        let experiment_patch = RecommendationQueryPatchPayload {
            experiment_context: Some(ExperimentContextPayload {
                user_id: "viewer-1".to_string(),
                assignments: Vec::new(),
            }),
            ..RecommendationQueryPatchPayload::default()
        };
        apply_query_patch(&mut query, &experiment_patch, &mut seen_fields)
            .expect("disjoint experiment patch should merge");
        assert_eq!(
            query
                .experiment_context
                .as_ref()
                .map(|value| value.user_id.as_str()),
            Some("viewer-1")
        );

        let conflict = apply_query_patch(&mut query, &user_features_patch, &mut seen_fields)
            .expect_err("second writer to userFeatures should be rejected");
        assert_eq!(conflict, "query_patch_field_conflict:userFeatures");
    }
}
