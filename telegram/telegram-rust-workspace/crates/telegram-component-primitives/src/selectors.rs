use crate::to_component_names;

pub const RUST_TOP_K_SELECTOR: &str = "RustTopKSelector";
pub const SELECTOR_NAMES: &[&str] = &[RUST_TOP_K_SELECTOR];

pub fn configured_selectors() -> Vec<String> {
    to_component_names(SELECTOR_NAMES)
}

#[cfg(test)]
mod tests {
    use super::{RUST_TOP_K_SELECTOR, configured_selectors};

    #[test]
    fn exports_stable_selector_order() {
        assert_eq!(configured_selectors(), [RUST_TOP_K_SELECTOR.to_string()]);
    }
}
