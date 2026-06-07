use crate::candidate_pipeline::definition::RecommendationPipelineDefinition;
use crate::contracts::ops::RecommendationPipelineStageManifestEntry;
use crate::scorers::MODEL_PROVIDER_SCORER_NAMES;
use crate::sources::{GRAPH_SOURCE, source_descriptor};
use telegram_pipeline_primitives::{
    PIPELINE_MANIFEST_CRITICALITY_CRITICAL, PIPELINE_MANIFEST_CRITICALITY_IMPORTANT,
    PIPELINE_MANIFEST_CRITICALITY_NON_BLOCKING, PIPELINE_MANIFEST_DISABLED_BY_CONFIG,
    PIPELINE_MANIFEST_DISABLED_OFFLINE_ONLY_SOURCE, PIPELINE_MANIFEST_EXECUTION_GRAPH_FANOUT_CPP,
    PIPELINE_MANIFEST_EXECUTION_NODE_PROVIDER_STAGE, PIPELINE_MANIFEST_EXECUTION_RUST_FILTER_STAGE,
    PIPELINE_MANIFEST_EXECUTION_RUST_POST_SELECTION_FILTER_STAGE,
    PIPELINE_MANIFEST_EXECUTION_RUST_PROCESS, PIPELINE_MANIFEST_EXECUTION_RUST_SCORER_STAGE,
    PIPELINE_MANIFEST_FALLBACK_GRAPH_MATERIALIZER, PIPELINE_MANIFEST_FALLBACK_KEEP_BACKUP,
    PIPELINE_MANIFEST_FALLBACK_POST_RESPONSE_BEST_EFFORT,
    PIPELINE_MANIFEST_FALLBACK_QUERY_PATCH_MERGE, PIPELINE_MANIFEST_FALLBACK_SCORE_ADJUSTMENT,
    PIPELINE_MANIFEST_FALLBACK_SCORE_FALLBACK, PIPELINE_MANIFEST_FALLBACK_SELECTION_CLOSED,
    PIPELINE_MANIFEST_FALLBACK_SOURCE_STABLE_MERGE, PIPELINE_MANIFEST_FALLBACK_STAGE_DETAIL,
    PIPELINE_MANIFEST_TRANSPORT_BACKGROUND_TASK, PIPELINE_MANIFEST_TRANSPORT_HTTP_PROVIDER,
    PIPELINE_MANIFEST_TRANSPORT_IN_PROCESS, PIPELINE_MANIFEST_TRANSPORT_NONE, PIPELINE_OWNER_CPP,
    PIPELINE_OWNER_NODE_PROVIDER, PIPELINE_OWNER_RUST, PIPELINE_STAGE_CANDIDATE_HYDRATORS,
    PIPELINE_STAGE_FILTERS, PIPELINE_STAGE_GRAPH_PROVIDER, PIPELINE_STAGE_POST_SELECTION_FILTERS,
    PIPELINE_STAGE_POST_SELECTION_HYDRATORS, PIPELINE_STAGE_QUERY_HYDRATORS,
    PIPELINE_STAGE_SCORERS, PIPELINE_STAGE_SELECTORS, PIPELINE_STAGE_SIDE_EFFECTS,
    PIPELINE_STAGE_SOURCES,
};
use telegram_runtime_primitives::GRAPH_PROVIDER_DISABLED_MODE;

