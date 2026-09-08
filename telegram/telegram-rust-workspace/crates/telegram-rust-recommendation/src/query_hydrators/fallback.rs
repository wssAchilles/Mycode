use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use telegram_component_primitives::query_hydrators::{
    QUERY_HYDRATOR_BASE_STAGE, QUERY_HYDRATOR_DEPENDENT_STAGE, query_hydrator_stage,
};
use telegram_pipeline_primitives::query_hydrator_provider_key;
use tokio::sync::Semaphore;
use tokio::task::{JoinError, JoinHandle};

use crate::clients::backend_client::BackendRecommendationClient;
use crate::contracts::{RecommendationQueryPatchPayload, RecommendationQueryPayload};
use crate::pipeline::utils::record_provider_latency;

use super::merge::merge_query_hydrator_results;
use super::patch::apply_query_patch;
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
    let mut ordered_results = vec![None::<QueryHydratorResult>; hydrator_names.len()];
    let mut provider_latency_ms = HashMap::new();
    let mut dependent_query = query.clone();
    let mut dependent_query_fields = HashSet::new();

    for dependency_stage in [QUERY_HYDRATOR_BASE_STAGE, QUERY_HYDRATOR_DEPENDENT_STAGE] {
        let stage_indices = hydrator_names
            .iter()
            .enumerate()
            .filter_map(|(index, name)| {
                (query_hydrator_stage(name) == dependency_stage).then_some(index)
            })
            .collect::<Vec<_>>();
        let mut tasks = Vec::with_capacity(stage_indices.len());

        for &index in &stage_indices {
            let backend_client = backend_client.clone();
            let hydrator_name = hydrator_names[index].clone();
            let query = dependent_query.clone();
            let semaphore = semaphore.clone();
            let task = tokio::spawn(async move {
                let _permit = semaphore
                    .acquire_owned()
                    .await
                    .expect("query hydrator semaphore");
                backend_client
                    .hydrate_query_patch(&hydrator_name, &query)
                    .await
                    .map_err(|error| error.to_string())
            });
            tasks.push((index, task));
        }

        for (index, joined) in await_indexed_tasks(tasks).await {
            match joined {
                Ok(Ok(response)) => {
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
                Ok(Err(error)) => {
                    let hydrator_name = hydrator_names[index].clone();
                    ordered_results[index] = Some(Some((
                        build_query_error_stage(&hydrator_name, &error),
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
                        Some("query_hydrator_failed".to_string()),
                    )));
                }
                Err(error) => {
                    let stage = build_query_error_stage(&hydrator_names[index], &error.to_string());
                    ordered_results[index] = Some(Some((
                        stage,
                        RecommendationQueryPatchPayload::default(),
                        HashMap::new(),
                        Some("query_hydrator_join_failed".to_string()),
                    )));
                }
            }
        }

        if dependency_stage == QUERY_HYDRATOR_BASE_STAGE {
            for index in stage_indices {
                if let Some(Some((_, patch, _, _))) = ordered_results[index].as_ref() {
                    let _ =
                        apply_query_patch(&mut dependent_query, patch, &mut dependent_query_fields);
                }
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

async fn await_indexed_tasks<T>(
    tasks: Vec<(usize, JoinHandle<T>)>,
) -> Vec<(usize, Result<T, JoinError>)> {
    let mut tasks = AbortTasksOnDrop(tasks);
    let mut results = Vec::with_capacity(tasks.0.len());
    for position in 0..tasks.0.len() {
        let index = tasks.0[position].0;
        let joined = (&mut tasks.0[position].1).await;
        results.push((index, joined));
    }
    results
}

struct AbortTasksOnDrop<T>(Vec<(usize, JoinHandle<T>)>);

impl<T> Drop for AbortTasksOnDrop<T> {
    fn drop(&mut self) {
        for (_, task) in &self.0 {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::future::pending;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::await_indexed_tasks;
    use tokio::sync::Barrier;
    use tokio::time::{Duration, sleep};

    #[tokio::test]
    async fn indexed_tasks_preserve_panicked_and_cancelled_hydrator_ownership() {
        let completed = tokio::spawn(async { 11usize });
        let panicked = tokio::spawn(async {
            panic!("query hydrator panic");
        });
        let cancelled = tokio::spawn(async { pending::<usize>().await });
        cancelled.abort();

        let results =
            await_indexed_tasks(vec![(2, completed), (5, panicked), (8, cancelled)]).await;

        assert_eq!(results[0].0, 2);
        assert_eq!(*results[0].1.as_ref().expect("completed task"), 11);
        assert_eq!(results[1].0, 5);
        assert!(results[1].1.as_ref().expect_err("panicked task").is_panic());
        assert_eq!(results[2].0, 8);
        assert!(
            results[2]
                .1
                .as_ref()
                .expect_err("cancelled task")
                .is_cancelled()
        );
    }

    #[tokio::test]
    async fn aborting_parent_aborts_children_without_background_completion() {
        let started = Arc::new(Barrier::new(4));
        let completed = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();

        for index in 0..3 {
            let started = started.clone();
            let completed = completed.clone();
            tasks.push((
                index,
                tokio::spawn(async move {
                    started.wait().await;
                    sleep(Duration::from_millis(50)).await;
                    completed.fetch_add(1, Ordering::SeqCst);
                    index
                }),
            ));
        }

        let parent = tokio::spawn(async move { await_indexed_tasks(tasks).await });
        tokio::task::yield_now().await;
        started.wait().await;
        parent.abort();
        let _ = parent.await;
        sleep(Duration::from_millis(100)).await;

        assert_eq!(completed.load(Ordering::SeqCst), 0);
    }
}
