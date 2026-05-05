use serde_json::json;

use crate::candidate_pipeline::{
    boundary::validate_pipeline_boundaries, manifest::build_stage_manifest,
};
use crate::config::RecommendationConfig;
use crate::contracts::ops::RecommendationPipelineStageManifestEntry;
use crate::contracts::{ReadinessCheckResponse, ReadinessResponse};
use crate::pipeline::definition::RecommendationPipelineDefinition;
use crate::sources::{NEWS_ANN_SOURCE, source_descriptor};

pub(super) fn build_readiness_response(
    config: &RecommendationConfig,
    definition: &RecommendationPipelineDefinition,
) -> ReadinessResponse {
    let graph_provider_mode = definition.graph_provider_mode(config);
    let manifest = build_stage_manifest(definition, &graph_provider_mode);
    let checks = build_readiness_checks(config, definition, &manifest);
    let ok = checks.iter().all(|check| check.ok);

    ReadinessResponse {
        ok,
        status: if ok { "ready" } else { "degraded" },
        service: "rust_recommendation",
        stage: config.stage.clone(),
        manifest_entry_count: manifest.len(),
        checks,
    }
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
    use telegram_pipeline_primitives::{
        RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
        RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
    };

    use crate::candidate_pipeline::definition::build_pipeline_definition;
    use crate::config::RecommendationConfig;

    use super::build_readiness_response;

    #[test]
    fn readiness_keeps_news_ann_out_of_online_source_manifest() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let readiness = build_readiness_response(&config, &definition);

        assert!(readiness.checks.iter().all(|check| check.ok));
        let source_registry = readiness
            .checks
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
            stage: RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2.to_string(),
            retrieval_mode: RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2.to_string(),
            ranking_mode: RANKING_MODE_PHOENIX_STANDARDIZED.to_string(),
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
