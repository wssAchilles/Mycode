pub const SOURCE_DISABLED_REASON_UNKNOWN_SOURCE: &str = "unknownSource";
pub const SOURCE_DISABLED_REASON_IN_NETWORK_ONLY: &str = "inNetworkOnly";
pub const SOURCE_DISABLED_REASON_OFFLINE_ONLY_SOURCE: &str = "offlineOnlySource";
pub const SOURCE_DISABLED_REASON_FALLBACK_NOT_NEEDED: &str = "fallbackNotNeeded";
pub const SOURCE_DISABLED_REASON_LANE_DISABLED: &str = "laneDisabled";
pub const SOURCE_DISABLED_REASON_EMBEDDING_SIGNAL_TOO_WEAK: &str = "embeddingSignalTooWeak";
pub const SOURCE_DISABLED_REASON_COLD_START_BOOTSTRAP_ONLY: &str = "coldStartBootstrapOnly";
pub const SOURCE_DISABLED_REASON_SPARSE_SKIPS_COLD_START: &str = "sparseSkipsColdStart";
pub const SOURCE_DISABLED_REASON_SPARSE_GRAPH_DISABLED: &str = "sparseGraphDisabled";
pub const SOURCE_DISABLED_REASON_WARM_SKIPS_COLD_START: &str = "warmSkipsColdStart";

#[cfg(test)]
mod tests {
    use super::{
        SOURCE_DISABLED_REASON_EMBEDDING_SIGNAL_TOO_WEAK,
        SOURCE_DISABLED_REASON_OFFLINE_ONLY_SOURCE, SOURCE_DISABLED_REASON_UNKNOWN_SOURCE,
        SOURCE_DISABLED_REASON_WARM_SKIPS_COLD_START,
    };

    #[test]
    fn exports_stable_source_disabled_reason_contract() {
        assert_eq!(SOURCE_DISABLED_REASON_UNKNOWN_SOURCE, "unknownSource");
        assert_eq!(
            SOURCE_DISABLED_REASON_OFFLINE_ONLY_SOURCE,
            "offlineOnlySource"
        );
        assert_eq!(
            SOURCE_DISABLED_REASON_EMBEDDING_SIGNAL_TOO_WEAK,
            "embeddingSignalTooWeak"
        );
        assert_eq!(
            SOURCE_DISABLED_REASON_WARM_SKIPS_COLD_START,
            "warmSkipsColdStart"
        );
    }
}
