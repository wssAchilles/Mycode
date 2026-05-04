pub const PIPELINE_VERSION: &str = "xalgo_candidate_pipeline_v7";
pub const ALGORITHM_VERSION: &str = "rust_recommendation_algorithm_v1";
pub const RUNTIME_CONTRACT_VERSION: &str = "recommendation_runtime_contract_v7";
pub const CONTRACT_VERSION_CATALOG_VERSION: &str = "recommendation_contract_version_catalog_v1";
pub const WORKSPACE_MIGRATION_PREP_VERSION: &str = "rust_workspace_migration_prep_v1";
pub const WORKSPACE_MIGRATION_STATE: &str = "serving_stage_primitives_extracted";

pub const OWNER: &str = "rust";
pub const ALGORITHM_GROWTH_POLICY: &str = "rust_only_new_algorithm_logic";
pub const NODE_BASELINE_ROLE: &str = "legacy_baseline_fallback";
pub const FALLBACK_MODE: &str = "node_provider_surface_with_cpp_graph_primary";
pub const STAGE_EXECUTION_MODE: &str =
    "rust_orchestrated_explicit_provider_stages_parallel_bounded";
pub const PARALLEL_BOUNDED_EXECUTION_MODE: &str = "parallel_bounded";

pub const QUERY_HYDRATOR_TRANSPORT_MODE: &str = "batch_http_v1";
pub const SOURCE_TRANSPORT_MODE: &str = "batch_http_v1_with_graph_branch";
pub const CANDIDATE_HYDRATOR_TRANSPORT_MODE: &str = "http_provider_stage_v1";
pub const POST_SELECTION_HYDRATOR_TRANSPORT_MODE: &str = "http_provider_stage_v1";
pub const PROVIDER_LATENCY_MODE: &str = "http_path_v1";
pub const GRAPH_MATERIALIZER_CACHE_MODE: &str = "rust_short_ttl_with_node_provider_cache_v1";
pub const SOURCE_POLICY_MODE: &str = "user_state_budget_policy_v1";
pub const GUARDRAIL_MODE: &str = "ops_guardrails_v1";

pub const GRAPH_PROVIDER_CPP_PRIMARY_MODE: &str =
    "cpp_graph_kernel_primary_with_node_materializer_fallback";
pub const GRAPH_PROVIDER_NODE_ONLY_MODE: &str = "node_provider_surface_graph_only";
pub const GRAPH_PROVIDER_DISABLED_MODE: &str = "graph_source_disabled";

pub const QUERY_HYDRATOR_CONCURRENCY: usize = 4;
pub const SOURCE_CONCURRENCY: usize = 4;
pub const CANDIDATE_HYDRATOR_CONCURRENCY: usize = 4;
pub const POST_SELECTION_HYDRATOR_CONCURRENCY: usize = 4;
pub const PROVIDER_LATENCY_BUDGET_MS: u64 = 1_000;
pub const SOURCE_BATCH_COMPONENT_TIMEOUT_MS: u64 = 1_200;

pub const fn graph_provider_mode(
    graph_source_enabled: bool,
    graph_kernel_enabled: bool,
) -> &'static str {
    if graph_source_enabled && graph_kernel_enabled {
        GRAPH_PROVIDER_CPP_PRIMARY_MODE
    } else if graph_source_enabled {
        GRAPH_PROVIDER_NODE_ONLY_MODE
    } else {
        GRAPH_PROVIDER_DISABLED_MODE
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ALGORITHM_GROWTH_POLICY, CONTRACT_VERSION_CATALOG_VERSION, GRAPH_PROVIDER_CPP_PRIMARY_MODE,
        GRAPH_PROVIDER_DISABLED_MODE, GRAPH_PROVIDER_NODE_ONLY_MODE, NODE_BASELINE_ROLE, OWNER,
        PARALLEL_BOUNDED_EXECUTION_MODE, PIPELINE_VERSION, RUNTIME_CONTRACT_VERSION,
        WORKSPACE_MIGRATION_STATE, graph_provider_mode,
    };

    #[test]
    fn exports_stable_runtime_contract_anchors() {
        assert_eq!(PIPELINE_VERSION, "xalgo_candidate_pipeline_v7");
        assert_eq!(
            RUNTIME_CONTRACT_VERSION,
            "recommendation_runtime_contract_v7"
        );
        assert_eq!(
            CONTRACT_VERSION_CATALOG_VERSION,
            "recommendation_contract_version_catalog_v1"
        );
        assert_eq!(
            WORKSPACE_MIGRATION_STATE,
            "serving_stage_primitives_extracted"
        );
        assert_eq!(OWNER, "rust");
        assert_eq!(ALGORITHM_GROWTH_POLICY, "rust_only_new_algorithm_logic");
        assert_eq!(NODE_BASELINE_ROLE, "legacy_baseline_fallback");
        assert_eq!(PARALLEL_BOUNDED_EXECUTION_MODE, "parallel_bounded");
    }

    #[test]
    fn resolves_graph_provider_mode_from_runtime_flags() {
        assert_eq!(
            graph_provider_mode(true, true),
            GRAPH_PROVIDER_CPP_PRIMARY_MODE
        );
        assert_eq!(
            graph_provider_mode(true, false),
            GRAPH_PROVIDER_NODE_ONLY_MODE
        );
        assert_eq!(
            graph_provider_mode(false, true),
            GRAPH_PROVIDER_DISABLED_MODE
        );
    }
}
