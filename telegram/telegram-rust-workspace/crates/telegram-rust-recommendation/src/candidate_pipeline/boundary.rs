use std::collections::{HashMap, HashSet};

use crate::candidate_pipeline::definition::{
    ALGORITHM_GROWTH_POLICY, NODE_BASELINE_ROLE, OWNER, RecommendationPipelineDefinition,
};
use crate::contracts::ops::RecommendationPipelineStageManifestEntry;
use crate::scorers::MODEL_PROVIDER_SCORER_NAMES;
use crate::sources::GRAPH_SOURCE;
use telegram_pipeline_primitives::{
    PIPELINE_OWNER_NODE_PROVIDER, PIPELINE_OWNER_RUST, PIPELINE_STAGE_CANDIDATE_HYDRATORS,
    PIPELINE_STAGE_FILTERS, PIPELINE_STAGE_GRAPH_PROVIDER, PIPELINE_STAGE_POST_SELECTION_FILTERS,
    PIPELINE_STAGE_POST_SELECTION_HYDRATORS, PIPELINE_STAGE_QUERY_HYDRATORS,
    PIPELINE_STAGE_SCORERS, PIPELINE_STAGE_SELECTORS, PIPELINE_STAGE_SIDE_EFFECTS,
    PIPELINE_STAGE_SOURCES, PROVIDER_OWNED_PIPELINE_STAGES, RUST_OWNED_PIPELINE_STAGES,
};

pub use telegram_pipeline_primitives::PIPELINE_BOUNDARY_VERSION;

pub fn validate_pipeline_boundaries(
    definition: &RecommendationPipelineDefinition,
    manifest: &[RecommendationPipelineStageManifestEntry],
) -> Result<(), String> {
    if definition.owner != OWNER {
        return Err(format!("pipeline_owner_drift: {}", definition.owner));
    }
    if definition.algorithm_growth_policy != ALGORITHM_GROWTH_POLICY {
        return Err(format!(
            "algorithm_growth_policy_drift: {}",
            definition.algorithm_growth_policy
        ));
    }
    if definition.node_baseline_role != NODE_BASELINE_ROLE {
        return Err(format!(
            "node_baseline_role_drift: {}",
            definition.node_baseline_role
        ));
    }

    validate_manifest_group(
        PIPELINE_STAGE_QUERY_HYDRATORS,
        &definition.query_hydrators,
        manifest,
    )?;
    validate_manifest_group(PIPELINE_STAGE_SOURCES, &definition.sources, manifest)?;
    validate_manifest_group(
        PIPELINE_STAGE_CANDIDATE_HYDRATORS,
        &definition.candidate_hydrators,
        manifest,
    )?;
    validate_manifest_group(PIPELINE_STAGE_FILTERS, &definition.filters, manifest)?;
    validate_manifest_group(PIPELINE_STAGE_SCORERS, &definition.scorers, manifest)?;
    validate_manifest_group(PIPELINE_STAGE_SELECTORS, &definition.selectors, manifest)?;
    validate_manifest_group(
        PIPELINE_STAGE_POST_SELECTION_HYDRATORS,
        &definition.post_selection_hydrators,
        manifest,
    )?;
    validate_manifest_group(
        PIPELINE_STAGE_POST_SELECTION_FILTERS,
        &definition.post_selection_filters,
        manifest,
    )?;
    validate_manifest_group(
        PIPELINE_STAGE_SIDE_EFFECTS,
        &definition.side_effects,
        manifest,
    )?;
    validate_manifest_owner_rules(manifest)?;

    if !manifest.iter().any(|entry| {
        entry.stage == PIPELINE_STAGE_GRAPH_PROVIDER && entry.component == GRAPH_SOURCE
    }) {
        return Err("graph_provider_manifest_entry_missing".to_string());
    }

    Ok(())
}

fn validate_manifest_group(
    stage: &str,
    configured_components: &[String],
    manifest: &[RecommendationPipelineStageManifestEntry],
) -> Result<(), String> {
    if configured_components.is_empty() {
        return Err(format!("pipeline_stage_empty: {stage}"));
    }

    let manifest_components = manifest
        .iter()
        .filter(|entry| entry.stage == stage)
        .map(|entry| entry.component.as_str())
        .collect::<HashSet<_>>();

    let mut missing = Vec::new();
    for component in configured_components {
        if !manifest_components.contains(component.as_str()) {
            missing.push(component.as_str());
        }
    }

    if !missing.is_empty() {
        return Err(format!(
            "pipeline_manifest_missing_components: stage={} components={:?}",
            stage, missing
        ));
    }

    Ok(())
}

