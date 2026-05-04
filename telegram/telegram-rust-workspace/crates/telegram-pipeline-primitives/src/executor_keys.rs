pub const EXECUTOR_LATENCY_QUERY_HYDRATORS: &str = "queryHydrators";
pub const EXECUTOR_LATENCY_SOURCES: &str = "sources";
pub const EXECUTOR_LATENCY_HYDRATE: &str = "hydrate";
pub const EXECUTOR_LATENCY_FILTER: &str = "filter";
pub const EXECUTOR_LATENCY_SCORE: &str = "score";
pub const EXECUTOR_LATENCY_SELECTOR: &str = "selector";
pub const EXECUTOR_LATENCY_POST_SELECTION_HYDRATE: &str = "postSelectionHydrate";
pub const EXECUTOR_LATENCY_POST_SELECTION_FILTER: &str = "postSelectionFilter";
pub const EXECUTOR_LATENCY_SERVING: &str = "serving";

pub const PROVIDER_KEY_QUERY_HYDRATORS_BATCH: &str = "query_hydrators/batch";
pub const PROVIDER_KEY_QUERY_HYDRATORS_FALLBACK: &str = "query_hydrators/fallback";
pub const PROVIDER_KEY_QUERY_HYDRATORS_PREFIX: &str = "query_hydrators";
pub const PROVIDER_KEY_SOURCES_BATCH: &str = "sources/batch";
pub const PROVIDER_KEY_SOURCES_PREFIX: &str = "sources";
pub const PROVIDER_KEY_RETRIEVAL: &str = "retrieval";
pub const PROVIDER_KEY_HYDRATE: &str = "hydrate";
pub const PROVIDER_KEY_SCORE: &str = "score";
pub const PROVIDER_KEY_POST_SELECTION_HYDRATE: &str = "post_selection_hydrate";

pub fn query_hydrator_provider_key(hydrator_name: &str) -> String {
    format!("{PROVIDER_KEY_QUERY_HYDRATORS_PREFIX}/{hydrator_name}")
}

pub fn source_provider_key(source_name: &str) -> String {
    format!("{PROVIDER_KEY_SOURCES_PREFIX}/{source_name}")
}

#[cfg(test)]
mod tests {
    use super::{
        EXECUTOR_LATENCY_POST_SELECTION_FILTER, EXECUTOR_LATENCY_QUERY_HYDRATORS,
        PROVIDER_KEY_POST_SELECTION_HYDRATE, PROVIDER_KEY_QUERY_HYDRATORS_BATCH,
        PROVIDER_KEY_SOURCES_BATCH, query_hydrator_provider_key, source_provider_key,
    };

    #[test]
    fn exports_stable_executor_telemetry_keys() {
        assert_eq!(EXECUTOR_LATENCY_QUERY_HYDRATORS, "queryHydrators");
        assert_eq!(
            EXECUTOR_LATENCY_POST_SELECTION_FILTER,
            "postSelectionFilter"
        );
        assert_eq!(PROVIDER_KEY_QUERY_HYDRATORS_BATCH, "query_hydrators/batch");
        assert_eq!(
            PROVIDER_KEY_POST_SELECTION_HYDRATE,
            "post_selection_hydrate"
        );
        assert_eq!(
            query_hydrator_provider_key("UserFeaturesQueryHydrator"),
            "query_hydrators/UserFeaturesQueryHydrator"
        );
        assert_eq!(PROVIDER_KEY_SOURCES_BATCH, "sources/batch");
        assert_eq!(source_provider_key("GraphSource"), "sources/GraphSource");
    }
}
