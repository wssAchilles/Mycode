use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use serde_json::json;
use tracing::error;

use crate::candidate_pipeline::{
    boundary::validate_pipeline_boundaries, manifest::build_stage_manifest,
};
use crate::config::RecommendationConfig;
use crate::contracts::algorithm::ALGORITHM_CONTRACT_VERSION;
use crate::contracts::ops::RecommendationPipelineStageManifestEntry;
use crate::contracts::{
    RecommendationOpsRuntime, RecommendationQueryPayload, RecommendationResultPayload,
};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::pipeline::local::ranking::RANKING_SCORE_ROLE_VERSION;
use crate::runtime::versions::{
    CONTRACT_VERSION_CATALOG_VERSION, WORKSPACE_MIGRATION_PREP_VERSION, WORKSPACE_MIGRATION_STATE,
};
use crate::selectors::top_k::{
    SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_SCORE_SOURCE_VERSION,
};
use crate::sources::contracts::SOURCE_CONTRACT_VERSION;
use crate::sources::{NEWS_ANN_SOURCE, source_descriptor};

use super::auth::require_internal_token;
use super::state::AppState;
use super::types::{
    HealthResponse, ReadinessCheckResponse, ReadinessResponse, RecommendationOpsResponse,
    RecommendationOpsSummaryResponse,
};

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "rust_recommendation",
        stage: state.config.stage.clone(),
    })
}

pub async fn recommendation_candidates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(query): Json<RecommendationQueryPayload>,
) -> Result<Json<RecommendationResultPayload>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    match state.pipeline.run(query.clone()).await {
        Ok(result) => {
            let mut metrics = state.metrics.lock().await;
            metrics.record_success(&result.summary);
            Ok(Json(result))
        }
        Err(error) => {
            error!(
                request_id = %query.request_id,
                err = ?error,
                "recommendation pipeline failed"
            );
            let mut metrics = state.metrics.lock().await;
            metrics.record_failure(Some(&query.request_id), &error.to_string());
            Err((
                StatusCode::BAD_GATEWAY,
                format!("recommendation_pipeline_failed: {error}"),
            ))
        }
    }
}

pub async fn recommendation_readiness(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ReadinessResponse>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let definition = state.pipeline.definition();
    let graph_provider_mode = definition.graph_provider_mode(&state.config);
    let manifest = build_stage_manifest(definition, &graph_provider_mode);
    let checks = build_readiness_checks(&state.config, definition, &manifest);
    let ok = checks.iter().all(|check| check.ok);

    Ok(Json(ReadinessResponse {
        ok,
        status: if ok { "ready" } else { "degraded" },
        service: "rust_recommendation",
        stage: state.config.stage.clone(),
        manifest_entry_count: manifest.len(),
        checks,
    }))
}

pub async fn recommendation_ops(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RecommendationOpsResponse>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let recent_snapshot = {
        let store = state.recent_store.lock().await;
        store.snapshot()
    };
    let summary = {
        let metrics = state.metrics.lock().await;
        metrics.build_summary(&state.config.stage, recent_snapshot.clone())
    };

    Ok(Json(RecommendationOpsResponse {
        status: summary.status.clone(),
        runtime: build_runtime(&state.config, state.pipeline.definition()),
        summary,
        recent_store: recent_snapshot,
    }))
}

pub async fn recommendation_ops_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RecommendationOpsSummaryResponse>, (StatusCode, String)> {
    require_internal_token(&state.config, &headers)?;

    let recent_snapshot = {
        let store = state.recent_store.lock().await;
        store.snapshot()
    };
    let summary = {
        let metrics = state.metrics.lock().await;
        metrics.build_summary(&state.config.stage, recent_snapshot)
    };

    Ok(Json(RecommendationOpsSummaryResponse {
        runtime: build_runtime(&state.config, state.pipeline.definition()),
        summary,
    }))
}

