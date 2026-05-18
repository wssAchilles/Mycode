use std::collections::{HashMap, HashSet};

use telegram_pipeline_primitives::query_hydrator_provider_key;

use crate::contracts::RecommendationQueryPayload;
use crate::pipeline::utils::{dedup_strings, merge_provider_calls, record_provider_call};

use super::patch::apply_query_patch;
use super::stage_payload::{
    annotate_query_stage_error, annotate_query_stage_error_class, build_query_error_stage,
    query_stage_error,
};
use super::types::{QueryHydrationOutput, QueryHydratorResult};

pub(crate) fn merge_query_hydrator_results(
    query: &RecommendationQueryPayload,
    hydrator_names: &[String],
    ordered_results: Vec<QueryHydratorResult>,
    mut provider_calls: HashMap<String, usize>,
    provider_latency_ms: HashMap<String, u64>,
) -> QueryHydrationOutput {
    let mut hydrated_query = query.clone();
    let mut seen_fields = HashSet::new();
    let mut stages = Vec::with_capacity(ordered_results.len());
    let mut degraded_reasons = Vec::new();

    for (index, result) in ordered_results.into_iter().enumerate() {
        let hydrator_name = hydrator_names
            .get(index)
            .map(String::as_str)
            .unwrap_or("query_hydrator_unknown");
        let Some((mut stage, patch, patch_provider_calls, error_class)) = result else {
            stages.push(build_query_error_stage(
                hydrator_name,
                "query_hydrator_missing_result",
            ));
            degraded_reasons.push(format!(
                "query:{hydrator_name}:query_hydrator_missing_result"
            ));
            continue;
        };

        merge_provider_calls(&mut provider_calls, &patch_provider_calls);
        if let Some(error_class) = error_class {
            annotate_query_stage_error_class(&mut stage, error_class);
        }
        record_provider_call(
            &mut provider_calls,
            query_hydrator_provider_key(hydrator_name),
        );
        if let Some(error) = query_stage_error(&stage) {
            degraded_reasons.push(format!("query:{}:{error}", stage.name));
        }
        if let Err(error) = apply_query_patch(&mut hydrated_query, &patch, &mut seen_fields) {
            annotate_query_stage_error(&mut stage, error.clone());
            degraded_reasons.push(format!("query:{}:{error}", stage.name));
        }
        stages.push(stage);
    }

    dedup_strings(&mut degraded_reasons);
    QueryHydrationOutput::new(
        hydrated_query,
        stages,
        provider_calls,
        provider_latency_ms,
        degraded_reasons,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::contracts::{
        RecommendationQueryPatchPayload, RecommendationQueryPayload, RecommendationStagePayload,
        UserFeaturesPayload,
    };

    use super::merge_query_hydrator_results;
    use crate::query_hydrators::stage_payload::build_query_error_stage;

    #[test]
    fn merges_successful_patch_and_failed_hydrator_without_losing_order() {
        let query = query();
        let hydrators = vec![
            "UserFeaturesQueryHydrator".to_string(),
            "EmbeddingQueryHydrator".to_string(),
        ];
        let mut patch_provider_calls = HashMap::new();
        patch_provider_calls.insert("node:user_features".to_string(), 1);

        let output = merge_query_hydrator_results(
            &query,
            &hydrators,
            vec![
                Some((
                    stage("UserFeaturesQueryHydrator"),
                    RecommendationQueryPatchPayload {
                        user_features: Some(UserFeaturesPayload {
                            followed_user_ids: vec!["author-1".to_string()],
                            blocked_user_ids: Vec::new(),
                            muted_user_ids: Vec::new(),
                            muted_keywords: Vec::new(),
                            muted_topic_ids: Vec::new(),
                            video_preference: "allow".to_string(),
                            is_subscriber: false,
                            seen_post_ids: Vec::new(),
                            subscribed_user_ids: Vec::new(),
                            follower_count: Some(7),
                            account_created_at: None,
                        }),
                        ..RecommendationQueryPatchPayload::default()
                    },
                    patch_provider_calls,
                    None,
                )),
                Some((
                    build_query_error_stage("EmbeddingQueryHydrator", "provider_timeout"),
                    RecommendationQueryPatchPayload::default(),
                    HashMap::new(),
                    Some("timeout".to_string()),
                )),
            ],
            HashMap::new(),
            HashMap::new(),
        );

        assert_eq!(output.stages.len(), 2);
        assert_eq!(
            output
                .hydrated_query
                .user_features
                .as_ref()
                .and_then(|features| features.follower_count),
            Some(7)
        );
        assert_eq!(output.provider_calls.get("node:user_features"), Some(&1));
        assert!(
            output
                .provider_calls
                .contains_key("query_hydrators/UserFeaturesQueryHydrator")
        );
        assert!(
            output
                .degraded_reasons
                .contains(&"query:EmbeddingQueryHydrator:provider_timeout".to_string())
        );
    }

    fn query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-query-merge".to_string(),
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

    fn stage(name: &str) -> RecommendationStagePayload {
        RecommendationStagePayload {
            name: name.to_string(),
            enabled: true,
            duration_ms: 0,
            input_count: 1,
            output_count: 1,
            removed_count: None,
            detail: None,
        }
    }
}
