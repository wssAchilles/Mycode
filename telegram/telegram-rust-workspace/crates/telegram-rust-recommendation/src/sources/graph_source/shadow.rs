use crate::clients::graph_kernel_client::{
    GraphKernelBatchMode, GraphKernelClient, GraphKernelError,
};
use crate::contracts::{
    GraphKernelBatchQueryDiagnostics, GraphKernelBatchQueryResult, GraphKernelBatchResponse,
    GraphKernelBatchShadowComparison, RecommendationQueryPayload,
};
use crate::sources::contracts::GraphKernelTelemetry;

use super::direct::{GraphAuthorQueryResult, collect_excluded_user_ids};
use super::{DEFAULT_BRIDGE_LIMIT, DEFAULT_BRIDGE_MAX_DEPTH, DEFAULT_DIRECT_LIMIT};

pub(super) fn schedule_graph_kernel_batch_shadow_compare(
    graph_kernel_client: &GraphKernelClient,
    query: &RecommendationQueryPayload,
    primary: &mut GraphAuthorQueryResult,
) {
    if graph_kernel_client.batch_mode() != GraphKernelBatchMode::ShadowCompare {
        return;
    }

    let Some(permit) = graph_kernel_client.try_acquire_batch_shadow() else {
        let comparison = GraphKernelBatchShadowComparison {
            mode: "shadow_compare".to_string(),
            status: "dropped".to_string(),
            reason: Some("max_in_flight".to_string()),
            ..GraphKernelBatchShadowComparison::default()
        };
        log_graph_kernel_batch_shadow_observation(&query.request_id, &comparison);
        primary.telemetry.batch_shadow_compare = Some(comparison);
        return;
    };

    *primary
        .provider_calls
        .entry("graph_kernel/batch_shadow_compare".to_string())
        .or_insert(0) += 1;
    let excluded_user_ids = collect_excluded_user_ids(query);
    primary.telemetry.batch_shadow_compare = Some(GraphKernelBatchShadowComparison {
        mode: "shadow_compare".to_string(),
        status: "scheduled".to_string(),
        ..GraphKernelBatchShadowComparison::default()
    });

    let graph_kernel_client = graph_kernel_client.clone();
    let user_id = query.user_id.clone();
    let request_id = query.request_id.clone();
    let primary_telemetry = primary.telemetry.clone();
    tokio::spawn(async move {
        let comparison = match graph_kernel_client
            .batch(
                &user_id,
                DEFAULT_DIRECT_LIMIT,
                DEFAULT_BRIDGE_LIMIT,
                DEFAULT_BRIDGE_MAX_DEPTH,
                &excluded_user_ids,
            )
            .await
        {
            Ok(batch) => compare_graph_kernel_batch(&primary_telemetry, &batch),
            Err(error) => failed_graph_kernel_batch_shadow_comparison(error),
        };
        log_graph_kernel_batch_shadow_observation(&request_id, &comparison);
        drop(permit);
    });
}

fn failed_graph_kernel_batch_shadow_comparison(
    error: GraphKernelError,
) -> GraphKernelBatchShadowComparison {
    GraphKernelBatchShadowComparison {
        mode: "shadow_compare".to_string(),
        status: "failed".to_string(),
        error_class: Some(error.class().to_string()),
        error: Some(error.to_string()),
        ..GraphKernelBatchShadowComparison::default()
    }
}

fn log_graph_kernel_batch_shadow_observation(
    request_id: &str,
    comparison: &GraphKernelBatchShadowComparison,
) {
    tracing::info!(
        target: "recommendation.graph_batch_shadow",
        request_id = %request_id,
        mode = %comparison.mode,
        status = %comparison.status,
        error_class = comparison.error_class.as_deref().unwrap_or("none"),
        reason = comparison.reason.as_deref().unwrap_or("none"),
        observation = %serde_json::to_string(comparison).unwrap_or_default(),
        "graph kernel batch shadow observation"
    );
}

fn compare_graph_kernel_batch(
    telemetry: &GraphKernelTelemetry,
    batch: &GraphKernelBatchResponse,
) -> GraphKernelBatchShadowComparison {
    let mut legacy_snapshot_versions = telemetry
        .per_kernel_snapshot_versions
        .values()
        .cloned()
        .collect::<Vec<_>>();
    legacy_snapshot_versions.sort();
    legacy_snapshot_versions.dedup();
    let mut comparison = GraphKernelBatchShadowComparison {
        mode: "shadow_compare".to_string(),
        status: "completed".to_string(),
        batch_snapshot_version: Some(batch.snapshot_version.clone()),
        batch_snapshot_loaded_at_ms: Some(batch.snapshot_loaded_at_ms),
        version_drift: Some(
            legacy_snapshot_versions.len() != 1
                || legacy_snapshot_versions[0] != batch.snapshot_version,
        ),
        legacy_snapshot_versions,
        ..GraphKernelBatchShadowComparison::default()
    };

    record_batch_result_drift(
        "social_neighbors",
        &batch.social_neighbors,
        telemetry,
        &mut comparison,
    );
    record_batch_result_drift(
        "recent_engagers",
        &batch.recent_engagers,
        telemetry,
        &mut comparison,
    );
    record_batch_result_drift(
        "bridge_users",
        &batch.bridge_users,
        telemetry,
        &mut comparison,
    );
    record_batch_result_drift(
        "co_engagers",
        &batch.co_engagers,
        telemetry,
        &mut comparison,
    );
    record_batch_result_drift(
        "content_affinity_neighbors",
        &batch.content_affinity_neighbors,
        telemetry,
        &mut comparison,
    );
    comparison
}

