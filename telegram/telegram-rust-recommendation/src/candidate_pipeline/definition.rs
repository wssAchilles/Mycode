use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::{
    candidate_hydrators::{
        configured_candidate_hydrators, post_selection::configured_post_selection_hydrators,
    },
    config::RecommendationConfig,
    filters::{configured_filters, post_selection::configured_post_selection_filters},
    pipeline::local::ranking::RANKING_LADDER_VERSION,
    query_hydrators::configured_query_hydrators,
    scorers::configured_scorers,
    selectors::{self, top_k::SELECTOR_POLICY_VERSION},
    serving::cursor::{CURSOR_MODE, SERVING_VERSION},
    serving::policy::{CACHE_KEY_MODE, CACHE_POLICY_MODE},
    side_effects::{configured_side_effects, runtime::ASYNC_SIDE_EFFECT_MODE},
    sources::configured_sources,
};

pub const PIPELINE_VERSION: &str = "xalgo_candidate_pipeline_v7";
pub const ALGORITHM_VERSION: &str = "rust_recommendation_algorithm_v1";
pub const RUNTIME_CONTRACT_VERSION: &str = "recommendation_runtime_contract_v5";
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
pub const GRAPH_MATERIALIZER_CACHE_MODE: &str = "node_short_ttl_v1";
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

#[derive(Debug, Clone)]
pub struct RecommendationPipelineDefinition {
    pub pipeline_version: String,
    pub algorithm_version: String,
    pub runtime_contract_version: String,
    pub owner: String,
    pub algorithm_growth_policy: String,
    pub node_baseline_role: String,
    pub fallback_mode: String,
    pub stage_execution_mode: String,
    pub query_hydrator_execution_mode: String,
    pub source_execution_mode: String,
    pub candidate_hydrator_execution_mode: String,
    pub post_selection_hydrator_execution_mode: String,
    pub query_hydrator_transport_mode: String,
    pub source_transport_mode: String,
    pub candidate_hydrator_transport_mode: String,
    pub post_selection_hydrator_transport_mode: String,
    pub provider_latency_mode: String,
    pub graph_materializer_cache_mode: String,
    pub source_policy_mode: String,
    pub ranking_ladder_version: String,
    pub selector_policy_version: String,
    pub guardrail_mode: String,
    pub serving_version: String,
    pub cursor_mode: String,
    pub serve_cache_key_mode: String,
    pub serve_cache_policy_mode: String,
    pub async_side_effect_mode: String,
    pub provider_latency_budget_ms: u64,
    pub source_batch_component_timeout_ms: u64,
    pub query_hydrator_concurrency: usize,
    pub source_concurrency: usize,
    pub candidate_hydrator_concurrency: usize,
    pub post_selection_hydrator_concurrency: usize,
    pub query_hydrators: Vec<String>,
    pub sources: Vec<String>,
    pub candidate_hydrators: Vec<String>,
    pub filters: Vec<String>,
    pub scorers: Vec<String>,
    pub selectors: Vec<String>,
    pub post_selection_hydrators: Vec<String>,
    pub post_selection_filters: Vec<String>,
    pub side_effects: Vec<String>,
    pub component_order_hash: String,
}

impl RecommendationPipelineDefinition {
    pub fn graph_provider_mode(&self, config: &RecommendationConfig) -> String {
        if config.graph_source_enabled && config.graph_kernel_enabled {
            GRAPH_PROVIDER_CPP_PRIMARY_MODE.to_string()
        } else if config.graph_source_enabled {
            GRAPH_PROVIDER_NODE_ONLY_MODE.to_string()
        } else {
            GRAPH_PROVIDER_DISABLED_MODE.to_string()
        }
    }
}

