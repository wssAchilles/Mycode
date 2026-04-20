pub mod runtime;

pub const SIDE_EFFECT_NAMES: &[&str] = &["RecentStoreSideEffect", "ServeCacheWriteSideEffect"];

pub fn configured_side_effects() -> Vec<String> {
    SIDE_EFFECT_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}
