use std::collections::HashMap;

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
    match backend_client
        .hydrate_query_patches_batch(hydrator_names, query)
        .await
    {
        Ok(response) => {
            let mut items_by_name = response
                .payload
                .items
                .into_iter()
                .map(|item| {
                    (
                        item.hydrator_name.clone(),
                        (
                            item.stage,
                            item.query_patch,
                            item.provider_calls,
                            item.error_class,
                        ),
                    )
                })
                .collect::<HashMap<_, _>>();
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
            let mut output = hydrate_query_parallel_bounded_fallback(
                backend_client,
                hydrator_names,
                concurrency,
                query,
            )
            .await;
            output
                .degraded_reasons
                .push(format!("query:query_hydrators_batch_failed:{error}"));
            record_provider_call(
                &mut output.provider_calls,
                PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
            );
            record_provider_latency(
                &mut output.provider_latency_ms,
                PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
                0,
            );
            dedup_strings(&mut output.degraded_reasons);
            output
        }
    }
}