pub fn build_pipeline_definition(
    config: &RecommendationConfig,
) -> RecommendationPipelineDefinition {
    let query_hydrators = configured_query_hydrators();
    let sources = configured_sources(&config.source_order);
    let candidate_hydrators = configured_candidate_hydrators();
    let filters = configured_filters();
    let scorers = configured_scorers();
    let selectors = selectors::configured_selectors();
    let post_selection_hydrators = configured_post_selection_hydrators();
    let post_selection_filters = configured_post_selection_filters();
    let side_effects = configured_side_effects();
    let component_order_hash = build_component_order_hash(&[
        &query_hydrators,
        &sources,
        &candidate_hydrators,
        &filters,
        &scorers,
        &selectors,
        &post_selection_hydrators,
        &post_selection_filters,
        &side_effects,
    ]);

    RecommendationPipelineDefinition {
        pipeline_version: PIPELINE_VERSION.to_string(),
        algorithm_version: ALGORITHM_VERSION.to_string(),
        runtime_contract_version: RUNTIME_CONTRACT_VERSION.to_string(),
        owner: OWNER.to_string(),
        algorithm_growth_policy: ALGORITHM_GROWTH_POLICY.to_string(),
        node_baseline_role: NODE_BASELINE_ROLE.to_string(),
        fallback_mode: FALLBACK_MODE.to_string(),
        stage_execution_mode: STAGE_EXECUTION_MODE.to_string(),
        query_hydrator_execution_mode: PARALLEL_BOUNDED_EXECUTION_MODE.to_string(),
        source_execution_mode: PARALLEL_BOUNDED_EXECUTION_MODE.to_string(),
        candidate_hydrator_execution_mode: PARALLEL_BOUNDED_EXECUTION_MODE.to_string(),
        post_selection_hydrator_execution_mode: PARALLEL_BOUNDED_EXECUTION_MODE.to_string(),
        query_hydrator_transport_mode: QUERY_HYDRATOR_TRANSPORT_MODE.to_string(),
        source_transport_mode: SOURCE_TRANSPORT_MODE.to_string(),
        candidate_hydrator_transport_mode: CANDIDATE_HYDRATOR_TRANSPORT_MODE.to_string(),
        post_selection_hydrator_transport_mode: POST_SELECTION_HYDRATOR_TRANSPORT_MODE.to_string(),
        provider_latency_mode: PROVIDER_LATENCY_MODE.to_string(),
        graph_materializer_cache_mode: GRAPH_MATERIALIZER_CACHE_MODE.to_string(),
        source_policy_mode: SOURCE_POLICY_MODE.to_string(),
        ranking_ladder_version: RANKING_LADDER_VERSION.to_string(),
        selector_policy_version: SELECTOR_POLICY_VERSION.to_string(),
        guardrail_mode: GUARDRAIL_MODE.to_string(),
        serving_version: SERVING_VERSION.to_string(),
        cursor_mode: CURSOR_MODE.to_string(),
        serve_cache_key_mode: CACHE_KEY_MODE.to_string(),
        serve_cache_policy_mode: CACHE_POLICY_MODE.to_string(),
        async_side_effect_mode: ASYNC_SIDE_EFFECT_MODE.to_string(),
        provider_latency_budget_ms: PROVIDER_LATENCY_BUDGET_MS,
        source_batch_component_timeout_ms: SOURCE_BATCH_COMPONENT_TIMEOUT_MS,
        query_hydrator_concurrency: QUERY_HYDRATOR_CONCURRENCY,
        source_concurrency: SOURCE_CONCURRENCY,
        candidate_hydrator_concurrency: CANDIDATE_HYDRATOR_CONCURRENCY,
        post_selection_hydrator_concurrency: POST_SELECTION_HYDRATOR_CONCURRENCY,
        query_hydrators,
        sources,
        candidate_hydrators,
        filters,
        scorers,
        selectors,
        post_selection_hydrators,
        post_selection_filters,
        side_effects,
        component_order_hash,
    }
}

