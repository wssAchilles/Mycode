use crate::candidate_pipeline::definition::RecommendationPipelineDefinition;
use crate::contracts::ops::RecommendationPipelineStageManifestEntry;
use crate::scorers::MODEL_PROVIDER_SCORER_NAMES;
use crate::sources::{GRAPH_SOURCE, source_descriptor};

const RUST_OWNER: &str = "rust";
const NODE_PROVIDER_OWNER: &str = "rust_orchestrated_node_provider";

pub fn build_stage_manifest(
    definition: &RecommendationPipelineDefinition,
    graph_provider_mode: &str,
) -> Vec<RecommendationPipelineStageManifestEntry> {
    let mut manifest = Vec::new();

    push_components(
        &mut manifest,
        "query_hydrators",
        &definition.query_hydrators,
        NODE_PROVIDER_OWNER,
        &definition.query_hydrator_execution_mode,
        &definition.query_hydrator_transport_mode,
        "fail_open_patch_merge",
        "critical",
    );
    push_components(
        &mut manifest,
        "sources",
        &definition.sources,
        NODE_PROVIDER_OWNER,
        &definition.source_execution_mode,
        &definition.source_transport_mode,
        "fail_open_stable_merge",
        "critical",
    );
    push_components(
        &mut manifest,
        "candidate_hydrators",
        &definition.candidate_hydrators,
        NODE_PROVIDER_OWNER,
        &definition.candidate_hydrator_execution_mode,
        &definition.candidate_hydrator_transport_mode,
        "fail_open_stage_detail",
        "critical",
    );
    push_components(
        &mut manifest,
        "filters",
        &definition.filters,
        RUST_OWNER,
        "rust_local_filter_stage",
        "in_process",
        "fail_open_keep_backup",
        "critical",
    );
    push_scorer_components(&mut manifest, &definition.scorers);
    push_components(
        &mut manifest,
        "selectors",
        &definition.selectors,
        RUST_OWNER,
        "rust_in_process",
        "none",
        "fail_closed_selection",
        "critical",
    );
    push_components(
        &mut manifest,
        "post_selection_hydrators",
        &definition.post_selection_hydrators,
        NODE_PROVIDER_OWNER,
        &definition.post_selection_hydrator_execution_mode,
        &definition.post_selection_hydrator_transport_mode,
        "fail_open_stage_detail",
        "important",
    );
    push_components(
        &mut manifest,
        "post_selection_filters",
        &definition.post_selection_filters,
        RUST_OWNER,
        "rust_local_post_selection_filter_stage",
        "in_process",
        "fail_open_keep_backup",
        "important",
    );
    push_components(
        &mut manifest,
        "side_effects",
        &definition.side_effects,
        RUST_OWNER,
        &definition.async_side_effect_mode,
        "background_task",
        "post_response_best_effort",
        "non_blocking",
    );

    manifest.push(RecommendationPipelineStageManifestEntry {
        stage: "graph_provider".to_string(),
        component: GRAPH_SOURCE.to_string(),
        owner: "cpp".to_string(),
        execution_mode: "rust_fanout_to_cpp_kernels".to_string(),
        transport_mode: graph_provider_mode.to_string(),
        fallback_behavior: "node_author_materializer_fallback".to_string(),
        criticality: "critical".to_string(),
        enabled: graph_provider_mode != "graph_source_disabled",
        disabled_reason: (graph_provider_mode == "graph_source_disabled")
            .then(|| "disabledByConfig".to_string()),
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

fn push_components(
    manifest: &mut Vec<RecommendationPipelineStageManifestEntry>,
    stage: &str,
    components: &[String],
    owner: &str,
    execution_mode: &str,
    transport_mode: &str,
    fallback_behavior: &str,
    criticality: &str,
) {
    for component in components {
        let source_descriptor = (stage == "sources")
            .then(|| source_descriptor(component))
            .flatten();
        manifest.push(RecommendationPipelineStageManifestEntry {
            stage: stage.to_string(),
            component: component.clone(),
            owner: owner.to_string(),
            execution_mode: execution_mode.to_string(),
            transport_mode: transport_mode.to_string(),
            fallback_behavior: fallback_behavior.to_string(),
            criticality: criticality.to_string(),
            enabled: source_descriptor.is_none_or(|descriptor| descriptor.online_allowed),
            disabled_reason: source_descriptor
                .filter(|descriptor| !descriptor.online_allowed)
                .map(|_| "offlineOnlySource".to_string()),
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
                NODE_PROVIDER_OWNER,
                "node_provider_stage",
                "http_provider",
                "fail_open_score_fallback",
            )
        } else {
            (
                RUST_OWNER,
                "rust_local_scorer_stage",
                "in_process",
                "fail_open_score_adjustment",
            )
        };

        manifest.push(RecommendationPipelineStageManifestEntry {
            stage: "scorers".to_string(),
            component: component.clone(),
            owner: owner.to_string(),
            execution_mode: execution_mode.to_string(),
            transport_mode: transport_mode.to_string(),
            fallback_behavior: fallback_behavior.to_string(),
            criticality: "critical".to_string(),
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
