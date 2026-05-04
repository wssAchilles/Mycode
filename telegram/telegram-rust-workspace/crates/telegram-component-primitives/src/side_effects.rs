use crate::to_component_names;

pub const RECENT_STORE_SIDE_EFFECT: &str = "RecentStoreSideEffect";
pub const SERVE_CACHE_WRITE_SIDE_EFFECT: &str = "ServeCacheWriteSideEffect";
pub const SIDE_EFFECT_NAMES: &[&str] = &[RECENT_STORE_SIDE_EFFECT, SERVE_CACHE_WRITE_SIDE_EFFECT];

pub fn configured_side_effects() -> Vec<String> {
    to_component_names(SIDE_EFFECT_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{RECENT_STORE_SIDE_EFFECT, SIDE_EFFECT_NAMES, configured_side_effects};

    #[test]
    fn exports_stable_side_effect_order() {
        assert_eq!(SIDE_EFFECT_NAMES[0], RECENT_STORE_SIDE_EFFECT);
        assert_eq!(configured_side_effects().len(), 2);
    }
}