pub fn build_stage_manifest(
    definition: &RecommendationPipelineDefinition,
    graph_provider_mode: &str,
) -> Vec<RecommendationPipelineStageManifestEntry> {
    let mut manifest = Vec::new();

    push_components(
        &mut manifest,
        &definition.query_hydrators,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_QUERY_HYDRATORS,
            owner: PIPELINE_OWNER_NODE_PROVIDER,
            execution_mode: &definition.query_hydrator_execution_mode,
            transport_mode: &definition.query_hydrator_transport_mode,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_QUERY_PATCH_MERGE,
            criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL,
        },
    );
    push_components(
        &mut manifest,
        &definition.sources,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_SOURCES,
            owner: PIPELINE_OWNER_NODE_PROVIDER,
            execution_mode: &definition.source_execution_mode,
            transport_mode: &definition.source_transport_mode,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_SOURCE_STABLE_MERGE,
            criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL,
        },
    );
    push_components(
        &mut manifest,
        &definition.candidate_hydrators,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_CANDIDATE_HYDRATORS,
            owner: PIPELINE_OWNER_NODE_PROVIDER,
            execution_mode: &definition.candidate_hydrator_execution_mode,
            transport_mode: &definition.candidate_hydrator_transport_mode,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_STAGE_DETAIL,
            criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL,
        },
    );
    push_components(
        &mut manifest,
        &definition.filters,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_FILTERS,
            owner: PIPELINE_OWNER_RUST,
            execution_mode: PIPELINE_MANIFEST_EXECUTION_RUST_FILTER_STAGE,
            transport_mode: PIPELINE_MANIFEST_TRANSPORT_IN_PROCESS,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_KEEP_BACKUP,
            criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL,
        },
    );
    push_scorer_components(&mut manifest, &definition.scorers);
    push_components(
        &mut manifest,
        &definition.selectors,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_SELECTORS,
            owner: PIPELINE_OWNER_RUST,
            execution_mode: PIPELINE_MANIFEST_EXECUTION_RUST_PROCESS,
            transport_mode: PIPELINE_MANIFEST_TRANSPORT_NONE,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_SELECTION_CLOSED,
            criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL,
        },
    );
    push_components(
        &mut manifest,
        &definition.post_selection_hydrators,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_POST_SELECTION_HYDRATORS,
            owner: PIPELINE_OWNER_NODE_PROVIDER,
            execution_mode: &definition.post_selection_hydrator_execution_mode,
            transport_mode: &definition.post_selection_hydrator_transport_mode,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_STAGE_DETAIL,
            criticality: PIPELINE_MANIFEST_CRITICALITY_IMPORTANT,
        },
    );
    push_components(
        &mut manifest,
        &definition.post_selection_filters,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_POST_SELECTION_FILTERS,
            owner: PIPELINE_OWNER_RUST,
            execution_mode: PIPELINE_MANIFEST_EXECUTION_RUST_POST_SELECTION_FILTER_STAGE,
            transport_mode: PIPELINE_MANIFEST_TRANSPORT_IN_PROCESS,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_KEEP_BACKUP,
            criticality: PIPELINE_MANIFEST_CRITICALITY_IMPORTANT,
        },
    );
    push_components(
        &mut manifest,
        &definition.side_effects,
        ComponentManifestSpec {
            stage: PIPELINE_STAGE_SIDE_EFFECTS,
            owner: PIPELINE_OWNER_RUST,
            execution_mode: &definition.async_side_effect_mode,
            transport_mode: PIPELINE_MANIFEST_TRANSPORT_BACKGROUND_TASK,
            fallback_behavior: PIPELINE_MANIFEST_FALLBACK_POST_RESPONSE_BEST_EFFORT,
            criticality: PIPELINE_MANIFEST_CRITICALITY_NON_BLOCKING,
        },
    );

    manifest.push(RecommendationPipelineStageManifestEntry {
        stage: PIPELINE_STAGE_GRAPH_PROVIDER.to_string(),
        component: GRAPH_SOURCE.to_string(),
        owner: PIPELINE_OWNER_CPP.to_string(),
        execution_mode: PIPELINE_MANIFEST_EXECUTION_GRAPH_FANOUT_CPP.to_string(),
        transport_mode: graph_provider_mode.to_string(),
        fallback_behavior: PIPELINE_MANIFEST_FALLBACK_GRAPH_MATERIALIZER.to_string(),
        criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL.to_string(),
        enabled: graph_provider_mode != GRAPH_PROVIDER_DISABLED_MODE,
        disabled_reason: (graph_provider_mode == GRAPH_PROVIDER_DISABLED_MODE)
            .then(|| PIPELINE_MANIFEST_DISABLED_BY_CONFIG.to_string()),
        lane: source_descriptor(GRAPH_SOURCE).map(|descriptor| descriptor.lane.to_string()),
        cost_class: source_descriptor(GRAPH_SOURCE)
            .map(|descriptor| descriptor.cost_class.as_str().to_string()),
        online_allowed: source_descriptor(GRAPH_SOURCE)
            .is_none_or(|descriptor| descriptor.online_allowed),
        readiness_impact: source_descriptor(GRAPH_SOURCE)
            .map(|descriptor| descriptor.readiness_impact.as_str().to_string()),
    });

    manifest
}