fn build_component_order_hash(groups: &[&Vec<String>]) -> String {
    let mut hasher = DefaultHasher::new();
    for group in groups {
        "|".hash(&mut hasher);
        for component in *group {
            component.hash(&mut hasher);
            ";".hash(&mut hasher);
        }
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use crate::config::RecommendationConfig;

    use super::{
        ALGORITHM_GROWTH_POLICY, ALGORITHM_VERSION, CANDIDATE_HYDRATOR_CONCURRENCY,
        NODE_BASELINE_ROLE, PARALLEL_BOUNDED_EXECUTION_MODE, PIPELINE_VERSION,
        POST_SELECTION_HYDRATOR_CONCURRENCY, QUERY_HYDRATOR_CONCURRENCY, SOURCE_CONCURRENCY,
        build_pipeline_definition,
    };

    #[test]
    fn builds_xalgorithm_aligned_stage_layout() {
        let config = RecommendationConfig {
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
                "EmbeddingAuthorSource".to_string(),
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
        };

        let definition = build_pipeline_definition(&config);

        assert_eq!(definition.pipeline_version, PIPELINE_VERSION);
        assert_eq!(definition.algorithm_version, ALGORITHM_VERSION);
        assert_eq!(definition.owner, "rust");
        assert_eq!(definition.algorithm_growth_policy, ALGORITHM_GROWTH_POLICY);
        assert_eq!(definition.node_baseline_role, NODE_BASELINE_ROLE);
        assert_eq!(definition.ranking_ladder_version, "rust_ranking_ladder_v1");
        assert_eq!(
            definition.selector_policy_version,
            "rust_top_k_selector_policy_v1"
        );
        assert_eq!(
            definition.fallback_mode,
            "node_provider_surface_with_cpp_graph_primary"
        );
        assert_eq!(
            definition.query_hydrator_execution_mode,
            PARALLEL_BOUNDED_EXECUTION_MODE
        );
        assert_eq!(
            definition.source_execution_mode,
            PARALLEL_BOUNDED_EXECUTION_MODE
        );
        assert_eq!(
            definition.candidate_hydrator_execution_mode,
            PARALLEL_BOUNDED_EXECUTION_MODE
        );
        assert_eq!(
            definition.post_selection_hydrator_execution_mode,
            PARALLEL_BOUNDED_EXECUTION_MODE
        );
        assert_eq!(
            definition.query_hydrator_concurrency,
            QUERY_HYDRATOR_CONCURRENCY
        );
        assert_eq!(definition.source_concurrency, SOURCE_CONCURRENCY);
        assert_eq!(
            definition.candidate_hydrator_concurrency,
            CANDIDATE_HYDRATOR_CONCURRENCY
        );
        assert_eq!(
            definition.post_selection_hydrator_concurrency,
            POST_SELECTION_HYDRATOR_CONCURRENCY
        );
        assert_eq!(
            definition.query_hydrators,
            vec![
                "UserFeaturesQueryHydrator",
                "UserEmbeddingQueryHydrator",
                "UserActionSeqQueryHydrator",
                "UserStateQueryHydrator",
                "NewsModelContextQueryHydrator",
                "ExperimentQueryHydrator",
            ]
        );
        assert_eq!(
            definition.sources,
            vec![
                "FollowingSource",
                "GraphSource",
                "NewsAnnSource",
                "EmbeddingAuthorSource",
                "PopularSource",
                "TwoTowerSource",
                "ColdStartSource",
            ]
        );
        assert_eq!(
            definition.candidate_hydrators,
            vec![
                "AuthorInfoHydrator",
                "UserInteractionHydrator",
                "VideoInfoHydrator",
            ]
        );
        assert_eq!(
            definition.filters,
            vec![
                "DuplicateFilter",
                "NewsExternalIdDedupFilter",
                "SelfPostFilter",
                "RetweetDedupFilter",
                "AgeFilter",
                "QualityGuardFilter",
                "BlockedUserFilter",
                "MutedKeywordFilter",
                "SeenPostFilter",
                "PreviouslyServedFilter",
            ]
        );
        assert_eq!(
            definition.scorers,
            vec![
                "PhoenixScorer",
                "EngagementScorer",
                "LightweightPhoenixScorer",
                "WeightedScorer",
                "ScoreCalibrationScorer",
                "ContentQualityScorer",
                "AuthorAffinityScorer",
                "RecencyScorer",
                "ColdStartInterestScorer",
                "TrendAffinityScorer",
                "TrendPersonalizationScorer",
                "NewsTrendLinkScorer",
                "InterestDecayScorer",
                "ExplorationScorer",
                "BanditExplorationScorer",
                "FatigueScorer",
                "SessionSuppressionScorer",
                "OutOfNetworkScorer",
                "IntraRequestDiversityScorer",
                "AuthorDiversityScorer",
                "ScoreContractScorer",
            ]
        );
        assert_eq!(definition.selectors, vec!["RustTopKSelector"]);
        assert_eq!(
            definition.post_selection_hydrators,
            vec!["VFCandidateHydrator"]
        );
        assert_eq!(
            definition.post_selection_filters,
            vec!["VFFilter", "ConversationDedupFilter"]
        );
        assert_eq!(
            definition.side_effects,
            vec!["RecentStoreSideEffect", "ServeCacheWriteSideEffect"]
        );
        assert!(!definition.component_order_hash.is_empty());
    }
}