fn validate_manifest_owner_rules(
    manifest: &[RecommendationPipelineStageManifestEntry],
) -> Result<(), String> {
    let mut errors = Vec::new();
    let entries_by_stage = manifest.iter().fold(
        HashMap::<&str, Vec<&RecommendationPipelineStageManifestEntry>>::new(),
        |mut acc, entry| {
            acc.entry(entry.stage.as_str()).or_default().push(entry);
            acc
        },
    );

    for stage in PROVIDER_OWNED_PIPELINE_STAGES {
        for entry in entries_by_stage.get(stage).into_iter().flatten() {
            if entry.owner != PIPELINE_OWNER_NODE_PROVIDER {
                errors.push(format!(
                    "provider_stage_owner_drift: stage={} component={} owner={}",
                    entry.stage, entry.component, entry.owner
                ));
            }
        }
    }

    for stage in RUST_OWNED_PIPELINE_STAGES {
        for entry in entries_by_stage.get(stage).into_iter().flatten() {
            if entry.owner != PIPELINE_OWNER_RUST {
                errors.push(format!(
                    "rust_stage_owner_drift: stage={} component={} owner={}",
                    entry.stage, entry.component, entry.owner
                ));
            }
        }
    }

    for entry in entries_by_stage
        .get(PIPELINE_STAGE_SCORERS)
        .into_iter()
        .flatten()
    {
        let expected_owner = if MODEL_PROVIDER_SCORER_NAMES.contains(&entry.component.as_str()) {
            PIPELINE_OWNER_NODE_PROVIDER
        } else {
            PIPELINE_OWNER_RUST
        };
        if entry.owner != expected_owner {
            errors.push(format!(
                "scorer_owner_drift: component={} owner={} expected={}",
                entry.component, entry.owner, expected_owner
            ));
        }
    }

    if let Some(error) = errors.first() {
        return Err(error.clone());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use telegram_pipeline_primitives::{
        RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
        RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
    };

    use crate::candidate_pipeline::definition::build_pipeline_definition;
    use crate::candidate_pipeline::manifest::build_stage_manifest;
    use crate::config::RecommendationConfig;

    use super::{PIPELINE_BOUNDARY_VERSION, validate_pipeline_boundaries};

    fn test_config() -> RecommendationConfig {
        RecommendationConfig {
            bind_addr: "0.0.0.0:4200".to_string(),
            backend_url: "http://backend:5000/internal/recommendation".to_string(),
            redis_url: "redis://redis:6379".to_string(),
            internal_token: None,
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
            source_cache_enabled: true,
            source_cache_ttl_secs: 300,
            source_cache_prefix: "recommendation:source:v1".to_string(),
        }
    }

    #[test]
    fn accepts_current_pipeline_boundary_contract() {
        assert_eq!(PIPELINE_BOUNDARY_VERSION, "pipeline_boundary_contract_v1");

        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let manifest = build_stage_manifest(&definition, &definition.graph_provider_mode(&config));

        validate_pipeline_boundaries(&definition, &manifest).expect("valid pipeline boundaries");
    }

    #[test]
    fn rejects_provider_scorer_owner_drift() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let mut manifest =
            build_stage_manifest(&definition, &definition.graph_provider_mode(&config));
        let phoenix = manifest
            .iter_mut()
            .find(|entry| entry.stage == "scorers" && entry.component == "PhoenixScorer")
            .expect("PhoenixScorer manifest entry");
        phoenix.owner = "rust".to_string();

        let error = validate_pipeline_boundaries(&definition, &manifest)
            .expect_err("provider scorer owner drift should fail");
        assert!(error.contains("scorer_owner_drift"));
    }

    #[test]
    fn rejects_provider_stage_owner_drift() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let mut manifest =
            build_stage_manifest(&definition, &definition.graph_provider_mode(&config));
        let source = manifest
            .iter_mut()
            .find(|entry| entry.stage == "sources")
            .expect("source manifest entry");
        source.owner = "rust".to_string();

        let error = validate_pipeline_boundaries(&definition, &manifest)
            .expect_err("provider stage owner drift should fail");
        assert!(error.contains("provider_stage_owner_drift"));
    }

    #[test]
    fn rejects_rust_stage_owner_drift() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let mut manifest =
            build_stage_manifest(&definition, &definition.graph_provider_mode(&config));
        let selector = manifest
            .iter_mut()
            .find(|entry| entry.stage == "selectors")
            .expect("selector manifest entry");
        selector.owner = "rust_orchestrated_node_provider".to_string();

        let error = validate_pipeline_boundaries(&definition, &manifest)
            .expect_err("rust stage owner drift should fail");
        assert!(error.contains("rust_stage_owner_drift"));
    }
}
