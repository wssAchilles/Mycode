use std::collections::HashMap;
use std::time::Instant;

use telegram_pipeline_primitives::{
    PROVIDER_KEY_QUERY_HYDRATORS_BATCH, PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
};

use crate::clients::backend_client::BackendRecommendationClient;
use crate::contracts::RecommendationQueryPayload;
use crate::pipeline::utils::{dedup_strings, record_provider_call, record_provider_latency};

use super::fallback::hydrate_query_parallel_bounded_fallback;
use super::merge::merge_query_hydrator_results;
use super::types::QueryHydrationOutput;

pub(crate) async fn hydrate_query_patches_batch_or_fallback(
    backend_client: &BackendRecommendationClient,
    hydrator_names: &[String],
    concurrency: usize,
    query: &RecommendationQueryPayload,
) -> QueryHydrationOutput {
    let batch_started_at = Instant::now();
    match backend_client
        .hydrate_query_patches_batch(hydrator_names, query)
        .await
    {
        Ok(response) => {
            let mut items_by_name = HashMap::with_capacity(response.payload.items.len());
            let mut contract_error = None;
            for item in response.payload.items {
                if item.stage.name != item.hydrator_name {
                    contract_error = Some(format!(
                        "query_hydrator_batch_stage_mismatch:{}:{}",
                        item.hydrator_name, item.stage.name,
                    ));
                    break;
                }
                if items_by_name
                    .insert(
                        item.hydrator_name.clone(),
                        (
                            item.stage,
                            item.query_patch,
                            item.provider_calls,
                            item.error_class,
                        ),
                    )
                    .is_some()
                {
                    contract_error = Some(format!(
                        "query_hydrator_batch_duplicate:{}",
                        item.hydrator_name,
                    ));
                    break;
                }
            }
            if contract_error.is_none()
                && (items_by_name.len() != hydrator_names.len()
                    || hydrator_names
                        .iter()
                        .any(|hydrator_name| !items_by_name.contains_key(hydrator_name)))
            {
                contract_error = Some("query_hydrator_batch_catalog_mismatch".to_string());
            }
            if let Some(error) = contract_error {
                return hydrate_query_fallback(
                    backend_client,
                    hydrator_names,
                    concurrency,
                    query,
                    batch_started_at,
                    error,
                )
                .await;
            }
            let ordered_results = hydrator_names
                .iter()
                .map(|hydrator_name| items_by_name.remove(hydrator_name))
                .collect::<Vec<_>>();
            let mut provider_calls = response.payload.provider_calls;
            let mut provider_latency_ms = HashMap::new();
            record_provider_call(&mut provider_calls, PROVIDER_KEY_QUERY_HYDRATORS_BATCH);
            record_provider_latency(
                &mut provider_latency_ms,
                PROVIDER_KEY_QUERY_HYDRATORS_BATCH,
                response.latency_ms,
            );

            merge_query_hydrator_results(
                query,
                hydrator_names,
                ordered_results,
                provider_calls,
                provider_latency_ms,
            )
        }
        Err(error) => {
            hydrate_query_fallback(
                backend_client,
                hydrator_names,
                concurrency,
                query,
                batch_started_at,
                error.to_string(),
            )
            .await
        }
    }
}

