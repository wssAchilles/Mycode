use crate::candidate_pipeline::definition::RecommendationPipelineDefinition;
use crate::contracts::ops::RecommendationPipelineStageManifestEntry;

pub fn build_stage_manifest(
    definition: &RecommendationPipelineDefinition,
    graph_provider_mode: &str,
) -> Vec<RecommendationPipelineStageManifestEntry> {
    let mut manifest = Vec::new();

    push_components(
        &mut manifest,
        "query_hydrators",
        &definition.query_hydrators,
        &definition.query_hydrator_execution_mode,
        &definition.query_hydrator_transport_mode,
        "fail_open_patch_merge",
        "critical",
    );
    push_components(
        &mut manifest,
        "sources",
        &definition.sources,
        &definition.source_execution_mode,
        &definition.source_transport_mode,
        "fail_open_stable_merge",
        "critical",
    );
    push_components(
        &mut manifest,
        "candidate_hydrators",
        &definition.candidate_hydrators,
        "node_provider_stage",
        "http_provider",
        "fail_open_stage_detail",
        "critical",
    );
    push_components(
        &mut manifest,
        "filters",
        &definition.filters,
        "node_provider_stage",
        "http_provider",
        "fail_open_keep_backup",
        "critical",
    );
    push_components(
        &mut manifest,
        "scorers",
        &definition.scorers,
        "node_provider_stage",
        "http_provider",
        "fail_open_score_fallback",
        "critical",
    );
    push_components(
        &mut manifest,
        "selectors",
        &definition.selectors,
        "rust_in_process",
        "none",
        "fail_closed_selection",
        "critical",
    );
    push_components(
        &mut manifest,
        "post_selection_hydrators",
        &definition.post_selection_hydrators,
        "node_provider_stage",
        "http_provider",
        "fail_open_stage_detail",
        "important",
    );
    push_components(
        &mut manifest,
        "post_selection_filters",
        &definition.post_selection_filters,
        "node_provider_stage",
        "http_provider",
        "fail_open_keep_backup",
        "important",
    );
    push_components(
        &mut manifest,
        "side_effects",
        &definition.side_effects,
        &definition.async_side_effect_mode,
        "background_task",
        "post_response_best_effort",
        "non_blocking",
    );

    manifest.push(RecommendationPipelineStageManifestEntry {
        stage: "graph_provider".to_string(),
        component: "GraphSource".to_string(),
        owner: "cpp".to_string(),
        execution_mode: "rust_fanout_to_cpp_kernels".to_string(),
        transport_mode: graph_provider_mode.to_string(),
        fallback_behavior: "node_author_materializer_fallback".to_string(),
        criticality: "critical".to_string(),
    });

    manifest
}

fn push_components(
    manifest: &mut Vec<RecommendationPipelineStageManifestEntry>,
    stage: &str,
    components: &[String],
    execution_mode: &str,
    transport_mode: &str,
    fallback_behavior: &str,
    criticality: &str,
) {
    for component in components {
        manifest.push(RecommendationPipelineStageManifestEntry {
            stage: stage.to_string(),
            component: component.clone(),
            owner: owner_for_stage(stage),
            execution_mode: execution_mode.to_string(),
            transport_mode: transport_mode.to_string(),
            fallback_behavior: fallback_behavior.to_string(),
            criticality: criticality.to_string(),
        });
    }
}

fn owner_for_stage(stage: &str) -> String {
    match stage {
        "selectors" | "side_effects" => "rust",
        _ => "rust_orchestrated_node_provider",
    }
    .to_string()
}
