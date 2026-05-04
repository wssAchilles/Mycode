pub mod executor_keys;
pub mod stage_detail;
pub use executor_keys::*;
pub use stage_detail::*;

pub const PIPELINE_BOUNDARY_VERSION: &str = "pipeline_boundary_contract_v1";
pub const RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2: &str = "retrieval_ranking_v2";
pub const RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2: &str = "source_orchestrated_graph_v2";
pub const RANKING_MODE_PHOENIX_STANDARDIZED: &str = "phoenix_standardized";
pub const PIPELINE_TRACE_VERSION: &str = "rust_candidate_trace_v1";
pub const PIPELINE_TRACE_MODE_LIVE: &str = "live_trace";
pub const PIPELINE_TRACE_MODE_CACHE_REPLAY: &str = "cache_replay_trace";
pub const PIPELINE_LOCAL_FILTER_EXECUTION_MODE: &str = "rust_local_rules_v1";
pub const PIPELINE_LOCAL_SCORER_EXECUTION_MODE: &str = "rust_local_scorers_v1";
pub const PIPELINE_SPACE_FEED_EXPERIMENT_ID: &str = "space_feed_recsys";
pub const PIPELINE_SPACE_FEED_EXPERIMENT_ID_ENV_KEY: &str = "SPACE_FEED_EXPERIMENT_ID";

pub const PIPELINE_OWNER_RUST: &str = "rust";
pub const PIPELINE_OWNER_NODE_PROVIDER: &str = "rust_orchestrated_node_provider";
pub const PIPELINE_OWNER_CPP: &str = "cpp";

pub const PIPELINE_STAGE_QUERY_HYDRATORS: &str = "query_hydrators";
pub const PIPELINE_STAGE_SOURCES: &str = "sources";
pub const PIPELINE_STAGE_CANDIDATE_HYDRATORS: &str = "candidate_hydrators";
pub const PIPELINE_STAGE_FILTERS: &str = "filters";
pub const PIPELINE_STAGE_SCORERS: &str = "scorers";
pub const PIPELINE_STAGE_SELECTORS: &str = "selectors";
pub const PIPELINE_STAGE_POST_SELECTION_HYDRATORS: &str = "post_selection_hydrators";
pub const PIPELINE_STAGE_POST_SELECTION_FILTERS: &str = "post_selection_filters";
pub const PIPELINE_STAGE_SIDE_EFFECTS: &str = "side_effects";
pub const PIPELINE_STAGE_GRAPH_PROVIDER: &str = "graph_provider";

pub const PROVIDER_OWNED_PIPELINE_STAGES: &[&str] = &[
    PIPELINE_STAGE_QUERY_HYDRATORS,
    PIPELINE_STAGE_SOURCES,
    PIPELINE_STAGE_CANDIDATE_HYDRATORS,
    PIPELINE_STAGE_POST_SELECTION_HYDRATORS,
];

pub const RUST_OWNED_PIPELINE_STAGES: &[&str] = &[
    PIPELINE_STAGE_FILTERS,
    PIPELINE_STAGE_SELECTORS,
    PIPELINE_STAGE_POST_SELECTION_FILTERS,
    PIPELINE_STAGE_SIDE_EFFECTS,
];

#[cfg(test)]
mod tests {
    use super::{
        PIPELINE_BOUNDARY_VERSION, PIPELINE_OWNER_CPP, PIPELINE_OWNER_NODE_PROVIDER,
        PIPELINE_OWNER_RUST, PIPELINE_SPACE_FEED_EXPERIMENT_ID, PIPELINE_STAGE_GRAPH_PROVIDER,
        PIPELINE_STAGE_SCORERS, PIPELINE_TRACE_MODE_CACHE_REPLAY, PIPELINE_TRACE_MODE_LIVE,
        PIPELINE_TRACE_VERSION, PROVIDER_OWNED_PIPELINE_STAGES, RANKING_MODE_PHOENIX_STANDARDIZED,
        RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2, RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
        RUST_OWNED_PIPELINE_STAGES,
    };

    #[test]
    fn exports_stable_pipeline_stage_and_owner_contracts() {
        assert_eq!(PIPELINE_BOUNDARY_VERSION, "pipeline_boundary_contract_v1");
        assert_eq!(
            RECOMMENDATION_STAGE_RETRIEVAL_RANKING_V2,
            "retrieval_ranking_v2"
        );
        assert_eq!(
            RETRIEVAL_MODE_SOURCE_ORCHESTRATED_GRAPH_V2,
            "source_orchestrated_graph_v2"
        );
        assert_eq!(RANKING_MODE_PHOENIX_STANDARDIZED, "phoenix_standardized");
        assert_eq!(PIPELINE_OWNER_RUST, "rust");
        assert_eq!(
            PIPELINE_OWNER_NODE_PROVIDER,
            "rust_orchestrated_node_provider"
        );
        assert_eq!(PIPELINE_OWNER_CPP, "cpp");
        assert_eq!(PIPELINE_STAGE_SCORERS, "scorers");
        assert_eq!(PIPELINE_STAGE_GRAPH_PROVIDER, "graph_provider");
        assert_eq!(PIPELINE_TRACE_VERSION, "rust_candidate_trace_v1");
        assert_eq!(PIPELINE_TRACE_MODE_LIVE, "live_trace");
        assert_eq!(PIPELINE_TRACE_MODE_CACHE_REPLAY, "cache_replay_trace");
        assert_eq!(PIPELINE_SPACE_FEED_EXPERIMENT_ID, "space_feed_recsys");
        assert_eq!(PROVIDER_OWNED_PIPELINE_STAGES.len(), 4);
        assert_eq!(RUST_OWNED_PIPELINE_STAGES.len(), 4);
    }
}
