use std::collections::HashMap;

use crate::contracts::RecommendationCandidatePayload;

use super::detail::build_materializer_telemetry;
use super::{
    GraphSourceRuntime, MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR,
    MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS,
};

#[derive(Debug, Clone, Default)]
pub(super) struct MaterializerRetryDetail {
    pub(super) applied: bool,
    pub(super) recovered: bool,
    pub(super) lookback_days: Option<usize>,
    pub(super) limit_per_author: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct MaterializerTelemetry {
    pub(super) query_duration_ms: Option<u64>,
    pub(super) provider_latency_ms: Option<u64>,
    pub(super) cache_hit: Option<bool>,
    pub(super) requested_author_count: Option<usize>,
    pub(super) unique_author_count: Option<usize>,
    pub(super) returned_post_count: Option<usize>,
    pub(super) cache_key_mode: Option<String>,
    pub(super) cache_ttl_ms: Option<u64>,
    pub(super) cache_entry_count: Option<usize>,
    pub(super) cache_eviction_count: Option<u64>,
}

pub(super) struct GraphMaterializationResult {
    pub(super) candidates: Vec<RecommendationCandidatePayload>,
    pub(super) provider_calls: HashMap<String, usize>,
    pub(super) provider_latency_ms: HashMap<String, u64>,
    pub(super) retry: MaterializerRetryDetail,
    pub(super) telemetry: MaterializerTelemetry,
    pub(super) fallback_reason: Option<String>,
}

impl GraphSourceRuntime {
    pub(super) async fn materialize_graph_author_candidates(
        &self,
        author_ids: &[String],
    ) -> GraphMaterializationResult {
        let mut provider_calls = HashMap::new();
        let mut provider_latency_ms = HashMap::new();
        let mut retry = MaterializerRetryDetail::default();
        let mut telemetry = MaterializerTelemetry::default();

        let mut candidates = match self
            .backend_client
            .graph_author_candidates(
                author_ids,
                self.materializer_limit_per_author,
                self.materializer_lookback_days,
            )
            .await
        {
            Ok(response) => {
                *provider_calls
                    .entry("providers/graph/authors".to_string())
                    .or_insert(0) += 1;
                *provider_latency_ms
                    .entry("providers/graph/authors".to_string())
                    .or_insert(0) += response.latency_ms;
                telemetry = build_materializer_telemetry(
                    response.payload.diagnostics.as_ref(),
                    response.latency_ms,
                );
                response.payload.candidates
            }
            Err(_error) => {
                return GraphMaterializationResult {
                    candidates: Vec::new(),
                    provider_calls,
                    provider_latency_ms,
                    retry,
                    telemetry,
                    fallback_reason: Some("graph_author_materializer_failed".to_string()),
                };
            }
        };

        if candidates.is_empty() {
            retry.applied = true;
            retry.lookback_days = Some(materializer_retry_lookback_days(
                self.materializer_lookback_days,
            ));
            retry.limit_per_author = Some(materializer_retry_limit_per_author(
                self.materializer_limit_per_author,
            ));
            let retry_limit = retry
                .limit_per_author
                .unwrap_or(self.materializer_limit_per_author);
            let retry_lookback = retry
                .lookback_days
                .unwrap_or(self.materializer_lookback_days);

            match self
                .backend_client
                .graph_author_candidates(author_ids, retry_limit, retry_lookback)
                .await
            {
                Ok(response) => {
                    *provider_calls
                        .entry("providers/graph/authors_retry".to_string())
                        .or_insert(0) += 1;
                    *provider_latency_ms
                        .entry("providers/graph/authors_retry".to_string())
                        .or_insert(0) += response.latency_ms;
                    telemetry = build_materializer_telemetry(
                        response.payload.diagnostics.as_ref(),
                        response.latency_ms,
                    );
                    retry.recovered = !response.payload.candidates.is_empty();
                    candidates = response.payload.candidates;
                }
                Err(_error) => {
                    return GraphMaterializationResult {
                        candidates: Vec::new(),
                        provider_calls,
                        provider_latency_ms,
                        retry,
                        telemetry,
                        fallback_reason: Some("graph_author_materializer_retry_failed".to_string()),
                    };
                }
            }
        }

        GraphMaterializationResult {
            candidates,
            provider_calls,
            provider_latency_ms,
            retry,
            telemetry,
            fallback_reason: None,
        }
    }
}

pub(super) fn materializer_retry_limit_per_author(current_limit: usize) -> usize {
    (current_limit.max(2) * 2).min(MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR)
}

pub(super) fn materializer_retry_lookback_days(_current_lookback_days: usize) -> usize {
    MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS
}