pub fn build_runtime(
    config: &RecommendationConfig,
    definition: &RecommendationPipelineDefinition,
) -> RecommendationOpsRuntime {
    let graph_provider_mode = definition.graph_provider_mode(config);

    RecommendationOpsRuntime {
        stage: config.stage.clone(),
        backend_url: config.backend_url.clone(),
        redis_url: redact_url_credentials(&config.redis_url),
        retrieval_mode: config.retrieval_mode.clone(),
        ranking_mode: config.ranking_mode.clone(),
        serving_version: definition.serving_version.clone(),
        cursor_mode: definition.cursor_mode.clone(),
        stage_execution_mode: definition.stage_execution_mode.clone(),
        runtime_contract_version: definition.runtime_contract_version.clone(),
        contract_version_catalog_version: CONTRACT_VERSION_CATALOG_VERSION.to_string(),
        pipeline_boundary_version: crate::candidate_pipeline::boundary::PIPELINE_BOUNDARY_VERSION
            .to_string(),
        workspace_migration_prep_version: WORKSPACE_MIGRATION_PREP_VERSION.to_string(),
        workspace_migration_state: WORKSPACE_MIGRATION_STATE.to_string(),
        algorithm_contract_version: ALGORITHM_CONTRACT_VERSION.to_string(),
        source_contract_version: SOURCE_CONTRACT_VERSION.to_string(),
        component_order_hash: definition.component_order_hash.clone(),
        query_hydrator_execution_mode: definition.query_hydrator_execution_mode.clone(),
        source_execution_mode: definition.source_execution_mode.clone(),
        candidate_hydrator_execution_mode: definition.candidate_hydrator_execution_mode.clone(),
        post_selection_hydrator_execution_mode: definition
            .post_selection_hydrator_execution_mode
            .clone(),
        query_hydrator_transport_mode: definition.query_hydrator_transport_mode.clone(),
        source_transport_mode: definition.source_transport_mode.clone(),
        candidate_hydrator_transport_mode: definition.candidate_hydrator_transport_mode.clone(),
        post_selection_hydrator_transport_mode: definition
            .post_selection_hydrator_transport_mode
            .clone(),
        provider_latency_mode: definition.provider_latency_mode.clone(),
        graph_materializer_cache_mode: definition.graph_materializer_cache_mode.clone(),
        source_policy_mode: definition.source_policy_mode.clone(),
        ranking_ladder_version: definition.ranking_ladder_version.clone(),
        ranking_score_role_version: RANKING_SCORE_ROLE_VERSION.to_string(),
        selector_policy_version: definition.selector_policy_version.clone(),
        selector_audit_version: SELECTOR_AUDIT_VERSION.to_string(),
        selector_constraint_version: SELECTOR_CONSTRAINT_VERSION.to_string(),
        selector_score_source_version: SELECTOR_SCORE_SOURCE_VERSION.to_string(),
        guardrail_mode: definition.guardrail_mode.clone(),
        provider_latency_budget_ms: definition.provider_latency_budget_ms,
        source_batch_component_timeout_ms: definition.source_batch_component_timeout_ms,
        query_hydrator_concurrency: definition.query_hydrator_concurrency,
        source_concurrency: definition.source_concurrency,
        candidate_hydrator_concurrency: definition.candidate_hydrator_concurrency,
        post_selection_hydrator_concurrency: definition.post_selection_hydrator_concurrency,
        pipeline_version: definition.pipeline_version.clone(),
        algorithm_version: definition.algorithm_version.clone(),
        owner: definition.owner.clone(),
        algorithm_growth_policy: definition.algorithm_growth_policy.clone(),
        node_baseline_role: definition.node_baseline_role.clone(),
        fallback_mode: definition.fallback_mode.clone(),
        graph_provider_mode: graph_provider_mode.clone(),
        graph_kernel_url: config.graph_kernel_url.clone(),
        query_hydrators: definition.query_hydrators.clone(),
        source_order: definition.sources.clone(),
        candidate_hydrators: definition.candidate_hydrators.clone(),
        filters: definition.filters.clone(),
        scorers: definition.scorers.clone(),
        selectors: definition.selectors.clone(),
        post_selection_hydrators: definition.post_selection_hydrators.clone(),
        post_selection_filters: definition.post_selection_filters.clone(),
        side_effects: definition.side_effects.clone(),
        graph_source_enabled: config.graph_source_enabled,
        graph_materializer_limit_per_author: config.graph_materializer_limit_per_author,
        graph_materializer_lookback_days: config.graph_materializer_lookback_days,
        recent_global_capacity: config.recent_global_capacity,
        recent_per_user_capacity: config.recent_per_user_capacity,
        selector_oversample_factor: config.selector_oversample_factor,
        selector_max_size: config.selector_max_size,
        serve_cache_enabled: config.serve_cache_enabled,
        serve_cache_ttl_secs: config.serve_cache_ttl_secs,
        serve_cache_prefix: config.serve_cache_prefix.clone(),
        serve_cache_key_mode: definition.serve_cache_key_mode.clone(),
        serve_cache_policy_mode: definition.serve_cache_policy_mode.clone(),
        async_side_effect_mode: definition.async_side_effect_mode.clone(),
        pipeline_stage_manifest: build_stage_manifest(definition, &graph_provider_mode),
        serving_author_soft_cap: config.serving_author_soft_cap,
    }
}

