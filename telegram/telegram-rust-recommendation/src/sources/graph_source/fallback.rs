use std::collections::HashMap;
use std::time::Instant;

use anyhow::Result;

use crate::contracts::{RecommendationQueryPayload, RecommendationStagePayload};
use crate::sources::contracts::{
    GraphKernelTelemetry, classify_graph_retrieval, normalize_source_candidates,
};

use super::detail::{
    apply_materializer_telemetry, build_graph_source_detail, insert_materializer_retry_detail,
    insert_materializer_telemetry_detail,
};
use super::materialization::{MaterializerRetryDetail, MaterializerTelemetry};
use super::{GRAPH_SOURCE_NAME, GraphSourceExecution, GraphSourceRuntime};

impl GraphSourceRuntime {
    pub(super) async fn fallback_to_backend(
        &self,
        query: &RecommendationQueryPayload,
        start: Instant,
        fallback_reason: Option<String>,
        mut provider_calls: HashMap<String, usize>,
        mut provider_latency_ms: HashMap<String, u64>,
        telemetry: GraphKernelTelemetry,
        materializer_retry: MaterializerRetryDetail,
        materializer_telemetry: MaterializerTelemetry,
    ) -> Result<GraphSourceExecution> {
        let response = self
            .backend_client
            .source_candidates(GRAPH_SOURCE_NAME, query)
            .await?;
        *provider_calls
            .entry("sources/GraphSource".to_string())
            .or_insert(0) += 1;
        *provider_latency_ms
            .entry("sources/GraphSource".to_string())
            .or_insert(0) += response.latency_ms;

        let normalized_candidates =
            normalize_source_candidates(GRAPH_SOURCE_NAME, response.payload.candidates);
        let mut breakdown = classify_graph_retrieval(
            &normalized_candidates,
            true,
            &telemetry,
            fallback_reason.as_deref(),
        );
        apply_materializer_telemetry(&mut breakdown, &materializer_telemetry);
        let mut detail = response.payload.stage.detail.clone().unwrap_or_default();
        detail.extend(build_graph_source_detail(
            "node_provider_surface",
            "node_graph_author_provider",
            &telemetry,
            &[],
            Some("cpp_graph_kernel_primary"),
            fallback_reason.as_deref(),
            &breakdown,
        ));
        insert_materializer_retry_detail(&mut detail, &materializer_retry);
        insert_materializer_telemetry_detail(&mut detail, &materializer_telemetry);

        Ok(GraphSourceExecution {
            stage: RecommendationStagePayload {
                name: response.payload.stage.name,
                enabled: response.payload.stage.enabled,
                duration_ms: start.elapsed().as_millis() as u64,
                input_count: response.payload.stage.input_count,
                output_count: response.payload.stage.output_count,
                removed_count: response.payload.stage.removed_count,
                detail: Some(detail),
            },
            candidates: normalized_candidates,
            provider_calls,
            provider_latency_ms,
            breakdown,
        })
    }
}
