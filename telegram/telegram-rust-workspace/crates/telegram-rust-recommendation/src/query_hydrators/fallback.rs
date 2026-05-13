use std::collections::HashMap;
use std::sync::Arc;

use telegram_pipeline_primitives::query_hydrator_provider_key;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::clients::backend_client::BackendRecommendationClient;
use crate::contracts::{RecommendationQueryPatchPayload, RecommendationQueryPayload};
use crate::pipeline::utils::record_provider_latency;

use super::merge::merge_query_hydrator_results;
use super::stage_payload::build_query_error_stage;
use super::types::{QueryHydrationOutput, QueryHydratorResult};

pub(crate) async fn hydrate_query_parallel_bounded_fallback(
    backend_client: &BackendRecommendationClient,
    hydrator_names: &[String],
    concurrency: usize,
    query: &RecommendationQueryPayload,
) -> QueryHydrationOutput {
    let concurrency = concurrency.max(1);
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let mut join_set = JoinSet::new();

    for (index, hydrator_name) in hydrator_names.iter().enumerate() {
        let backend_client = backend_client.clone();
        let hydrator_name = hydrator_name.clone();
        let query = query.clone();
        let semaphore = semaphore.clone();
        join_set.spawn(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .expect("query hydrator semaphore");
            (
                index,
                backend_client
                    .hydrate_query_patch(&hydrator_name, &query)
                    .await
                    .map_err(|error| error.to_string()),
            )
        });
    }

    let mut ordered_results = vec![None::<QueryHydratorResult>; hydrator_names.len()];
    let mut provider_latency_ms = HashMap::new();

    while let Some(joined) = join_set.join_next().await {
        match joined {
            Ok((index, Ok(response))) => {
                record_provider_latency(
                    &mut provider_latency_ms,
                    query_hydrator_provider_key(&hydrator_names[index]),
                    response.latency_ms,
                );
                ordered_results[index] = Some(Some((
                    response.payload.stage,
                    response.payload.query_patch,
                    response.payload.provider_calls,
                    response.payload.error_class,
                )));
            }
            Ok((index, Err(error))) => {
                let hydrator_name = hydrator_names[index].clone();
                ordered_results[index] = Some(Some((
                    build_query_error_stage(&hydrator_name, &error),
                    RecommendationQueryPatchPayload::default(),
                    HashMap::new(),
                    Some("query_hydrator_failed".to_string()),
                )));
            }
            Err(error) => {
                let stage = build_query_error_stage("query_hydrator_join", &error.to_string());
                let index = ordered_results
                    .iter()
                    .position(Option::is_none)
                    .unwrap_or_default();
                ordered_results[index] = Some(Some((
                    stage,
                    RecommendationQueryPatchPayload::default(),
                    HashMap::new(),
                    Some("query_hydrator_join_failed".to_string()),
                )));
            }
        }
    }

    merge_query_hydrator_results(
        query,
        hydrator_names,
        ordered_results
            .into_iter()
            .map(Option::unwrap_or_default)
            .collect(),
        HashMap::new(),
        provider_latency_ms,
    )
}