fn redact_url_credentials(url: &str) -> String {
    if let Some((_, rest)) = url.rsplit_once('@') {
        return format!("***@{rest}");
    }
    url.to_string()
}

fn build_readiness_checks(
    config: &RecommendationConfig,
    definition: &RecommendationPipelineDefinition,
    manifest: &[RecommendationPipelineStageManifestEntry],
) -> Vec<ReadinessCheckResponse> {
    let source_registry_ok = definition
        .sources
        .iter()
        .all(|source| source_descriptor(source).is_some());
    let news_ann_online_allowed =
        source_descriptor(NEWS_ANN_SOURCE).is_some_and(|descriptor| descriptor.online_allowed);
    let news_ann_manifest_disabled = manifest
        .iter()
        .find(|entry| entry.stage == "sources" && entry.component == NEWS_ANN_SOURCE)
        .is_none_or(|entry| !entry.online_allowed && !entry.enabled);

    vec![
        readiness_check(
            "backend",
            !config.backend_url.trim().is_empty(),
            [("url", json!(config.backend_url))],
        ),
        readiness_check(
            "redis",
            !config.redis_url.trim().is_empty(),
            [
                ("configured", json!(!config.redis_url.trim().is_empty())),
                ("serveCacheEnabled", json!(config.serve_cache_enabled)),
            ],
        ),
        readiness_check(
            "graph",
            !config.graph_source_enabled
                || (!config.graph_kernel_url.trim().is_empty() && config.graph_kernel_enabled),
            [
                ("graphSourceEnabled", json!(config.graph_source_enabled)),
                ("graphKernelEnabled", json!(config.graph_kernel_enabled)),
                ("graphKernelUrl", json!(config.graph_kernel_url)),
            ],
        ),
        readiness_check(
            "source_registry",
            source_registry_ok && !news_ann_online_allowed && news_ann_manifest_disabled,
            [
                ("registeredSourceCount", json!(definition.sources.len())),
                ("newsAnnOnlineAllowed", json!(news_ann_online_allowed)),
                ("newsAnnManifestDisabled", json!(news_ann_manifest_disabled)),
            ],
        ),
        readiness_check(
            "policy_manifest",
            !manifest.is_empty()
                && manifest.iter().all(|entry| {
                    entry.stage != "sources"
                        || source_descriptor(&entry.component).is_none()
                        || (entry.lane.is_some()
                            && entry.cost_class.is_some()
                            && entry.readiness_impact.is_some())
                }),
            [
                ("entryCount", json!(manifest.len())),
                (
                    "runtimeContractVersion",
                    json!(definition.runtime_contract_version),
                ),
            ],
        ),
        readiness_check(
            "pipeline_boundaries",
            validate_pipeline_boundaries(definition, manifest).is_ok(),
            [
                (
                    "boundaryVersion",
                    json!(crate::candidate_pipeline::boundary::PIPELINE_BOUNDARY_VERSION),
                ),
                ("entryCount", json!(manifest.len())),
            ],
        ),
    ]
}

