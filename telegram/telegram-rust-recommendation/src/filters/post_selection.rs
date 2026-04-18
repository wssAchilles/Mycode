pub const POST_SELECTION_FILTER_NAMES: &[&str] = &["VFFilter", "ConversationDedupFilter"];

pub fn configured_post_selection_filters() -> Vec<String> {
    POST_SELECTION_FILTER_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
