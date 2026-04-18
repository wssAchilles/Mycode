pub mod post_selection;

pub const FILTER_NAMES: &[&str] = &[
    "DuplicateFilter",
    "NewsExternalIdDedupFilter",
    "SelfPostFilter",
    "RetweetDedupFilter",
    "AgeFilter",
    "BlockedUserFilter",
    "MutedKeywordFilter",
    "SeenPostFilter",
    "PreviouslyServedFilter",
];

pub fn configured_filters() -> Vec<String> {
    FILTER_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