fn readiness_check(
    name: &str,
    ok: bool,
    detail: impl IntoIterator<Item = (&'static str, serde_json::Value)>,
) -> ReadinessCheckResponse {
    ReadinessCheckResponse {
        name: name.to_string(),
        ok,
        detail: detail
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use crate::candidate_pipeline::definition::build_pipeline_definition;
    use crate::config::RecommendationConfig;

    use super::{build_readiness_checks, build_runtime};

    #[test]
    fn readiness_keeps_news_ann_out_of_online_source_manifest() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let manifest = crate::candidate_pipeline::manifest::build_stage_manifest(
            &definition,
            &definition.graph_provider_mode(&config),
        );
        let checks = build_readiness_checks(&config, &definition, &manifest);

        assert!(checks.iter().all(|check| check.ok));
        let source_registry = checks
            .iter()
            .find(|check| check.name == "source_registry")
            .expect("source registry readiness check");
        assert_eq!(
            source_registry.detail.get("newsAnnOnlineAllowed"),
            Some(&serde_json::Value::Bool(false))
        );
        assert_eq!(
            source_registry.detail.get("newsAnnManifestDisabled"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn runtime_exports_algorithm_stage_version_anchors() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let runtime = build_runtime(&config, &definition);

        assert_eq!(runtime.source_policy_mode, "user_state_budget_policy_v1");
        assert_eq!(
            runtime.runtime_contract_version,
            "recommendation_runtime_contract_v7"
        );
        assert_eq!(
            runtime.contract_version_catalog_version,
            "recommendation_contract_version_catalog_v1"
        );
        assert_eq!(
            runtime.pipeline_boundary_version,
            "pipeline_boundary_contract_v1"
        );
        assert_eq!(
            runtime.workspace_migration_prep_version,
            "rust_workspace_migration_prep_v1"
        );
        assert_eq!(
            runtime.workspace_migration_state,
            "selector_primitives_extracted"
        );
        assert_eq!(
            runtime.algorithm_contract_version,
            "recommendation_algorithm_contract_v1"
        );
        assert_eq!(
            runtime.source_contract_version,
            "source_candidate_contract_v1"
        );
        assert_eq!(runtime.ranking_ladder_version, "rust_ranking_ladder_v1");
        assert_eq!(runtime.ranking_score_role_version, "ranking_score_role_v1");
        assert_eq!(
            runtime.selector_policy_version,
            "rust_top_k_selector_policy_v1"
        );
        assert_eq!(
            runtime.selector_audit_version,
            "selector_lane_source_pool_audit_v1"
        );
        assert_eq!(runtime.selector_constraint_version, "constraint_verdict_v1");
        assert_eq!(
            runtime.selector_score_source_version,
            "selector_final_score_source_v1"
        );
    }

    fn test_config() -> RecommendationConfig {
        RecommendationConfig {
            bind_addr: "0.0.0.0:4200".to_string(),
            backend_url: "http://backend:5000/internal/recommendation".to_string(),
            redis_url: "redis://redis:6379".to_string(),
            internal_token: Some("secret".to_string()),
            timeout_ms: 9000,
            graph_kernel_enabled: true,
            graph_kernel_url: "http://graph_kernel:4300".to_string(),
            graph_kernel_timeout_ms: 1200,
            graph_materializer_limit_per_author: 2,
            graph_materializer_lookback_days: 7,
            stage: "retrieval_ranking_v2".to_string(),
            retrieval_mode: "source_orchestrated_graph_v2".to_string(),
            ranking_mode: "phoenix_standardized".to_string(),
            selector_oversample_factor: 5,
            selector_max_size: 200,
            recent_per_user_capacity: 64,
            recent_global_capacity: 256,
            recent_source_enabled: true,
            source_order: vec![
                "FollowingSource".to_string(),
                "GraphSource".to_string(),
                "NewsAnnSource".to_string(),
                "PopularSource".to_string(),
                "TwoTowerSource".to_string(),
                "ColdStartSource".to_string(),
            ],
            graph_source_enabled: true,
            serve_cache_enabled: true,
            serve_cache_ttl_secs: 45,
            serve_cache_prefix: "recommendation:serve:v1".to_string(),
            serving_author_soft_cap: 2,
            news_trends_cache_enabled: true,
            news_trends_cache_ttl_secs: 60,
            news_trends_cache_prefix: "news:trends:rust:v1".to_string(),
        }
    }
}
