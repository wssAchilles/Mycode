use std::collections::HashMap;
use std::time::Instant;

use anyhow::Result;
use telegram_pipeline_primitives::source_provider_key;

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

pub(super) struct GraphFallbackRequest<'a> {
    pub(super) query: &'a RecommendationQueryPayload,
    pub(super) start: Instant,
    pub(super) fallback_reason: Option<String>,
    pub(super) provider_calls: HashMap<String, usize>,
    pub(super) provider_latency_ms: HashMap<String, u64>,
    pub(super) telemetry: GraphKernelTelemetry,
    pub(super) materializer_retry: MaterializerRetryDetail,
    pub(super) materializer_telemetry: MaterializerTelemetry,
}

impl GraphSourceRuntime {
    pub(super) async fn fallback_to_backend(
        &self,
        mut fallback: GraphFallbackRequest<'_>,
    ) -> Result<GraphSourceExecution> {
        let response = self
            .backend_client
            .source_candidates(GRAPH_SOURCE_NAME, fallback.query)
            .await?;
        let provider_key = source_provider_key(GRAPH_SOURCE_NAME);
        *fallback
            .provider_calls
            .entry(provider_key.clone())
            .or_insert(0) += 1;
        *fallback
            .provider_latency_ms
            .entry(provider_key)
            .or_insert(0) += response.latency_ms;

        let normalized_candidates =
            normalize_source_candidates(GRAPH_SOURCE_NAME, response.payload.candidates);
        let mut breakdown = classify_graph_retrieval(
            &normalized_candidates,
            true,
            &fallback.telemetry,
            fallback.fallback_reason.as_deref(),
        );
        apply_materializer_telemetry(&mut breakdown, &fallback.materializer_telemetry);
        let mut detail = response.payload.stage.detail.clone().unwrap_or_default();
        detail.extend(build_graph_source_detail(
            "node_provider_surface",
            "node_graph_author_provider",
            &fallback.telemetry,
            &[],
            Some("cpp_graph_kernel_primary"),
            fallback.fallback_reason.as_deref(),
            &breakdown,
        ));
        insert_materializer_retry_detail(&mut detail, &fallback.materializer_retry);
        insert_materializer_telemetry_detail(&mut detail, &fallback.materializer_telemetry);

        Ok(GraphSourceExecution {
            stage: RecommendationStagePayload {
                name: response.payload.stage.name,
                enabled: response.payload.stage.enabled,
                duration_ms: fallback.start.elapsed().as_millis() as u64,
                input_count: response.payload.stage.input_count,
                output_count: response.payload.stage.output_count,
                removed_count: response.payload.stage.removed_count,
                detail: Some(detail),
            },
            candidates: normalized_candidates,
            provider_calls: fallback.provider_calls,
            provider_latency_ms: fallback.provider_latency_ms,
            breakdown,
        })
    }
}