fn record_batch_result_drift<T>(
    kernel: &str,
    batch: &GraphKernelBatchQueryResult<T>,
    telemetry: &GraphKernelTelemetry,
    comparison: &mut GraphKernelBatchShadowComparison,
) {
    let primary_count = telemetry
        .per_kernel_returned_counts
        .get(kernel)
        .copied()
        .unwrap_or_default();
    comparison.count_drift.insert(
        kernel.to_string(),
        batch.candidates.len() as i64 - primary_count as i64,
    );

    let drift = diagnostic_drift_fields(kernel, &batch.diagnostics, telemetry);
    if !drift.is_empty() {
        comparison
            .diagnostic_drift
            .insert(kernel.to_string(), drift);
    }
}

fn diagnostic_drift_fields(
    kernel: &str,
    diagnostics: &GraphKernelBatchQueryDiagnostics,
    telemetry: &GraphKernelTelemetry,
) -> Vec<String> {
    let mut drift = Vec::new();
    if telemetry.per_kernel_candidate_counts.get(kernel) != Some(&diagnostics.candidate_count) {
        drift.push("candidateCount".to_string());
    }
    if telemetry.per_kernel_truncated_counts.get(kernel) != Some(&diagnostics.truncated_count) {
        drift.push("truncatedCount".to_string());
    }
    if telemetry.per_kernel_scanned_counts.get(kernel) != Some(&diagnostics.scanned_count) {
        drift.push("scannedCount".to_string());
    }
    if telemetry.per_kernel_visited_counts.get(kernel) != Some(&diagnostics.visited_count) {
        drift.push("visitedCount".to_string());
    }
    if telemetry.per_kernel_snapshot_versions.get(kernel) != Some(&diagnostics.snapshot_version) {
        drift.push("snapshotVersion".to_string());
    }
    if telemetry.per_kernel_snapshot_loaded_at_ms.get(kernel)
        != Some(&diagnostics.snapshot_loaded_at_ms)
    {
        drift.push("snapshotLoadedAtMs".to_string());
    }
    let primary_budget_exhausted = telemetry
        .budget_exhausted_kernels
        .iter()
        .any(|value| value == kernel);
    if primary_budget_exhausted != diagnostics.budget_exhausted {
        drift.push("budgetExhausted".to_string());
    }
    drift
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::Notify;

    use crate::clients::graph_kernel_client::{
        GraphKernelBatchMode, GraphKernelClient, GraphKernelError,
    };
    use crate::contracts::RecommendationQueryPayload;

    use super::super::direct::query_graph_kernel_authors_with_budget;
    use super::{
        failed_graph_kernel_batch_shadow_comparison, schedule_graph_kernel_batch_shadow_compare,
    };

    async fn spawn_graph_server(
        batch_hangs: bool,
    ) -> (String, Arc<Mutex<Vec<String>>>, Arc<Notify>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind graph test server");
        let address = listener.local_addr().expect("graph test server address");
        let paths = Arc::new(Mutex::new(Vec::new()));
        let recorded_paths = Arc::clone(&paths);
        let batch_arrived = Arc::new(Notify::new());
        let notify_batch_arrived = Arc::clone(&batch_arrived);
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let recorded_paths = Arc::clone(&recorded_paths);
                let notify_batch_arrived = Arc::clone(&notify_batch_arrived);
                tokio::spawn(async move {
                    let mut buffer = [0_u8; 4096];
                    let read = stream.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    let path = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("")
                        .to_string();
                    recorded_paths
                        .lock()
                        .expect("record graph path")
                        .push(path.clone());

                    if path == "/graph/batch" {
                        notify_batch_arrived.notify_one();
                    }
                    if path == "/graph/batch" && batch_hangs {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        return;
                    }
                    let (status, body) = if path == "/graph/batch" {
                        (
                            "503 Service Unavailable",
                            r#"{"success":false,"error":{"message":"batch unavailable"}}"#
                                .to_string(),
                        )
                    } else {
                        let kernel = path.trim_start_matches("/graph/").replace('-', "_");
                        let candidates = if path == "/graph/social-neighbors" {
                            r#"[{"userId":"author-1","score":0.9,"relationKinds":["follow"]}]"#
                        } else {
                            "[]"
                        };
                        (
                            "200 OK",
                            format!(
                                r#"{{"success":true,"data":{{"candidates":{candidates},"diagnostics":{{"kernel":"{kernel}","queryDurationMs":1,"candidateCount":1,"snapshotVersion":"snapshot-v7","snapshotLoadedAtMs":1783278000000,"scannedCount":3,"visitedCount":0,"empty":false}}}}}}"#,
                            ),
                        )
                    };
                    let response = format!(
                        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len(),
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        (format!("http://{address}"), paths, batch_arrived)
    }

    fn graph_client(base_url: String) -> GraphKernelClient {
        GraphKernelClient::new(base_url, 1_000)
    }

    fn query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-budget".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            feature_switches: HashMap::new(),
            ..RecommendationQueryPayload::default()
        }
    }

    #[test]
    fn failed_batch_shadow_observation_has_stable_error_class() {
        let comparison = failed_graph_kernel_batch_shadow_comparison(GraphKernelError::Timeout {
            path: "/graph/batch".to_string(),
        });

        assert_eq!(comparison.status, "failed");
        assert_eq!(comparison.error_class.as_deref(), Some("timeout"));
    }

    #[tokio::test]
    async fn disabled_batch_mode_does_not_call_batch() {
        let (base_url, paths, _) = spawn_graph_server(false).await;
        let client = graph_client(base_url);
        let mut result =
            query_graph_kernel_authors_with_budget(client.clone(), &query(), 1_000).await;

        schedule_graph_kernel_batch_shadow_compare(&client, &query(), &mut result);

        assert_eq!(result.author_aggregates.len(), 1);
        assert!(
            paths
                .lock()
                .expect("read graph paths")
                .iter()
                .all(|path| path != "/graph/batch")
        );
        assert!(result.telemetry.batch_shadow_compare.is_none());
    }

    #[tokio::test]
    async fn hanging_batch_shadow_does_not_delay_or_change_primary_results() {
        let (base_url, _, batch_arrived) = spawn_graph_server(true).await;
        let client = graph_client(base_url).with_batch_mode(GraphKernelBatchMode::ShadowCompare);
        let mut result =
            query_graph_kernel_authors_with_budget(client.clone(), &query(), 1_000).await;
        let primary_author_ids = result
            .author_aggregates
            .iter()
            .map(|author| author.user_id.clone())
            .collect::<Vec<_>>();

        schedule_graph_kernel_batch_shadow_compare(&client, &query(), &mut result);

        assert_eq!(
            result
                .author_aggregates
                .iter()
                .map(|author| author.user_id.clone())
                .collect::<Vec<_>>(),
            primary_author_ids
        );
        assert!(result.query_errors.is_empty());
        tokio::time::timeout(Duration::from_secs(1), batch_arrived.notified())
            .await
            .expect("batch shadow request scheduled");
        assert_eq!(
            result
                .telemetry
                .batch_shadow_compare
                .as_ref()
                .map(|comparison| comparison.status.as_str()),
            Some("scheduled")
        );
    }

    #[tokio::test]
    async fn second_hanging_batch_shadow_is_dropped_by_shared_admission() {
        let (base_url, paths, batch_arrived) = spawn_graph_server(true).await;
        let client = graph_client(base_url)
            .with_batch_mode(GraphKernelBatchMode::ShadowCompare)
            .with_batch_shadow_max_in_flight(1);
        let mut first =
            query_graph_kernel_authors_with_budget(client.clone(), &query(), 1_000).await;
        let mut second =
            query_graph_kernel_authors_with_budget(client.clone(), &query(), 1_000).await;

        schedule_graph_kernel_batch_shadow_compare(&client, &query(), &mut first);
        schedule_graph_kernel_batch_shadow_compare(&client, &query(), &mut second);

        assert_eq!(first.author_aggregates.len(), 1);
        assert_eq!(second.author_aggregates.len(), 1);
        assert_eq!(
            first
                .telemetry
                .batch_shadow_compare
                .as_ref()
                .map(|comparison| comparison.status.as_str()),
            Some("scheduled")
        );
        let dropped = second
            .telemetry
            .batch_shadow_compare
            .as_ref()
            .expect("dropped batch shadow observation");
        assert_eq!(dropped.status, "dropped");
        assert_eq!(dropped.reason.as_deref(), Some("max_in_flight"));
        tokio::time::timeout(Duration::from_secs(1), batch_arrived.notified())
            .await
            .expect("one batch shadow request scheduled");
        assert_eq!(
            paths
                .lock()
                .expect("read graph paths")
                .iter()
                .filter(|path| path.as_str() == "/graph/batch")
                .count(),
            1
        );
    }
}