struct ComponentManifestSpec<'a> {
    stage: &'a str,
    owner: &'a str,
    execution_mode: &'a str,
    transport_mode: &'a str,
    fallback_behavior: &'a str,
    criticality: &'a str,
}

fn push_components(
    manifest: &mut Vec<RecommendationPipelineStageManifestEntry>,
    components: &[String],
    spec: ComponentManifestSpec<'_>,
) {
    for component in components {
        let source_descriptor = (spec.stage == PIPELINE_STAGE_SOURCES)
            .then(|| source_descriptor(component))
            .flatten();
        manifest.push(RecommendationPipelineStageManifestEntry {
            stage: spec.stage.to_string(),
            component: component.clone(),
            owner: spec.owner.to_string(),
            execution_mode: spec.execution_mode.to_string(),
            transport_mode: spec.transport_mode.to_string(),
            fallback_behavior: spec.fallback_behavior.to_string(),
            criticality: spec.criticality.to_string(),
            enabled: source_descriptor.is_none_or(|descriptor| descriptor.online_allowed),
            disabled_reason: source_descriptor
                .filter(|descriptor| !descriptor.online_allowed)
                .map(|_| PIPELINE_MANIFEST_DISABLED_OFFLINE_ONLY_SOURCE.to_string()),
            lane: source_descriptor.map(|descriptor| descriptor.lane.to_string()),
            cost_class: source_descriptor
                .map(|descriptor| descriptor.cost_class.as_str().to_string()),
            online_allowed: source_descriptor.is_none_or(|descriptor| descriptor.online_allowed),
            readiness_impact: source_descriptor
                .map(|descriptor| descriptor.readiness_impact.as_str().to_string()),
        });
    }
}

