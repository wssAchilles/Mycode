use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use telegram_pipeline_primitives::{
    PROVIDER_KEY_QUERY_HYDRATORS_BATCH, PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
    query_hydrator_provider_key,
};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::contracts::{
    RecommendationQueryPatchPayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::query_hydrators::patch::apply_query_patch;
use crate::query_hydrators::stage_payload::{
    annotate_query_stage_error, annotate_query_stage_error_class, build_query_error_stage,
    query_stage_error,
};

use super::super::utils::{
    dedup_strings, merge_provider_calls, record_provider_call, record_provider_latency,
};
use super::RecommendationPipeline;

type QueryHydratorResult = Option<(
    RecommendationStagePayload,
    RecommendationQueryPatchPayload,
    HashMap<String, usize>,
    Option<String>,
)>;

impl RecommendationPipeline {
    pub(super) async fn hydrate_query_parallel_bounded(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        HashMap<String, u64>,
        Vec<String>,
    ) {
        match self
            .backend_client
            .hydrate_query_patches_batch(&self.definition.query_hydrators, query)
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
                let ordered_results = self
                    .definition
                    .query_hydrators
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

                let (hydrated_query, stages, provider_calls, degraded_reasons) =
                    self.merge_query_hydrator_results(query, ordered_results, provider_calls);

                (
                    hydrated_query,
                    stages,
                    provider_calls,
                    provider_latency_ms,
                    degraded_reasons,
                )
            }
            Err(error) => {
                let (
                    hydrated_query,
                    stages,
                    mut provider_calls,
                    mut provider_latency_ms,
                    mut degraded_reasons,
                ) = self.hydrate_query_parallel_bounded_fallback(query).await;
                degraded_reasons.push(format!("query:query_hydrators_batch_failed:{}", error));
                record_provider_call(&mut provider_calls, PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK);
                record_provider_latency(
                    &mut provider_latency_ms,
                    PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK,
                    0,
                );
                dedup_strings(&mut degraded_reasons);
                (
                    hydrated_query,
                    stages,
                    provider_calls,
                    provider_latency_ms,
                    degraded_reasons,
                )
            }
        }
    }

    async fn hydrate_query_parallel_bounded_fallback(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        HashMap<String, u64>,
        Vec<String>,
    ) {
        let concurrency = self.definition.query_hydrator_concurrency.max(1);
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let mut join_set = JoinSet::new();

        for (index, hydrator_name) in self.definition.query_hydrators.iter().enumerate() {
            let backend_client = self.backend_client.clone();
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

        let mut ordered_results = vec![
            None::<(
                RecommendationStagePayload,
                RecommendationQueryPatchPayload,
                HashMap<String, usize>,
                Option<String>,
            )>;
            self.definition.query_hydrators.len()
        ];
        let mut provider_latency_ms = HashMap::new();

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((index, Ok(response))) => {
                    record_provider_latency(
                        &mut provider_latency_ms,
                        query_hydrator_provider_key(&self.definition.query_hydrators[index]),
                        response.latency_ms,
                    );
                    ordered_results[index] = Some((
                        response.payload.stage,
                        response.payload.query_patch,
                        response.payload.provider_calls,
                        response.payload.error_class,
                    ));
                }
                Ok((index, Err(error))) => {
                    let hydrator_name = self.definition.query_hydrators[index].clone();
                    ordered_results[index] = Some((
                        build_query_error_stage(&hydrator_name, &error),
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
                        Some("query_hydrator_failed".to_string()),
                    ));
                }
                Err(error) => {
                    let stage = build_query_error_stage("query_hydrator_join", &error.to_string());
                    let index = ordered_results
                        .iter()
                        .position(Option::is_none)
                        .unwrap_or_default();
                    ordered_results[index] = Some((
                        stage,
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
                        Some("query_hydrator_join_failed".to_string()),
                    ));
                }
            }
        }

        let (hydrated_query, stages, provider_calls, degraded_reasons) =
            self.merge_query_hydrator_results(query, ordered_results, HashMap::new());
        (
            hydrated_query,
            stages,
            provider_calls,
            provider_latency_ms,
            degraded_reasons,
        )
    }

    fn merge_query_hydrator_results(
        &self,
        query: &RecommendationQueryPayload,
        ordered_results: Vec<QueryHydratorResult>,
        mut provider_calls: HashMap<String, usize>,
    ) -> (
        RecommendationQueryPayload,
        Vec<RecommendationStagePayload>,
        HashMap<String, usize>,
        Vec<String>,
    ) {
        let mut hydrated_query = query.clone();
        let mut seen_fields = HashSet::new();
        let mut stages = Vec::with_capacity(ordered_results.len());
        let mut degraded_reasons = Vec::new();

        for (index, result) in ordered_results.into_iter().enumerate() {
            let Some((mut stage, patch, patch_provider_calls, error_class)) = result else {
                let hydrator_name = self.definition.query_hydrators[index].clone();
                stages.push(build_query_error_stage(
                    &hydrator_name,
                    "query_hydrator_missing_result",
                ));
                degraded_reasons.push(format!(
                    "query:{}:query_hydrator_missing_result",
                    hydrator_name
                ));
                continue;
            };

            merge_provider_calls(&mut provider_calls, &patch_provider_calls);
            if let Some(error_class) = error_class {
                annotate_query_stage_error_class(&mut stage, error_class);
            }
            record_provider_call(
                &mut provider_calls,
                query_hydrator_provider_key(&self.definition.query_hydrators[index]),
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
        (hydrated_query, stages, provider_calls, degraded_reasons)
    }
}