async fn hydrate_query_fallback(
    backend_client: &BackendRecommendationClient,
    hydrator_names: &[String],
    concurrency: usize,
    query: &RecommendationQueryPayload,
    batch_started_at: Instant,
    error: String,
) -> QueryHydrationOutput {
    let batch_latency_ms = batch_started_at.elapsed().as_millis() as u64;
    let fallback_started_at = Instant::now();
    let mut output =
        hydrate_query_parallel_bounded_fallback(backend_client, hydrator_names, concurrency, query)
            .await;
    let fallback_latency_ms = fallback_started_at.elapsed().as_millis() as u64;
    output
        .degraded_reasons
        .push(format!("query:query_hydrators_batch_failed:{error}"));
    record_provider_call(
        &mut output.provider_calls,
        PROVIDER_KEY_QUERY_HYDRATORS_BATCH,
    );
    record_provider_latency(
        &mut output.provider_latency_ms,
        PROVIDER_KEY_QUERY_HYDRATORS_BATCH,
        batch_latency_ms,
    );
    record_provider_call(
        &mut output.provider_calls,
        PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
    );
    record_provider_latency(
        &mut output.provider_latency_ms,
        PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
        fallback_latency_ms,
    );
    dedup_strings(&mut output.degraded_reasons);
    output
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use axum::{
        Json, Router,
        extract::{Path, State},
        http::StatusCode,
        response::{IntoResponse, Response},
        routing::post,
    };
    use serde::Deserialize;
    use serde_json::Value;
    use telegram_component_primitives::query_hydrators::configured_query_hydrators;
    use telegram_pipeline_primitives::{
        PROVIDER_KEY_QUERY_HYDRATORS_BATCH, PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
        RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
        RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
    };
    use telegram_rust_http_types::SuccessEnvelope;
    use tokio::{net::TcpListener, task::JoinHandle, time::Duration};

    use crate::clients::backend_client::BackendRecommendationClient;
    use crate::config::RecommendationConfig;
    use crate::contracts::{
        EmbeddingContextPayload, ExperimentContextPayload, QueryHydratorBatchRequest,
        QueryHydratorBatchResponse, QueryHydratorPatchResponse, RecommendationQueryPatchPayload,
        RecommendationQueryPayload, RecommendationStagePayload, UserFeaturesPayload,
        UserStateContextPayload,
    };

    use super::hydrate_query_patches_batch_or_fallback;

    type Observations = Arc<Mutex<HashMap<String, (bool, bool, bool)>>>;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct QueryHydratorContract {
        contract_version: String,
        hydrators: Vec<QueryHydratorContractEntry>,
    }

    #[derive(Deserialize)]
    struct QueryHydratorContractEntry {
        name: String,
    }

    #[tokio::test]
    async fn default_catalog_uses_the_shared_node_batch_contract_without_fallback() {
        let (base_url, server) = spawn_contract_catalog_server().await;
        let client = BackendRecommendationClient::new(&fixture_config(base_url))
            .expect("build backend client");
        let output = hydrate_query_patches_batch_or_fallback(
            &client,
            &configured_query_hydrators(),
            4,
            &fixture_query(),
        )
        .await;
        server.abort();

        assert_eq!(
            output
                .provider_calls
                .get(PROVIDER_KEY_QUERY_HYDRATORS_BATCH),
            Some(&1),
        );
        assert!(
            !output
                .provider_calls
                .contains_key(PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK)
        );
        assert!(
            !output
                .degraded_reasons
                .iter()
                .any(|reason| reason.contains("query_hydrators_batch_failed"))
        );
    }

    #[tokio::test]
    async fn batch_failure_fallback_runs_dependent_hydrators_after_base_patches() {
        let observations = Observations::default();
        let (base_url, server) = spawn_query_hydrator_server(observations.clone()).await;
        let client = BackendRecommendationClient::new(&fixture_config(base_url))
            .expect("build backend client");
        let hydrator_names = [
            "MutualFollowQueryHydrator",
            "UserStateQueryHydrator",
            "UserFeaturesQueryHydrator",
            "ExperimentQueryHydrator",
            "UserActionSeqQueryHydrator",
            "UserEmbeddingQueryHydrator",
        ]
        .map(str::to_string);

        let output =
            hydrate_query_patches_batch_or_fallback(&client, &hydrator_names, 4, &fixture_query())
                .await;
        server.abort();

        let observations = observations.lock().expect("observations lock");
        for hydrator_name in [
            "MutualFollowQueryHydrator",
            "ExperimentQueryHydrator",
            "UserStateQueryHydrator",
        ] {
            assert_eq!(
                observations.get(hydrator_name),
                Some(&(true, true, true)),
                "{hydrator_name} must observe every base-stage patch",
            );
        }
        assert_eq!(
            output
                .hydrated_query
                .user_features
                .as_ref()
                .and_then(|features| features.follower_count),
            Some(7),
        );
        assert_eq!(
            output.hydrated_query.mutual_follow_ids,
            Some(vec!["author-2".to_string()]),
        );
        assert!(
            output
                .degraded_reasons
                .iter()
                .any(|reason| reason.contains("query_hydrators_batch_failed")),
        );
        assert_eq!(
            output
                .provider_calls
                .get(PROVIDER_KEY_QUERY_HYDRATORS_BATCH),
            Some(&1),
        );
        assert_eq!(
            output
                .provider_calls
                .get(PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK),
            Some(&1),
        );
        assert!(
            output
                .provider_latency_ms
                .get(PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK)
                .copied()
                .unwrap_or_default()
                > 0,
        );
    }

    #[tokio::test]
    async fn invalid_batch_identity_falls_back_in_requested_order() {
        let observations = Observations::default();
        let (base_url, server) = spawn_invalid_batch_server(observations).await;
        let client = BackendRecommendationClient::new(&fixture_config(base_url))
            .expect("build backend client");
        let hydrator_names =
            ["UserFeaturesQueryHydrator", "UserEmbeddingQueryHydrator"].map(str::to_string);

        let output =
            hydrate_query_patches_batch_or_fallback(&client, &hydrator_names, 1, &fixture_query())
                .await;
        server.abort();

        assert_eq!(
            output
                .stages
                .iter()
                .map(|stage| stage.name.as_str())
                .collect::<Vec<_>>(),
            ["UserFeaturesQueryHydrator", "UserEmbeddingQueryHydrator"],
        );
        assert!(output.degraded_reasons.iter().any(|reason| {
            reason.contains("query_hydrator_batch_stage_mismatch:UserFeaturesQueryHydrator:wrong")
        }));
        assert_eq!(
            output
                .provider_calls
                .get(PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK),
            Some(&1),
        );
    }

    async fn contract_catalog_batch_handler(
        Json(request): Json<QueryHydratorBatchRequest>,
    ) -> Response {
        let expected_names = shared_query_hydrator_names();
        if request.hydrator_names != expected_names {
            return (StatusCode::NOT_FOUND, "unknown query hydrator catalog").into_response();
        }

        let items = request
            .hydrator_names
            .into_iter()
            .map(|hydrator_name| QueryHydratorPatchResponse {
                stage: stage(&hydrator_name),
                hydrator_name,
                query_patch: RecommendationQueryPatchPayload::default(),
                provider_calls: HashMap::new(),
                error_class: None,
            })
            .collect();
        Json(SuccessEnvelope::ok(QueryHydratorBatchResponse {
            items,
            provider_calls: HashMap::new(),
        }))
        .into_response()
    }

    async fn query_hydrator_handler(
        State(observations): State<Observations>,
        Path(hydrator_name): Path<String>,
        Json(query): Json<RecommendationQueryPayload>,
    ) -> Response {
        if matches!(
            hydrator_name.as_str(),
            "MutualFollowQueryHydrator" | "ExperimentQueryHydrator" | "UserStateQueryHydrator"
        ) {
            observations.lock().expect("observations lock").insert(
                hydrator_name.clone(),
                (
                    query.user_features.is_some(),
                    query.user_action_sequence.is_some(),
                    query.embedding_context.is_some(),
                ),
            );
        }

        let query_patch = match hydrator_name.as_str() {
            "UserFeaturesQueryHydrator" => {
                tokio::time::sleep(Duration::from_millis(30)).await;
                RecommendationQueryPatchPayload {
                    user_features: Some(UserFeaturesPayload {
                        followed_user_ids: vec!["author-1".to_string(), "author-2".to_string()],
                        follower_count: Some(7),
                        ..UserFeaturesPayload::default()
                    }),
                    ..RecommendationQueryPatchPayload::default()
                }
            }
            "UserActionSeqQueryHydrator" => {
                tokio::time::sleep(Duration::from_millis(10)).await;
                RecommendationQueryPatchPayload {
                    user_action_sequence: Some(vec![HashMap::from([(
                        "action".to_string(),
                        Value::String("like".to_string()),
                    )])]),
                    ..RecommendationQueryPatchPayload::default()
                }
            }
            "UserEmbeddingQueryHydrator" => RecommendationQueryPatchPayload {
                embedding_context: Some(EmbeddingContextPayload {
                    usable: true,
                    ..EmbeddingContextPayload::default()
                }),
                ..RecommendationQueryPatchPayload::default()
            },
            "MutualFollowQueryHydrator" => RecommendationQueryPatchPayload {
                mutual_follow_ids: Some(vec!["author-2".to_string()]),
                ..RecommendationQueryPatchPayload::default()
            },
            "ExperimentQueryHydrator" => RecommendationQueryPatchPayload {
                experiment_context: Some(ExperimentContextPayload {
                    user_id: query.user_id.clone(),
                    assignments: Vec::new(),
                }),
                ..RecommendationQueryPatchPayload::default()
            },
            "UserStateQueryHydrator" => RecommendationQueryPatchPayload {
                user_state_context: Some(UserStateContextPayload {
                    state: "warm".to_string(),
                    reason: "test".to_string(),
                    followed_count: 2,
                    recent_action_count: 1,
                    recent_positive_action_count: 1,
                    usable_embedding: true,
                    account_age_days: None,
                }),
                ..RecommendationQueryPatchPayload::default()
            },
            _ => RecommendationQueryPatchPayload::default(),
        };

        Json(SuccessEnvelope::ok(QueryHydratorPatchResponse {
            hydrator_name: hydrator_name.clone(),
            query_patch,
            stage: stage(&hydrator_name),
            provider_calls: HashMap::new(),
            error_class: None,
        }))
        .into_response()
    }

    async fn spawn_query_hydrator_server(observations: Observations) -> (String, JoinHandle<()>) {
        let app = Router::new()
            .route(
                "/query-hydrators/batch",
                post(|| async { (StatusCode::BAD_GATEWAY, "batch failed") }),
            )
            .route(
                "/query-hydrators/{hydrator_name}",
                post(query_hydrator_handler),
            )
            .with_state(observations);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind query hydrator provider");
        let address = listener.local_addr().expect("query hydrator provider addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve query hydrator provider");
        });
        (format!("http://{address}"), handle)
    }

    async fn spawn_contract_catalog_server() -> (String, JoinHandle<()>) {
        let app = Router::new()
            .route(
                "/query-hydrators/batch",
                post(contract_catalog_batch_handler),
            )
            .route(
                "/query-hydrators/{hydrator_name}",
                post(query_hydrator_handler),
            )
            .with_state(Observations::default());
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind query hydrator provider");
        let address = listener.local_addr().expect("query hydrator provider addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve query hydrator provider");
        });
        (format!("http://{address}"), handle)
    }

    async fn spawn_invalid_batch_server(observations: Observations) -> (String, JoinHandle<()>) {
        let app = Router::new()
            .route(
                "/query-hydrators/batch",
                post(|| async {
                    Json(SuccessEnvelope::ok(QueryHydratorBatchResponse {
                        items: vec![QueryHydratorPatchResponse {
                            hydrator_name: "UserFeaturesQueryHydrator".to_string(),
                            query_patch: RecommendationQueryPatchPayload::default(),
                            stage: stage("wrong"),
                            provider_calls: HashMap::new(),
                            error_class: None,
                        }],
                        provider_calls: HashMap::new(),
                    }))
                }),
            )
            .route(
                "/query-hydrators/{hydrator_name}",
                post(query_hydrator_handler),
            )
            .with_state(observations);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind query hydrator provider");
        let address = listener.local_addr().expect("query hydrator provider addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve query hydrator provider");
        });
        (format!("http://{address}"), handle)
    }

    fn shared_query_hydrator_names() -> Vec<String> {
        let contract: QueryHydratorContract = serde_json::from_str(include_str!(
            "../../../telegram-recommendation-fixtures/fixtures/query_hydrator_contract.json"
        ))
        .expect("parse shared query hydrator contract");
        assert_eq!(
            contract.contract_version,
            "recommendation_query_hydrator_contract_v1"
        );
        contract
            .hydrators
            .into_iter()
            .map(|entry| entry.name)
            .collect()
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

    fn fixture_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-query-stage-fallback".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
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
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
            feature_switches: HashMap::new(),
        }
    }

    fn fixture_config(base_url: String) -> RecommendationConfig {
        RecommendationConfig {
            bind_addr: "0.0.0.0:4200".to_string(),
            backend_url: base_url,
            redis_url: "redis://redis:6379".to_string(),
            internal_token: None,
            internal_token_required: false,
            timeout_ms: 1200,
            graph_kernel_enabled: false,
            graph_kernel_url: "http://graph-kernel.invalid".to_string(),
            graph_kernel_timeout_ms: 500,
            graph_materializer_limit_per_author: 2,
            graph_materializer_lookback_days: 7,
            stage: RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2.to_string(),
            retrieval_mode: RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2.to_string(),
            ranking_mode: RANKING_MODE_PHOENIX_STANDARDIZED.to_string(),
            selector_oversample_factor: 5,
            selector_max_size: 200,
            recent_per_user_capacity: 64,
            recent_global_capacity: 256,
            recent_hot_shard_count: 16,
            recent_source_enabled: true,
            source_order: Vec::new(),
            graph_source_enabled: false,
            serve_cache_enabled: false,
            serve_cache_ttl_secs: 45,
            serve_cache_prefix: "test".to_string(),
            cache_singleflight_enabled: false,
            cache_local_capacity: 8,
            serving_author_soft_cap: 2,
            news_trends_cache_enabled: false,
            news_trends_cache_ttl_secs: 60,
            news_trends_cache_prefix: "test".to_string(),
            source_cache_enabled: false,
            source_cache_ttl_secs: 300,
            source_cache_prefix: "test".to_string(),
        }
    }
}
