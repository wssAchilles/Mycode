pub mod contracts;
pub mod orchestrator;

pub const SOURCE_NAMES: &[&str] = &[
    "FollowingSource",
    "GraphSource",
    "PopularSource",
    "TwoTowerSource",
    "NewsAnnSource",
    "ColdStartSource",
];

pub fn configured_sources(configured_order: &[String]) -> Vec<String> {
    let mut resolved = Vec::new();

    for name in configured_order {
        if SOURCE_NAMES.iter().any(|known| known == &name.as_str()) {
            resolved.push(name.clone());
        }
    }

    if resolved.is_empty() {
        SOURCE_NAMES
            .iter()
            .map(|name| (*name).to_string())
            .collect()
    } else {
        resolved
    }
}