fn push_scorer_components(
    manifest: &mut Vec<RecommendationPipelineStageManifestEntry>,
    components: &[String],
) {
    for component in components {
        let is_provider_scorer = MODEL_PROVIDER_SCORER_NAMES.contains(&component.as_str());
        let (owner, execution_mode, transport_mode, fallback_behavior) = if is_provider_scorer {
            (
                PIPELINE_OWNER_NODE_PROVIDER,
                PIPELINE_MANIFEST_EXECUTION_NODE_PROVIDER_STAGE,
                PIPELINE_MANIFEST_TRANSPORT_HTTP_PROVIDER,
                PIPELINE_MANIFEST_FALLBACK_SCORE_FALLBACK,
            )
        } else {
            (
                PIPELINE_OWNER_RUST,
                PIPELINE_MANIFEST_EXECUTION_RUST_SCORER_STAGE,
                PIPELINE_MANIFEST_TRANSPORT_IN_PROCESS,
                PIPELINE_MANIFEST_FALLBACK_SCORE_ADJUSTMENT,
            )
        };

        manifest.push(RecommendationPipelineStageManifestEntry {
            stage: PIPELINE_STAGE_SCORERS.to_string(),
            component: component.clone(),
            owner: owner.to_string(),
            execution_mode: execution_mode.to_string(),
            transport_mode: transport_mode.to_string(),
            fallback_behavior: fallback_behavior.to_string(),
            criticality: PIPELINE_MANIFEST_CRITICALITY_CRITICAL.to_string(),
            enabled: true,
            disabled_reason: None,
            lane: None,
            cost_class: None,
            online_allowed: true,
            readiness_impact: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use telegram_pipeline_primitives::{
        RANKING_MODE_PHOENIX_STANDARDIZED, RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
        RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2, validate_pipeline_stage_order,
    };

    use crate::candidate_pipeline::definition::build_pipeline_definition;
    use crate::config::RecommendationConfig;

    use crate::contracts::ops::RecommendationPipelineStageManifestEntry;

    use super::build_stage_manifest;

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
            recent_hot_shard_count: 16,
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
            cache_singleflight_enabled: false,
            cache_local_capacity: 4096,
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
    fn exports_parallel_candidate_hydrator_modes_in_manifest() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let manifest = build_stage_manifest(&definition, &definition.graph_provider_mode(&config));

        let candidate_entry = manifest
            .iter()
            .find(|entry| entry.stage == "candidate_hydrators")
            .expect("candidate_hydrator manifest entry");
        assert_eq!(candidate_entry.execution_mode, "parallel_bounded");
        assert_eq!(candidate_entry.transport_mode, "http_provider_stage_v1");

        let post_selection_entry = manifest
            .iter()
            .find(|entry| entry.stage == "post_selection_hydrators")
            .expect("post_selection_hydrator manifest entry");
        assert_eq!(post_selection_entry.execution_mode, "parallel_bounded");
        assert_eq!(
            post_selection_entry.transport_mode,
            "http_provider_stage_v1"
        );
    }

    #[test]
    fn exports_component_specific_rust_and_provider_stage_modes() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let manifest = build_stage_manifest(&definition, &definition.graph_provider_mode(&config));

        let duplicate_filter = find_entry(&manifest, "filters", "DuplicateFilter");
        assert_eq!(duplicate_filter.owner, "rust");
        assert_eq!(duplicate_filter.execution_mode, "rust_local_filter_stage");
        assert_eq!(duplicate_filter.transport_mode, "in_process");

        let phoenix_scorer = find_entry(&manifest, "scorers", "PhoenixScorer");
        assert_eq!(phoenix_scorer.owner, "rust_orchestrated_node_provider");
        assert_eq!(phoenix_scorer.execution_mode, "node_provider_stage");
        assert_eq!(phoenix_scorer.transport_mode, "http_provider");

        let weighted_scorer = find_entry(&manifest, "scorers", "WeightedScorer");
        assert_eq!(weighted_scorer.owner, "rust");
        assert_eq!(weighted_scorer.execution_mode, "rust_local_scorer_stage");
        assert_eq!(weighted_scorer.transport_mode, "in_process");

        let vf_filter = find_entry(&manifest, "post_selection_filters", "VFFilter");
        assert_eq!(vf_filter.owner, "rust");
        assert_eq!(
            vf_filter.execution_mode,
            "rust_local_post_selection_filter_stage"
        );
        assert_eq!(vf_filter.transport_mode, "in_process");
    }

    #[test]
    fn manifest_keeps_provider_and_rust_fallback_contracts_explicit() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let manifest = build_stage_manifest(&definition, &definition.graph_provider_mode(&config));

        let query_hydrator = manifest
            .iter()
            .find(|entry| entry.stage == "query_hydrators")
            .expect("query hydrator manifest entry");
        assert_eq!(query_hydrator.owner, "rust_orchestrated_node_provider");
        assert_eq!(query_hydrator.fallback_behavior, "fail_open_patch_merge");

        let source = manifest
            .iter()
            .find(|entry| entry.stage == "sources")
            .expect("source manifest entry");
        assert_eq!(source.owner, "rust_orchestrated_node_provider");
        assert_eq!(source.fallback_behavior, "fail_open_stable_merge");

        let filter = find_entry(&manifest, "filters", "DuplicateFilter");
        assert_eq!(filter.owner, "rust");
        assert_eq!(filter.fallback_behavior, "fail_open_keep_backup");

        let selector = manifest
            .iter()
            .find(|entry| entry.stage == "selectors")
            .expect("selector manifest entry");
        assert_eq!(selector.owner, "rust");
        assert_eq!(selector.fallback_behavior, "fail_closed_selection");
    }

    #[test]
    fn manifest_preserves_canonical_pipeline_stage_order() {
        let config = test_config();
        let definition = build_pipeline_definition(&config);
        let manifest = build_stage_manifest(&definition, &definition.graph_provider_mode(&config));
        let stages = manifest
            .iter()
            .filter(|entry| entry.stage != "graph_provider")
            .map(|entry| entry.stage.as_str())
            .collect::<Vec<_>>();

        validate_pipeline_stage_order(&stages).expect("canonical manifest stage order");
    }

    fn find_entry<'a>(
        manifest: &'a [RecommendationPipelineStageManifestEntry],
        stage: &str,
        component: &str,
    ) -> &'a RecommendationPipelineStageManifestEntry {
        manifest
            .iter()
            .find(|entry| entry.stage == stage && entry.component == component)
            .expect("manifest entry")
    }
}
