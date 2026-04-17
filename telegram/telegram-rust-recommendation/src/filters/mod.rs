pub const FILTER_NAMES: &[&str] = &[
    "DuplicateFilter",
    "NewsDedupFilter",
    "SelfPostFilter",
    "RetweetDedupFilter",
    "AgeFilter",
    "BlockedAuthorFilter",
    "MutedKeywordFilter",
    "SeenFilter",
    "PreviouslyServedFilter",
];

pub fn configured_filters() -> Vec<String> {
    FILTER_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
